// @vitest-environment happy-dom
/**
 * CelebrationScreen — post-flow summary behaviour.
 *
 * Locks in the three things the screen must get right after a flow is saved:
 *   1. The headline is THIS flow's word count. The day's running total is a
 *      separate, separately-labelled line, and only appears when it actually
 *      differs from the flow count.
 *   2. The saved flow itself is rendered (read-only) so it can be re-read —
 *      on the quieter variant as well as the handoff one.
 *   3. Nothing auto-dismisses. The user leaves via the Done control.
 *
 * Layout (the hero being one screenful tall so the summary is centred) is not
 * asserted here: @my/ui is stubbed to plain DOM elements, so style props carry
 * no meaning in this environment.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { getTodayJournalDayString } from 'app/state/date-utils'

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted() — spies and mutable state referenced inside vi.mock() factories.
// `nodes` are stable sentinel objects standing in for observable/computed
// handles, so the use$() stub can dispatch on identity.
// ─────────────────────────────────────────────────────────────────────────────
const {
  navigateHomeSpy,
  clearLastSavedFlowSpy,
  clearActiveFlowSpy,
  markUnlockSurfacedSpy,
  pushSpy,
  mockState,
  nodes,
} = vi.hoisted(() => {
  const mockState = {
    lastSavedFlow: null as {
      content: string
      wordCount: number
      timestamp: string
    } | null,
    isAuthenticated: true,
    todayEntry: null as { flows: { id: string; timestamp: string; wordCount: number }[] } | null,
    dayTotalWords: 0,
    streak: { currentStreak: 0, unlockTokensEarned: 0 },
  }

  const nodes = {
    lastSavedFlow: {
      get: () => mockState.lastSavedFlow,
      peek: () => mockState.lastSavedFlow,
    },
    isAuthenticated: {
      get: () => mockState.isAuthenticated,
      peek: () => mockState.isAuthenticated,
    },
    entryByDate: { __node: 'entryByDate' },
    statsByDate: { __node: 'statsByDate' },
    streak: { __node: 'streak' },
    surfaced: { __node: 'surfaced' },
  }

  return {
    navigateHomeSpy: vi.fn(),
    clearLastSavedFlowSpy: vi.fn(),
    clearActiveFlowSpy: vi.fn(),
    markUnlockSurfacedSpy: vi.fn(),
    pushSpy: vi.fn(),
    mockState,
    nodes,
  }
})

// ─── @my/ui stub ─────────────────────────────────────────────────────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const { testID, onPress, id, ...rest } = props as Record<string, any>
    const passable: Record<string, any> = {}
    for (const [key, value] of Object.entries(rest)) {
      // Only forward attributes the DOM understands; Tamagui style props would
      // otherwise spam React with unknown-prop warnings.
      if (key === 'children' || key.startsWith('aria-') || key === 'role') passable[key] = value
    }
    return {
      ...passable,
      ...(id ? { id } : {}),
      ...(testID ? { 'data-testid': testID } : {}),
      ...(onPress ? { onClick: onPress } : {}),
    }
  }

  const passthrough = (tagName: keyof HTMLElementTagNameMap) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(tagName, mapProps(props), children)
    Component.displayName = tagName
    return Component
  }

  const ExpandingLineButton = ({ children, onPress, id }: any) =>
    ReactModule.createElement('button', { type: 'button', id, onClick: onPress }, children)

  return {
    AnimatePresence: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    ScrollView: passthrough('div'),
    YStack: passthrough('div'),
    XStack: passthrough('div'),
    View: passthrough('div'),
    Text: passthrough('span'),
    ExpandingLineButton,
    isWeb: true,
    useReducedMotion: () => false,
  }
})

// ─── solito/navigation ───────────────────────────────────────────────────────
vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: pushSpy, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/journal/celebration',
  useLink: () => ({}),
  useParams: () => ({}),
  useSearchParams: () => ({}),
}))

// ─── useNavigateHome ─────────────────────────────────────────────────────────
vi.mock('app/features/navigation/useNavigateHome', () => ({
  useNavigateHome: () => navigateHomeSpy,
}))

// ─── app/state/store ─────────────────────────────────────────────────────────
vi.mock('app/state/store', () => ({
  store$: {
    lastSavedFlow: nodes.lastSavedFlow,
    session: { isAuthenticated: nodes.isAuthenticated },
    views: {
      entryByDate: () => nodes.entryByDate,
      statsByDate: () => nodes.statsByDate,
      streak: nodes.streak,
    },
  },
  ephemeral$: { surfacedUnlockMilestones: nodes.surfaced },
  clearLastSavedFlow: clearLastSavedFlowSpy,
  clearActiveFlow: clearActiveFlowSpy,
  markUnlockSurfaced: markUnlockSurfacedSpy,
}))

// ─── app/state/streak ────────────────────────────────────────────────────────
vi.mock('app/state/streak', () => ({ MILESTONES: [7, 30, 100] as readonly number[] }))

// ─── @legendapp/state/react — identity-dispatched use$() ─────────────────────
vi.mock('@legendapp/state/react', () => ({
  use$: (node: any) => {
    if (node === nodes.lastSavedFlow) return mockState.lastSavedFlow
    if (node === nodes.isAuthenticated) return mockState.isAuthenticated
    if (node === nodes.entryByDate) return mockState.todayEntry
    if (node === nodes.statsByDate) return { totalWords: mockState.dayTotalWords }
    if (node === nodes.streak) return mockState.streak
    if (node === nodes.surfaced) return new Set<number>()
    return null
  },
}))

// ─── UnlockNotification stub ─────────────────────────────────────────────────
vi.mock('app/features/streak/UnlockNotification', () => ({
  UnlockNotification: () =>
    React.createElement('div', { 'data-testid': 'unlock-notification' }, 'unlock'),
}))

// ─── Editor stub — stands in for the read-only re-read surface ───────────────
vi.mock('../components/Editor', () => ({
  Editor: ({ readOnly, initialContent }: { readOnly?: boolean; initialContent?: string }) =>
    React.createElement('div', {
      'data-testid': 'saved-flow',
      'data-readonly': String(readOnly ?? false),
      'data-content': initialContent ?? '',
    }),
}))

// ─── Import under test ───────────────────────────────────────────────────────
import { CelebrationScreen } from '../CelebrationScreen'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const TODAY = getTodayJournalDayString()
const TIMESTAMP = `${TODAY}T12:00:00.000Z`
const CONTENT = 'The river was high this morning and the light came in sideways.'

/** Renders, then runs the 200ms entrance timer so the variant body is mounted. */
function renderCelebration() {
  const utils = render(React.createElement(CelebrationScreen))
  act(() => {
    vi.advanceTimersByTime(250)
  })
  return utils
}

function setQuieterFlow(wordCount = 25) {
  mockState.lastSavedFlow = { content: CONTENT, wordCount, timestamp: TIMESTAMP }
  mockState.dayTotalWords = wordCount
}

function setHandoffFlow() {
  mockState.lastSavedFlow = { content: CONTENT, wordCount: 500, timestamp: TIMESTAMP }
  mockState.todayEntry = { flows: [{ id: 'f1', timestamp: TIMESTAMP, wordCount: 500 }] }
  mockState.dayTotalWords = 500
  mockState.streak = { currentStreak: 3, unlockTokensEarned: 0 }
}

/** Text content of the whole screen, whitespace-normalised. */
function screenText() {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ')
}

beforeEach(() => {
  vi.useFakeTimers()
  mockState.lastSavedFlow = null
  mockState.isAuthenticated = true
  mockState.todayEntry = null
  mockState.dayTotalWords = 0
  mockState.streak = { currentStreak: 0, unlockTokensEarned: 0 }
  navigateHomeSpy.mockClear()
  clearLastSavedFlowSpy.mockClear()
  clearActiveFlowSpy.mockClear()
  pushSpy.mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// =============================================================================
// Quieter variant
// =============================================================================
describe('quieter variant — word counts', () => {
  it("headline is this flow's count, not a day total", () => {
    setQuieterFlow(25)
    renderCelebration()

    expect(screenText()).toContain('25 words.')
    expect(screenText()).not.toContain('25 words today')
  })

  it("shows the day's running total as its own line when it differs from the flow", () => {
    setQuieterFlow(25)
    mockState.dayTotalWords = 180
    renderCelebration()

    const text = screenText()
    expect(text).toContain('25 words.')
    expect(text).toContain('180 words today.')
  })

  it("omits the day total when this flow is all of today's writing", () => {
    setQuieterFlow(25)
    renderCelebration()

    expect(screenText()).not.toContain('words today')
  })
})

describe('quieter variant — the saved flow is re-readable', () => {
  it('renders the saved flow read-only below the summary', () => {
    setQuieterFlow(25)
    renderCelebration()

    const editor = screen.getByTestId('saved-flow')
    expect(editor.getAttribute('data-readonly')).toBe('true')
    expect(editor.getAttribute('data-content')).toBe(CONTENT)
  })

  it('omits the re-read section when the saved flow has no content', () => {
    mockState.lastSavedFlow = { content: '   ', wordCount: 0, timestamp: TIMESTAMP }
    renderCelebration()

    expect(screen.queryByTestId('saved-flow')).toBeNull()
  })
})

describe('quieter variant — dismissal is explicit', () => {
  it('does not auto-dismiss', () => {
    setQuieterFlow(25)
    renderCelebration()

    act(() => {
      vi.advanceTimersByTime(10_000)
    })

    expect(navigateHomeSpy).not.toHaveBeenCalled()
    expect(clearLastSavedFlowSpy).not.toHaveBeenCalled()
  })

  it('offers a Done control that clears the flow and goes home', () => {
    setQuieterFlow(25)
    renderCelebration()

    fireEvent.click(screen.getByRole('button', { name: /done/i }))

    expect(clearLastSavedFlowSpy).toHaveBeenCalledTimes(1)
    expect(navigateHomeSpy).toHaveBeenCalledTimes(1)
  })
})

// =============================================================================
// Handoff variant — unchanged behaviour
// =============================================================================
describe('handoff variant', () => {
  it('keeps the serif count, the streak day, Visit and Done', () => {
    setHandoffFlow()
    renderCelebration()

    const text = screenText()
    expect(text).toContain('500 words.')
    expect(text).toContain('Day 3.')
    expect(text).toContain('The Collective is open.')
    expect(screen.getByRole('button', { name: /visit/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /done/i })).toBeTruthy()
  })

  it('still renders the saved flow for re-reading', () => {
    setHandoffFlow()
    renderCelebration()

    expect(screen.getByTestId('saved-flow').getAttribute('data-content')).toBe(CONTENT)
  })

  it('Visit opens the Collective', () => {
    setHandoffFlow()
    renderCelebration()

    fireEvent.click(screen.getByRole('button', { name: /visit/i }))

    expect(clearLastSavedFlowSpy).toHaveBeenCalledTimes(1)
    expect(pushSpy).toHaveBeenCalledWith('/collective')
  })

  it("shows the day's total alongside the flow count when earlier flows exist", () => {
    setHandoffFlow()
    mockState.dayTotalWords = 900
    renderCelebration()

    const text = screenText()
    expect(text).toContain('500 words.')
    expect(text).toContain('900 words today.')
  })
})

// =============================================================================
// Guard: mounting without a saved flow
// =============================================================================
describe('no saved flow', () => {
  it('navigates home instead of rendering an empty summary', () => {
    mockState.lastSavedFlow = null
    renderCelebration()

    expect(navigateHomeSpy).toHaveBeenCalled()
    expect(screen.queryByTestId('saved-flow')).toBeNull()
  })
})
