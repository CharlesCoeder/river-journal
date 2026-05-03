/**
 * useKeyboardShortcuts behavior tests — RED PHASE.
 *
 * useKeyboardShortcuts.ts currently exports a no-op stub.
 * Every test in this file is expected to fail until the real implementation lands.
 *
 * ── Environment note ──────────────────────────────────────────────────────────
 * These tests run in happy-dom so document.addEventListener and
 * document.querySelector are available.  The hook is tested by mounting a
 * minimal React component that calls useKeyboardShortcuts(), then dispatching
 * synthetic KeyboardEvents on document.
 *
 * ── Router / pathname pattern ─────────────────────────────────────────────────
 * Uses the existing solito/navigation mock (module alias in vitest.config.mts).
 * A mutable __currentPathname ref controls usePathname() return value;
 * a mutable __pushSpy ref is refreshed in beforeEach for clean per-test spies.
 *
 * ── hidePersistentEditor pattern ──────────────────────────────────────────────
 * The hook imports hidePersistentEditor from app/state/store (or app/utils —
 * the test mocks both to be safe). The mock verifies it is called on Esc in
 * the journal route.
 */

// @vitest-environment happy-dom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useKeyboardShortcuts } from '../useKeyboardShortcuts'

// ---------------------------------------------------------------------------
// Router spy + mutable pathname
// ---------------------------------------------------------------------------
let __pushSpy = vi.fn()
let __currentPathname = '/'

vi.mock('solito/navigation', () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => __pushSpy(...args),
    back: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => __currentPathname,
  useLink: () => ({}),
  useParams: () => ({}),
  useSearchParams: () => ({}),
}))

// ---------------------------------------------------------------------------
// hidePersistentEditor mock — try multiple import paths the implementation
// might use. We override both so the test works regardless of which the
// implementation chooses.
// ---------------------------------------------------------------------------
const mockHidePersistentEditor = vi.fn()

vi.mock('@legendapp/state/react', () => ({
  use$: (obs$: any) => obs$, // identity
}))

vi.mock('app/state/store', () => ({
  store$: {
    session: { isAuthenticated: { get: () => false } },
    profile: null,
  },
  hidePersistentEditor: (...args: unknown[]) => mockHidePersistentEditor(...args),
}))

vi.mock('app/utils', () => ({
  signOut: vi.fn(),
  hidePersistentEditor: (...args: unknown[]) => mockHidePersistentEditor(...args),
}))

// ---------------------------------------------------------------------------
// app/state/persistConfig (transitive)
// ---------------------------------------------------------------------------
vi.mock('app/state/persistConfig', () => ({
  persistPlugin: { getTable: vi.fn(), setTable: vi.fn(), deleteTable: vi.fn() },
  configurePersistence: vi.fn(),
}))

// ---------------------------------------------------------------------------
// @my/ui (transitive)
// ---------------------------------------------------------------------------
vi.mock('@my/ui', () => ({
  useMedia: () => ({ sm: false, md: true, lg: true, xl: false }),
  useReducedMotion: () => false,
}))

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------
beforeEach(() => {
  __pushSpy = vi.fn()
  __currentPathname = '/'
  mockHidePersistentEditor.mockReset()
  // Clean up any leftover modal overlay from previous tests
  document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Minimal host component that mounts the hook
// ---------------------------------------------------------------------------
function KeyboardShortcutsHost() {
  useKeyboardShortcuts()
  return React.createElement('div', { 'data-testid': 'host' })
}

function renderHook() {
  return render(React.createElement(KeyboardShortcutsHost))
}

// ---------------------------------------------------------------------------
// Helper: dispatch a KeyboardEvent on document
// ---------------------------------------------------------------------------
function dispatchKey(
  key: string,
  opts: {
    metaKey?: boolean
    ctrlKey?: boolean
    isComposing?: boolean
    keyCode?: number
    defaultPrevented?: boolean
    target?: EventTarget
  } = {}
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    isComposing: opts.isComposing ?? false,
    keyCode: opts.keyCode,
  })

  // If caller wants a pre-prevented event, call preventDefault before dispatch
  if (opts.defaultPrevented) {
    event.preventDefault()
  }

  const target = opts.target ?? document
  ;(target as HTMLElement).dispatchEvent(event)
  return event
}

// ===========================================================================
// Suite 1 — Cmd/Ctrl+N opens editor (AC 6)
// ===========================================================================

describe('Cmd/Ctrl+N opens editor from any non-journal route (AC 6)', () => {
  it('Cmd+N calls router.push("/journal") and preventDefault()', () => {
    renderHook()
    const event = dispatchKey('n', { metaKey: true })
    expect(__pushSpy).toHaveBeenCalledWith('/journal')
    expect(event.defaultPrevented).toBe(true)
  })

  it('Ctrl+N calls router.push("/journal") and preventDefault()', () => {
    renderHook()
    const event = dispatchKey('n', { ctrlKey: true })
    expect(__pushSpy).toHaveBeenCalledWith('/journal')
    expect(event.defaultPrevented).toBe(true)
  })

  it('Cmd+N is a no-op when already on /journal', () => {
    __currentPathname = '/journal'
    renderHook()
    dispatchKey('n', { metaKey: true })
    expect(__pushSpy).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Suite 2 — Cmd/Ctrl+, opens Preferences (AC 7)
// ===========================================================================

describe('Cmd/Ctrl+, opens Preferences from any non-settings route (AC 7)', () => {
  it('Cmd+, calls router.push("/settings") and preventDefault()', () => {
    renderHook()
    const event = dispatchKey(',', { metaKey: true })
    expect(__pushSpy).toHaveBeenCalledWith('/settings')
    expect(event.defaultPrevented).toBe(true)
  })

  it('Ctrl+, calls router.push("/settings") and preventDefault()', () => {
    renderHook()
    const event = dispatchKey(',', { ctrlKey: true })
    expect(__pushSpy).toHaveBeenCalledWith('/settings')
    expect(event.defaultPrevented).toBe(true)
  })

  it('Cmd+, is a no-op when already on /settings', () => {
    __currentPathname = '/settings'
    renderHook()
    dispatchKey(',', { metaKey: true })
    expect(__pushSpy).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Suite 3 — Esc exits editor to home (AC 5)
// ===========================================================================

describe('Esc on /journal calls hidePersistentEditor then routes to / (AC 5)', () => {
  it('Esc on /journal calls hidePersistentEditor and router.push("/")', () => {
    __currentPathname = '/journal'
    renderHook()
    dispatchKey('Escape')
    expect(mockHidePersistentEditor).toHaveBeenCalledTimes(1)
    expect(__pushSpy).toHaveBeenCalledWith('/')
  })

  it('hidePersistentEditor is called before router.push', () => {
    __currentPathname = '/journal'
    const callOrder: string[] = []
    mockHidePersistentEditor.mockImplementation(() => callOrder.push('hide'))
    __pushSpy = vi.fn().mockImplementation(() => callOrder.push('push'))

    renderHook()
    dispatchKey('Escape')

    expect(callOrder).toEqual(['hide', 'push'])
  })

  it('Esc on / (home) does NOT call hidePersistentEditor or router.push', () => {
    __currentPathname = '/'
    renderHook()
    dispatchKey('Escape')
    expect(mockHidePersistentEditor).not.toHaveBeenCalled()
    expect(__pushSpy).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Suite 4 — Editable-target suppression contract (AC 7)
// ===========================================================================

describe('Esc does NOT fire when target is an editable element (AC 7)', () => {
  it('Esc from inside an <input> does not call hidePersistentEditor', () => {
    __currentPathname = '/journal'
    const { container } = renderHook()

    const input = document.createElement('input')
    container.appendChild(input)
    input.focus()

    dispatchKey('Escape', { target: input })
    expect(mockHidePersistentEditor).not.toHaveBeenCalled()
  })

  it('Esc from inside a <textarea> does not call hidePersistentEditor', () => {
    __currentPathname = '/journal'
    const { container } = renderHook()

    const textarea = document.createElement('textarea')
    container.appendChild(textarea)
    textarea.focus()

    dispatchKey('Escape', { target: textarea })
    expect(mockHidePersistentEditor).not.toHaveBeenCalled()
  })

  it('Esc from inside a contenteditable element does not call hidePersistentEditor', () => {
    __currentPathname = '/journal'
    const { container } = renderHook()

    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    container.appendChild(div)
    div.focus()

    dispatchKey('Escape', { target: div })
    expect(mockHidePersistentEditor).not.toHaveBeenCalled()
  })

  it('Cmd+N is suppressed when focus is inside a contenteditable', () => {
    __currentPathname = '/'
    const { container } = renderHook()

    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    container.appendChild(editor)
    editor.focus()

    dispatchKey('n', { metaKey: true, target: editor })
    expect(__pushSpy).not.toHaveBeenCalled()
  })

  it('Esc from inside a <select> does not call hidePersistentEditor', () => {
    __currentPathname = '/journal'
    const { container } = renderHook()

    const select = document.createElement('select')
    container.appendChild(select)
    select.focus()

    dispatchKey('Escape', { target: select })
    expect(mockHidePersistentEditor).not.toHaveBeenCalled()
  })

  it('Esc from inside a bare contenteditable="" element does not call hidePersistentEditor', () => {
    __currentPathname = '/journal'
    const { container } = renderHook()

    const div = document.createElement('div')
    div.setAttribute('contenteditable', '')
    container.appendChild(div)
    div.focus()

    dispatchKey('Escape', { target: div })
    expect(mockHidePersistentEditor).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Suite 5 — IME composition suppression (AC 7)
// ===========================================================================

describe('shortcuts do NOT fire during IME composition (AC 7)', () => {
  it('Esc with isComposing=true does not call hidePersistentEditor', () => {
    __currentPathname = '/journal'
    renderHook()
    dispatchKey('Escape', { isComposing: true })
    expect(mockHidePersistentEditor).not.toHaveBeenCalled()
  })

  it('Esc with keyCode 229 (IME sentinel) does not call hidePersistentEditor', () => {
    __currentPathname = '/journal'
    renderHook()
    dispatchKey('Escape', { keyCode: 229 })
    expect(mockHidePersistentEditor).not.toHaveBeenCalled()
  })

  it('Cmd+N with isComposing=true does not navigate', () => {
    renderHook()
    dispatchKey('n', { metaKey: true, isComposing: true })
    expect(__pushSpy).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Suite 6 — defaultPrevented suppression (AC 7)
// ===========================================================================

describe('shortcuts do NOT fire when event.defaultPrevented is already true (AC 7)', () => {
  it('Esc with defaultPrevented=true does not call hidePersistentEditor', () => {
    __currentPathname = '/journal'
    renderHook()
    dispatchKey('Escape', { defaultPrevented: true })
    expect(mockHidePersistentEditor).not.toHaveBeenCalled()
  })

  it('Cmd+N with defaultPrevented=true does not navigate', () => {
    renderHook()
    dispatchKey('n', { metaKey: true, defaultPrevented: true })
    expect(__pushSpy).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Suite 7 — Modal-open check: Esc defers to modal (AC 8)
// ===========================================================================

describe('Esc does NOT fire when a modal is open (AC 8)', () => {
  function addOpenDialog() {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('data-state', 'open')
    document.body.appendChild(dialog)
    return dialog
  }

  afterEach(() => {
    document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove())
  })

  it('Esc with [role="dialog"][data-state="open"] present does not call hidePersistentEditor', () => {
    __currentPathname = '/journal'
    renderHook()
    addOpenDialog()
    dispatchKey('Escape')
    expect(mockHidePersistentEditor).not.toHaveBeenCalled()
  })

  it('Esc with no open modal does call hidePersistentEditor on /journal', () => {
    __currentPathname = '/journal'
    renderHook()
    // No dialog in DOM
    dispatchKey('Escape')
    expect(mockHidePersistentEditor).toHaveBeenCalledTimes(1)
  })

  it('Esc does NOT preventDefault when a modal is open (AC 8)', () => {
    __currentPathname = '/journal'
    renderHook()
    addOpenDialog()
    const event = dispatchKey('Escape')
    expect(event.defaultPrevented).toBe(false)
  })
})

// ===========================================================================
// Suite 8 — Listener lifecycle: registered on mount, removed on unmount
// ===========================================================================

describe('shortcut listener is registered on mount and removed on unmount', () => {
  it('navigates after mount', () => {
    renderHook()
    dispatchKey('n', { metaKey: true })
    expect(__pushSpy).toHaveBeenCalledWith('/journal')
  })

  it('does NOT navigate after unmount', async () => {
    const { unmount } = renderHook()
    unmount()
    await act(async () => { await Promise.resolve() })
    // Reset the spy so we can check it's clean
    __pushSpy.mockReset()
    dispatchKey('n', { metaKey: true })
    expect(__pushSpy).not.toHaveBeenCalled()
  })

  it('removeEventListener is called on cleanup (no duplicate calls across re-renders)', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    const { unmount } = renderHook()
    unmount()

    // At least one add and matching remove should have occurred
    expect(addSpy).toHaveBeenCalled()
    expect(removeSpy).toHaveBeenCalled()

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
