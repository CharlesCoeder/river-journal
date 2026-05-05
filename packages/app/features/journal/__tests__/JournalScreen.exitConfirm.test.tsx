// @vitest-environment happy-dom
// Story 2-6: JournalScreen — exit-confirm gating (AC 22) + focus-mode toggle wiring (AC 23)
// RED-PHASE TDD: all tests fail before implementation.
//   - handleExitFlow gating logic does not yet check word count or checkpoint
//   - showExitConfirmDialog state and dialog copy do not yet exist
//   - Focus mode toggle button does not yet appear in editor chrome
//   - setFocusMode action does not yet exist in store

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted() — all spies and mutable state referenced in vi.mock() factories
// MUST be declared here so they are available when factories execute (hoisted
// to top of file by Vite's transform, before any other top-level code runs).
// ─────────────────────────────────────────────────────────────────────────────
const {
  pushSpy,
  replaceSpy,
  saveActiveFlowSessionSpy,
  hidePersistentEditorSpy,
  getActiveFlowContentSpy,
  setFocusModeSpy,
  hasReachedAutosaveCheckpointSpy,
  mockState,
  // Shared mock observable references — used by both store mock and use$ mock
  // to avoid needing require('app/state/store') at runtime.
  mockEphemeralInstantWordCount,
  mockStoreActiveFlow,
  mockStoreProfileEditorFocusMode,
} = vi.hoisted(() => {
  // Mutable state box — factories close over this object so mutations are live.
  const mockState = {
    instantWordCount: 0,
    activeFlowContent: null as string | null,
    focusMode: undefined as boolean | undefined,
  }

  // Stable observable identity objects — same reference used in store mock + use$ mock
  const mockEphemeralInstantWordCount = {
    get: () => mockState.instantWordCount,
    peek: () => mockState.instantWordCount,
  }

  const mockStoreActiveFlow = {
    get: () =>
      mockState.activeFlowContent !== null
        ? { content: mockState.activeFlowContent, wordCount: mockState.instantWordCount }
        : null,
    peek: () =>
      mockState.activeFlowContent !== null
        ? { content: mockState.activeFlowContent, wordCount: mockState.instantWordCount }
        : null,
  }

  const mockStoreProfileEditorFocusMode = {
    get: () => mockState.focusMode,
    peek: () => mockState.focusMode,
  }

  return {
    pushSpy: vi.fn(),
    replaceSpy: vi.fn(),
    saveActiveFlowSessionSpy: vi.fn(),
    hidePersistentEditorSpy: vi.fn(),
    getActiveFlowContentSpy: vi.fn(() => ''),
    setFocusModeSpy: vi.fn(),
    hasReachedAutosaveCheckpointSpy: vi.fn(() => false),
    mockState,
    mockEphemeralInstantWordCount,
    mockStoreActiveFlow,
    mockStoreProfileEditorFocusMode,
  }
})

// ─── @tamagui/lucide-icons mock ──────────────────────────────────────────────
vi.mock('@tamagui/lucide-icons', () => ({
  Eye: () => null,
  EyeOff: () => null,
}))

// ─── @my/ui mock ─────────────────────────────────────────────────────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const { testID, onPress, 'aria-label': ariaLabel, 'aria-pressed': ariaPressed, ...rest } = props
    return {
      ...rest,
      ...(testID ? { 'data-testid': testID } : {}),
      ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      ...(ariaPressed !== undefined ? { 'aria-pressed': String(ariaPressed) } : {}),
      ...(onPress ? { onClick: onPress } : {}),
    }
  }

  const passthrough = (tagName: keyof HTMLElementTagNameMap) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(tagName, mapProps(props), children)
    Component.displayName = tagName
    return Component
  }

  const ExpandingLineButton = ({ children, onPress, testID, ...props }: any) =>
    ReactModule.createElement(
      'button',
      { ...mapProps({ onPress, testID, ...props }), type: 'button' },
      children
    )

  const WordCounter = ({ count }: { count: number }) =>
    ReactModule.createElement('span', { 'data-testid': 'word-counter' }, String(count))

  const Dialog = ({ children, open }: any) => {
    if (!open) return null
    return ReactModule.createElement('div', { role: 'dialog', 'aria-modal': 'true' }, children)
  }
  Dialog.Portal = ({ children }: any) => ReactModule.createElement(ReactModule.Fragment, null, children)
  Dialog.Overlay = () => null
  Dialog.Content = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-testid': 'dialog-content' }, children)
  Dialog.Title = ({ children }: any) =>
    ReactModule.createElement('h2', { 'data-testid': 'dialog-title' }, children)
  Dialog.Description = ({ children }: any) =>
    ReactModule.createElement('p', { 'data-testid': 'dialog-description' }, children)
  Dialog.Close = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)

  return {
    AnimatePresence: ({ children }: any) => ReactModule.createElement(ReactModule.Fragment, null, children),
    YStack: passthrough('div'),
    XStack: passthrough('div'),
    View: passthrough('div'),
    Text: passthrough('span'),
    Dialog,
    ExpandingLineButton,
    WordCounter,
    isWeb: true,
    useReducedMotion: () => false,
  }
})

// ─── solito/navigation ───────────────────────────────────────────────────────
vi.mock('solito/navigation', () => ({
  useRouter: () => ({
    push: pushSpy,
    replace: replaceSpy,
    back: vi.fn(),
  }),
  usePathname: () => '/journal',
  useLink: () => ({}),
  useParams: () => ({}),
  useSearchParams: () => ({}),
}))

// ─── app/state/store ─────────────────────────────────────────────────────────
vi.mock('app/state/store', () => {
  const ephemeral$ = {
    instantWordCount: mockEphemeralInstantWordCount,
  }

  const profileEditor = { focusMode: mockStoreProfileEditorFocusMode }
  const profile = { editor: profileEditor, get: () => null }

  const store$ = {
    activeFlow: mockStoreActiveFlow,
    profile,
  }

  return {
    store$,
    ephemeral$,
    saveActiveFlowSession: saveActiveFlowSessionSpy,
    getActiveFlowContent: getActiveFlowContentSpy,
    hidePersistentEditor: hidePersistentEditorSpy,
    setFocusMode: setFocusModeSpy,
    updatePersistentEditorHeaderHeight: vi.fn(),
    updatePersistentEditorBottomBarHeight: vi.fn(),
    hasReachedAutosaveCheckpoint: hasReachedAutosaveCheckpointSpy,
  }
})

// ─── @legendapp/state/react — controllable use$() ────────────────────────────
// Uses shared observable references from vi.hoisted() to avoid require() at runtime.
vi.mock('@legendapp/state/react', () => ({
  use$: (observable: any) => {
    if (observable === mockEphemeralInstantWordCount) {
      return mockState.instantWordCount
    }
    if (observable === mockStoreActiveFlow) {
      return mockState.activeFlowContent !== null
        ? { content: mockState.activeFlowContent, wordCount: mockState.instantWordCount }
        : null
    }
    if (observable === mockStoreProfileEditorFocusMode) {
      return mockState.focusMode
    }
    try {
      return observable?.get?.() ?? null
    } catch {
      return null
    }
  },
}))

// ─── Editor component stub ───────────────────────────────────────────────────
vi.mock('../components/Editor', () => ({
  Editor: ({ focusMode }: { focusMode?: boolean }) =>
    React.createElement('div', {
      'data-testid': 'editor',
      'data-focus-mode': String(focusMode ?? false),
    }),
}))

// ─── KeyboardOffsetView stub ─────────────────────────────────────────────────
vi.mock('../components/KeyboardOffsetView', () => ({
  KeyboardOffsetView: ({ children }: any) =>
    React.createElement('div', { 'data-testid': 'keyboard-offset-view' }, children),
}))

// ─── useTrackKeyboardHeight stub ─────────────────────────────────────────────
vi.mock('../hooks/useTrackKeyboardHeight', () => ({
  useTrackKeyboardHeight: () => {},
}))

// ─── Import under test ───────────────────────────────────────────────────────
import { JournalScreen } from '../JournalScreen'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function renderJournal() {
  return render(React.createElement(JournalScreen))
}

function tapFinishSession() {
  const btn = screen.getByRole('button', { name: /finish session/i })
  fireEvent.click(btn)
}

// ─────────────────────────────────────────────────────────────────────────────
// Test isolation
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  mockState.instantWordCount = 0
  mockState.activeFlowContent = null
  mockState.focusMode = undefined
  pushSpy.mockClear()
  replaceSpy.mockClear()
  setFocusModeSpy.mockClear()
  saveActiveFlowSessionSpy.mockClear()
  hidePersistentEditorSpy.mockClear()
  getActiveFlowContentSpy.mockReturnValue('')
  hasReachedAutosaveCheckpointSpy.mockReturnValue(false)
})

afterEach(() => {
  cleanup()
})

// =============================================================================
// AC 22: exit-confirm gating — 6 cases
// =============================================================================

describe('AC22 — Case 1: wordCount=0, no content → Finish Session goes straight to home (no dialog)', () => {
  it('does NOT render the exit-confirm dialog on mount with zero content', () => {
    mockState.instantWordCount = 0
    mockState.activeFlowContent = null
    getActiveFlowContentSpy.mockReturnValue('')
    renderJournal()

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('calls router.push("/") without showing a dialog when tapping Finish Session with zero content', () => {
    mockState.instantWordCount = 0
    mockState.activeFlowContent = null
    getActiveFlowContentSpy.mockReturnValue('')

    renderJournal()

    // Bottom bar shows only when hasContent; with zero words and null content it may be absent.
    const finishBtn = screen.queryByRole('button', { name: /finish session/i })
    if (finishBtn) {
      fireEvent.click(finishBtn)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(pushSpy).toHaveBeenCalledWith('/')
    } else {
      // Correct: bottom bar not rendered when there is no content (AC 16)
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })
})

describe('AC22 — Case 2: wordCount=30, content present, no checkpoint → dialog with "You\'ve barely written"', () => {
  it('shows the exit-confirm dialog when word count < 50 and no checkpoint', () => {
    mockState.instantWordCount = 30
    mockState.activeFlowContent = 'thirty words of content here'
    getActiveFlowContentSpy.mockReturnValue('thirty words of content here')
    hasReachedAutosaveCheckpointSpy.mockReturnValue(false)

    renderJournal()
    tapFinishSession()

    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('dialog title is "You\'ve barely written"', () => {
    mockState.instantWordCount = 30
    mockState.activeFlowContent = 'thirty words of content here'
    getActiveFlowContentSpy.mockReturnValue('thirty words of content here')
    hasReachedAutosaveCheckpointSpy.mockReturnValue(false)

    renderJournal()
    tapFinishSession()

    expect(screen.getByTestId('dialog-title').textContent).toMatch(/you've barely written/i)
  })

  it('dialog is NOT shown before tapping Finish Session', () => {
    mockState.instantWordCount = 30
    mockState.activeFlowContent = 'thirty words of content here'
    getActiveFlowContentSpy.mockReturnValue('thirty words of content here')

    renderJournal()

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('AC22 — Case 3: wordCount=30, content present, checkpoint reached → no dialog, goes to celebration', () => {
  it('does NOT show the exit-confirm dialog when checkpoint is reached', () => {
    mockState.instantWordCount = 30
    mockState.activeFlowContent = 'thirty words but checkpoint reached'
    getActiveFlowContentSpy.mockReturnValue('thirty words but checkpoint reached')
    hasReachedAutosaveCheckpointSpy.mockReturnValue(true)

    renderJournal()
    tapFinishSession()

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('calls saveActiveFlowSession when checkpoint reached and wordCount < 50', () => {
    mockState.instantWordCount = 30
    mockState.activeFlowContent = 'thirty words but checkpoint reached'
    getActiveFlowContentSpy.mockReturnValue('thirty words but checkpoint reached')
    hasReachedAutosaveCheckpointSpy.mockReturnValue(true)

    renderJournal()
    tapFinishSession()

    expect(saveActiveFlowSessionSpy).toHaveBeenCalled()
  })

  it('navigates to /journal/celebration when checkpoint reached and wordCount < 50', () => {
    mockState.instantWordCount = 30
    mockState.activeFlowContent = 'thirty words but checkpoint reached'
    getActiveFlowContentSpy.mockReturnValue('thirty words but checkpoint reached')
    hasReachedAutosaveCheckpointSpy.mockReturnValue(true)

    renderJournal()
    tapFinishSession()

    expect(replaceSpy).toHaveBeenCalledWith('/journal/celebration')
  })
})

describe('AC22 — Case 4: wordCount=60, content present → no dialog, goes to celebration', () => {
  it('does NOT show the exit-confirm dialog when word count >= 50', () => {
    mockState.instantWordCount = 60
    mockState.activeFlowContent = 'sixty words of writing in this flow'
    getActiveFlowContentSpy.mockReturnValue('sixty words of writing in this flow')
    hasReachedAutosaveCheckpointSpy.mockReturnValue(false)

    renderJournal()
    tapFinishSession()

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('calls saveActiveFlowSession for >= 50 word count', () => {
    mockState.instantWordCount = 60
    mockState.activeFlowContent = 'sixty words of writing in this flow'
    getActiveFlowContentSpy.mockReturnValue('sixty words of writing in this flow')
    hasReachedAutosaveCheckpointSpy.mockReturnValue(false)

    renderJournal()
    tapFinishSession()

    expect(saveActiveFlowSessionSpy).toHaveBeenCalled()
  })

  it('navigates to /journal/celebration for >= 50 word count', () => {
    mockState.instantWordCount = 60
    mockState.activeFlowContent = 'sixty words of writing in this flow'
    getActiveFlowContentSpy.mockReturnValue('sixty words of writing in this flow')
    hasReachedAutosaveCheckpointSpy.mockReturnValue(false)

    renderJournal()
    tapFinishSession()

    expect(replaceSpy).toHaveBeenCalledWith('/journal/celebration')
  })

  it('does NOT show dialog at exactly 50 words (boundary: >= 50 → no dialog)', () => {
    mockState.instantWordCount = 50
    mockState.activeFlowContent = 'exactly fifty words here'
    getActiveFlowContentSpy.mockReturnValue('exactly fifty words here')
    hasReachedAutosaveCheckpointSpy.mockReturnValue(false)

    renderJournal()
    tapFinishSession()

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('AC22 — Case 5: Cancel button in dialog dismisses dialog; user stays on /journal', () => {
  beforeEach(() => {
    mockState.instantWordCount = 30
    mockState.activeFlowContent = 'thirty words of content'
    getActiveFlowContentSpy.mockReturnValue('thirty words of content')
    hasReachedAutosaveCheckpointSpy.mockReturnValue(false)
  })

  it('dialog closes when Cancel is pressed', () => {
    renderJournal()
    tapFinishSession()

    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelBtn)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('router.push is NOT called when Cancel is pressed', () => {
    renderJournal()
    tapFinishSession()
    pushSpy.mockClear()
    replaceSpy.mockClear()

    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelBtn)

    expect(pushSpy).not.toHaveBeenCalled()
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  it('saveActiveFlowSession is NOT called when Cancel is pressed', () => {
    renderJournal()
    tapFinishSession()
    saveActiveFlowSessionSpy.mockClear()

    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelBtn)

    expect(saveActiveFlowSessionSpy).not.toHaveBeenCalled()
  })
})

describe('AC22 — Case 6: Confirm button navigates to "/" and does NOT call saveActiveFlowSession', () => {
  beforeEach(() => {
    mockState.instantWordCount = 30
    mockState.activeFlowContent = 'thirty words of content'
    getActiveFlowContentSpy.mockReturnValue('thirty words of content')
    hasReachedAutosaveCheckpointSpy.mockReturnValue(false)
  })

  it('navigates to "/" when Confirm is pressed', () => {
    renderJournal()
    tapFinishSession()
    pushSpy.mockClear()

    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    fireEvent.click(confirmBtn)

    expect(pushSpy).toHaveBeenCalledWith('/')
  })

  it('does NOT call saveActiveFlowSession when Confirm is pressed', () => {
    renderJournal()
    tapFinishSession()
    saveActiveFlowSessionSpy.mockClear()

    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    fireEvent.click(confirmBtn)

    expect(saveActiveFlowSessionSpy).not.toHaveBeenCalled()
  })

  it('dialog closes after Confirm is pressed', () => {
    renderJournal()
    tapFinishSession()

    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    fireEvent.click(confirmBtn)

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

// =============================================================================
// AC 23: focus-mode toggle wiring + aria-pressed
// =============================================================================

describe('AC23 — Focus mode toggle appears in editor chrome', () => {
  it('renders a "Toggle focus mode" button in the editor chrome', () => {
    mockState.instantWordCount = 10
    mockState.activeFlowContent = 'some content'
    mockState.focusMode = false
    renderJournal()

    expect(screen.getByRole('button', { name: /toggle focus mode/i })).toBeTruthy()
  })
})

describe('AC23 — aria-pressed reflects focusMode state', () => {
  it('aria-pressed="false" when focusMode is undefined (default-OFF)', () => {
    mockState.instantWordCount = 10
    mockState.activeFlowContent = 'some content'
    mockState.focusMode = undefined
    renderJournal()

    const toggleBtn = screen.getByRole('button', { name: /toggle focus mode/i })
    // undefined focusMode ?? false → aria-pressed="false"
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('false')
  })

  it('aria-pressed="false" when focusMode is explicitly false', () => {
    mockState.instantWordCount = 10
    mockState.activeFlowContent = 'some content'
    mockState.focusMode = false
    renderJournal()

    const toggleBtn = screen.getByRole('button', { name: /toggle focus mode/i })
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('false')
  })

  it('aria-pressed="true" when focusMode is true', () => {
    mockState.instantWordCount = 10
    mockState.activeFlowContent = 'some content'
    mockState.focusMode = true
    renderJournal()

    const toggleBtn = screen.getByRole('button', { name: /toggle focus mode/i })
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('AC23 — Tapping toggle calls setFocusMode with inverted value', () => {
  it('calls setFocusMode(true) when tapped and focusMode is false', () => {
    mockState.instantWordCount = 10
    mockState.activeFlowContent = 'some content'
    mockState.focusMode = false
    renderJournal()

    const toggleBtn = screen.getByRole('button', { name: /toggle focus mode/i })
    fireEvent.click(toggleBtn)

    expect(setFocusModeSpy).toHaveBeenCalledWith(true)
  })

  it('calls setFocusMode(false) when tapped and focusMode is true', () => {
    mockState.instantWordCount = 10
    mockState.activeFlowContent = 'some content'
    mockState.focusMode = true
    renderJournal()

    const toggleBtn = screen.getByRole('button', { name: /toggle focus mode/i })
    fireEvent.click(toggleBtn)

    expect(setFocusModeSpy).toHaveBeenCalledWith(false)
  })

  it('calls setFocusMode(true) when tapped and focusMode is undefined (treated as false)', () => {
    mockState.instantWordCount = 10
    mockState.activeFlowContent = 'some content'
    mockState.focusMode = undefined
    renderJournal()

    const toggleBtn = screen.getByRole('button', { name: /toggle focus mode/i })
    fireEvent.click(toggleBtn)

    expect(setFocusModeSpy).toHaveBeenCalledWith(true)
  })
})
