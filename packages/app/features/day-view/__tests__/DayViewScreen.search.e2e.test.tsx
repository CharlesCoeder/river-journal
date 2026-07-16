// @vitest-environment happy-dom
/**
 * DayViewScreen.search.e2e.test.tsx — TDD red-phase E2E tests for local
 * full-text search over past entries, exercised end-to-end through the real
 * shared Past Entries surface (`DayViewScreen`).
 *
 * Red-phase contract: `DayViewScreen` currently renders only the Linear /
 * Calendar toggle — it has no search affordance yet, and the pure search
 * module it will depend on does not exist yet either. Every test below is
 * therefore expected to FAIL (missing elements / timeouts) before
 * implementation and PASS once the search entry point, debounced query,
 * results list, and read-only activation are wired up, per this repo's
 * established red-phase convention (see `DayViewScreen.toggle.test.tsx`,
 * `AppLockSettings.e2e.test.tsx`).
 *
 * Unlike the sibling `DayViewScreen.toggle.test.tsx`, this file deliberately
 * does NOT mock `app/state/store`: ownership scoping is a first-class
 * contract here (a previous account's local data must never leak into a new
 * identity's results), so these tests seed the REAL `entries$` / `flows$`
 * observables and the real `store$.session.userId`, exactly as
 * `streak.unlock.e2e.test.ts` does for its own store-level workflow. Only
 * true externals are mocked: `@my/ui`, `solito/navigation`, `react-native`
 * (Platform.OS, partially — everything else stays the real
 * `react-native-web` shim), `app/utils/supabase` (no-network proof), and the
 * heavy `CalendarMonthView` / `WordLinkNav` / `DeleteFlowDialog` /
 * read-only `Editor` children (irrelevant to this surface, stubbed to keep
 * failures attributable to the search feature itself).
 *
 * ASSUMED CONTRACT (the story pins the behavior precisely but not every
 * literal selector; chosen to mirror this repo's existing conventions —
 * flag for the implementer/QA to reconcile if a different shape is chosen):
 *   - The web/desktop always-visible input is a `role="textbox"` with an
 *     accessible name matching /search/i, testID `search-input`.
 *   - The mobile header affordance is a `role="button"` with an accessible
 *     name matching /search/i, testID `search-affordance-button`, that
 *     reveals/focuses the input when activated.
 *   - The web/desktop focus-search keyboard shortcut is `/` (one of the two
 *     chords the Dev Notes explicitly suggest — "Mod+F or /"), registered
 *     via `@tanstack/react-hotkeys` so it is NOT mocked here (real library).
 *   - The results region is a container with testID `search-results`;
 *     each matching day is a row with testID `search-result-row`,
 *     `role="button"`, keyboard-activatable via Enter (RN-Web pressables
 *     have no native Enter-to-click behavior, so this requires an explicit
 *     key handler — required because the "keyboard-activatable, visible
 *     focus ring" requirement has no native browser default to lean on).
 *   - The calm empty/no-match state is a testID `search-empty-state`.
 *   - The visible CSS focus ring itself is not asserted (not structurally
 *     observable in happy-dom); keyboard focusability is used as a proxy.
 *
 * Coverage map (requirement → describe block):
 *   - search affordance present, platform-branched, keyboard-operable
 *   - 300ms debounce + 2-char minimum gate the local search
 *   - case-insensitive matching scoped by the ownership rule
 *   - results grouped by day descending, with snippet + flow count
 *   - activating a result opens that day read-only inline, no new route
 *   - zero network requests on the search path
 *   - stays responsive against a large corpus (E2E sanity proxy; the strict
 *     latency budget on the underlying pure function is enforced by the
 *     dedicated state-level performance test, not duplicated here)
 *   - calm, spinner-free empty/no-match states
 *
 * Out of scope for this file (not user-workflow requirements):
 *   - the pure function's own unit-test coverage, and the project's
 *     typecheck/build/lint/boundary-grep hygiene gate, describe the test
 *     suite and the repo gate themselves rather than an observable user
 *     workflow — verified by the state-level unit suite and the regression
 *     gate instead.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted() — spies and mutable state for mock factories
// ─────────────────────────────────────────────────────────────────────────────
const { pushSpy, mockPlatform, rpcMock, fromMock } = vi.hoisted(() => ({
  pushSpy: vi.fn(),
  mockPlatform: { OS: 'web' as 'web' | 'ios' | 'android' },
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}))

// ─── react-native — partial mock: only Platform.OS is faked, everything
// else (View/Animated/StyleSheet etc.) stays the real react-native-web shim
// this repo's vitest config already aliases 'react-native' to. ─────────────
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>()
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return mockPlatform.OS
      },
    },
  }
})

// ─── app/utils/supabase — no-network proof + keeps the real store
// module import from touching a real Supabase client. ──────────────────────
vi.mock('app/utils/supabase', () => ({
  supabase: { rpc: rpcMock, from: fromMock },
}))

// ─── @my/ui — passthrough preserving testID/aria/onPress, plus an Input
// (testID/value/onChangeText contract, mirroring E2EPasswordForm / the
// AppLockSettings.e2e.test.tsx Input mock). ─────────────────────────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const {
      testID,
      onPress,
      onKeyPress,
      'aria-label': ariaLabel,
      'aria-pressed': ariaPressed,
      ...rest
    } = props
    return {
      ...rest,
      ...(testID ? { 'data-testid': testID } : {}),
      ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      ...(ariaPressed !== undefined ? { 'aria-pressed': String(ariaPressed) } : {}),
      ...(onPress ? { onClick: onPress } : {}),
      ...(onKeyPress ? { onKeyDown: onKeyPress } : {}),
    }
  }

  const passthrough = (tagName: keyof HTMLElementTagNameMap) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(tagName, mapProps(props), children)
    Component.displayName = tagName
    return Component
  }

  const ExpandingLineButton = ({ children, onPress, onKeyPress, testID, ...props }: any) =>
    ReactModule.createElement(
      'button',
      { ...mapProps({ onPress, onKeyPress, testID, ...props }), type: 'button' },
      children
    )

  const Input = ({ testID, value, onChangeText, 'aria-label': ariaLabel, ...props }: any) =>
    ReactModule.createElement('input', {
      'data-testid': testID,
      value,
      role: 'textbox',
      'aria-label': ariaLabel,
      onChange: (e: any) => onChangeText?.(e.target.value),
      onKeyDown: props.onKeyPress,
      type: 'text',
    })

  const Dialog = ({ children, open }: any) => {
    if (!open) return null
    return ReactModule.createElement('div', { role: 'dialog' }, children)
  }
  Dialog.Portal = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)
  Dialog.Overlay = () => null
  Dialog.Content = ({ children }: any) => ReactModule.createElement('div', {}, children)
  Dialog.Title = ({ children }: any) => ReactModule.createElement('h2', {}, children)
  Dialog.Description = ({ children }: any) => ReactModule.createElement('p', {}, children)
  Dialog.Close = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)

  return {
    AnimatePresence: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    ScrollView: passthrough('div'),
    YStack: passthrough('div'),
    XStack: passthrough('div'),
    View: passthrough('div'),
    Text: passthrough('span'),
    Dialog,
    ExpandingLineButton,
    Input,
    useReducedMotion: () => false,
    isWeb: true,
  }
})

// ─── solito/navigation ───────────────────────────────────────────────────────
vi.mock('solito/navigation', () => ({
  useRouter: () => ({
    push: pushSpy,
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/day-view',
  useLink: () => ({}),
  useParams: () => ({}),
  useSearchParams: () => ({}),
}))

// ─── CalendarMonthView stub — irrelevant to search; keeps failures
// attributable to the search feature. ────────────────────────────────────────
vi.mock('../CalendarMonthView', () => ({
  CalendarMonthView: () => React.createElement('div', { 'data-testid': 'calendar-stub' }),
}))

// ─── DeleteFlowDialog stub ───────────────────────────────────────────────────
vi.mock('./components/DeleteFlowDialog', () => ({
  DeleteFlowDialog: () => null,
}))
vi.mock('../components/DeleteFlowDialog', () => ({
  DeleteFlowDialog: () => null,
}))

// ─── WordLinkNav stub ─────────────────────────────────────────────────────────
vi.mock('app/features/navigation/WordLinkNav', () => ({
  WordLinkNav: () => React.createElement('nav', { 'data-testid': 'word-link-nav' }),
}))

// ─── Read-only Editor stub — mirrors CalendarMonthView.test.tsx's contract so
// the same reuse (joinFlowsForReader + <Editor readOnly />) is observable
// regardless of which component search reuses it through. ──────────────────
vi.mock('app/features/journal/components/Editor', () => ({
  Editor: ({ readOnly, initialContent }: { readOnly?: boolean; initialContent?: string }) =>
    React.createElement('div', {
      'data-testid': 'editor-readonly',
      'data-read-only': String(readOnly ?? false),
      'data-initial-content': initialContent ?? '',
    }),
}))

// ─── Import under test — real store, real use$, real search wiring once it
// exists. ─────────────────────────────────────────────────────────────────
import { DayViewScreen } from '../DayViewScreen'
import { store$ } from 'app/state/store'
import { entries$ } from 'app/state/entries'
import { flows$ } from 'app/state/flows'

// ─────────────────────────────────────────────────────────────────────────────
// Seed helpers — build raw Entry/Flow records (not DailyEntryView) so the
// real `store$.views.allEntriesSorted()` computed joins them, exactly as
// production data flows.
// ─────────────────────────────────────────────────────────────────────────────
const CURRENT_USER = 'user-current'
const OTHER_USER = 'user-other'

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

function makeEntryAndFlow(
  date: string,
  content: string,
  userId: string | null,
  wordCount = content.split(/\s+/).filter(Boolean).length
) {
  const entryId = nextId('entry')
  const flowId = nextId('flow')
  return {
    entry: {
      id: entryId,
      entryDate: date,
      lastModified: `${date}T12:00:00Z`,
      user_id: userId,
      local_session_id: 'test-session',
    },
    flow: {
      id: flowId,
      dailyEntryId: entryId,
      timestamp: `${date}T12:00:00Z`,
      content,
      wordCount,
      user_id: userId,
      local_session_id: 'test-session',
    },
  }
}

/** Adds an extra flow (same day, same owner) to an already-seeded entry — used to pad flow counts. */
function extraFlow(entryId: string, date: string, content: string, userId: string | null) {
  const flowId = nextId('flow')
  return {
    id: flowId,
    dailyEntryId: entryId,
    timestamp: `${date}T18:00:00Z`,
    content,
    wordCount: content.split(/\s+/).filter(Boolean).length,
    user_id: userId,
    local_session_id: 'test-session',
  }
}

function seedStore(
  seeds: ReturnType<typeof makeEntryAndFlow>[],
  extraFlows: ReturnType<typeof extraFlow>[] = []
) {
  const entriesObj: Record<string, any> = {}
  const flowsObj: Record<string, any> = {}
  for (const { entry, flow } of seeds) {
    entriesObj[entry.id] = entry
    flowsObj[flow.id] = flow
  }
  for (const flow of extraFlows) {
    flowsObj[flow.id] = flow
  }
  entries$.set(entriesObj)
  flows$.set(flowsObj)
}

function renderDayView() {
  return render(React.createElement(DayViewScreen))
}

function getSearchInput(): HTMLElement {
  return screen.getByRole('textbox', { name: /search/i })
}

function queryResultsContainer() {
  return screen.queryByTestId('search-results')
}

function getResultRows() {
  return screen.getAllByTestId('search-result-row')
}

async function typeQuery(query: string) {
  const input = getSearchInput()
  fireEvent.change(input, { target: { value: query } })
}

async function settleDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(320)
    await Promise.resolve()
  })
}

function expectNoSpinner() {
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(document.querySelector('[data-testid*="spinner" i]')).toBeNull()
  expect(document.querySelector('[data-testid*="loading" i]')).toBeNull()
}

// ─────────────────────────────────────────────────────────────────────────────
// Test isolation
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  mockPlatform.OS = 'web'
  pushSpy.mockClear()
  rpcMock.mockClear()
  fromMock.mockClear()
  idCounter = 0
  entries$.set({})
  flows$.set({})
  store$.session.userId.set(CURRENT_USER)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// ═════════════════════════════════════════════════════════════════════════
// Search affordance present, platform-branched, keyboard-operable
// ═════════════════════════════════════════════════════════════════════════
describe('A search affordance is present on the Past Entries surface on every platform', () => {
  it('web/desktop: an always-visible inline search input is present', () => {
    mockPlatform.OS = 'web'
    renderDayView()
    expect(getSearchInput()).toBeTruthy()
  })

  it('mobile: the search input is not immediately visible; a header search affordance is present instead', () => {
    mockPlatform.OS = 'ios'
    renderDayView()
    expect(screen.queryByRole('textbox', { name: /search/i })).toBeNull()
    expect(screen.getByRole('button', { name: /search/i })).toBeTruthy()
  })

  it('mobile: activating the header search affordance reveals and focuses the input', () => {
    mockPlatform.OS = 'ios'
    renderDayView()
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    const input = getSearchInput()
    expect(input).toBeTruthy()
    expect(document.activeElement).toBe(input)
  })

  it('web/desktop: a keyboard shortcut focuses the search input from anywhere on the surface', () => {
    mockPlatform.OS = 'web'
    renderDayView()
    const input = getSearchInput()
    expect(document.activeElement).not.toBe(input)
    fireEvent.keyDown(document.body, { key: '/', code: 'Slash' })
    expect(document.activeElement).toBe(input)
  })

  it('web/desktop: the search input is keyboard-focusable (focus-ring affordance)', () => {
    mockPlatform.OS = 'web'
    renderDayView()
    const input = getSearchInput()
    act(() => input.focus())
    expect(document.activeElement).toBe(input)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 300ms debounce + 2-char minimum gate the local search
// ═════════════════════════════════════════════════════════════════════════
describe('A query of >= 2 characters, debounced 300ms, produces results from local search', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    seedStore([makeEntryAndFlow('2026-04-10', 'notes about the river current', CURRENT_USER)])
  })

  it('a 1-character query never produces a results region, even after the debounce window elapses', async () => {
    renderDayView()
    await typeQuery('r')
    await settleDebounce()
    expect(queryResultsContainer()).toBeNull()
  })

  it('a >=2-character query does NOT produce results before the debounce settles', async () => {
    renderDayView()
    await typeQuery('river')
    await act(async () => {
      vi.advanceTimersByTime(100)
      await Promise.resolve()
    })
    expect(queryResultsContainer()).toBeNull()
  })

  it('a >=2-character query produces results once the 300ms debounce settles', async () => {
    renderDayView()
    await typeQuery('river')
    await settleDebounce()
    expect(queryResultsContainer()).toBeTruthy()
    expect(getResultRows().length).toBeGreaterThan(0)
  })

  it('clearing the query after results are shown restores the normal Linear/Calendar view with no flash', async () => {
    renderDayView()
    await typeQuery('river')
    await settleDebounce()
    expect(queryResultsContainer()).toBeTruthy()

    await typeQuery('')
    await settleDebounce()
    expect(queryResultsContainer()).toBeNull()
    // The default Linear/Calendar toggle is back in control of the view.
    expect(screen.getByRole('button', { name: /linear/i })).toBeTruthy()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Case-insensitive matching scoped by the ownership rule
// ═════════════════════════════════════════════════════════════════════════
describe('Matching is case-insensitive and scoped by the ownership rule', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('matches regardless of query/content case', async () => {
    seedStore([makeEntryAndFlow('2026-04-10', 'a note about the RIVER at dawn', CURRENT_USER)])
    renderDayView()
    await typeQuery('river')
    await settleDebounce()
    expect(getResultRows().length).toBe(1)
  })

  it('excludes an entry authored by a DIFFERENT, non-null identity', async () => {
    seedStore([
      makeEntryAndFlow('2026-04-10', 'mine: quietmarkertoken content', CURRENT_USER),
      makeEntryAndFlow('2026-04-09', 'foreign: quietmarkertoken content', OTHER_USER),
    ])
    renderDayView()
    await typeQuery('quietmarkertoken')
    await settleDebounce()
    const rows = getResultRows()
    expect(rows.length).toBe(1)
    expect(within(rows[0]!).queryByText(/foreign/i)).toBeNull()
  })

  it('includes anonymous local data (user_id null) regardless of the current identity', async () => {
    seedStore([makeEntryAndFlow('2026-04-08', 'anonymous quietmarkertoken content', null)])
    renderDayView()
    await typeQuery('quietmarkertoken')
    await settleDebounce()
    expect(getResultRows().length).toBe(1)
  })

  it('when signed out, excludes account-owned data but still includes anonymous data', async () => {
    store$.session.userId.set(null)
    seedStore([
      makeEntryAndFlow('2026-04-10', 'account-owned quietmarkertoken content', OTHER_USER),
      makeEntryAndFlow('2026-04-08', 'anonymous quietmarkertoken content', null),
    ])
    renderDayView()
    await typeQuery('quietmarkertoken')
    await settleDebounce()
    const rows = getResultRows()
    expect(rows.length).toBe(1)
    expect(within(rows[0]!).queryByText(/account-owned/i)).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Results grouped by day descending, with snippet + flow count
// ═════════════════════════════════════════════════════════════════════════
describe('Results are grouped by date descending, with a snippet and the day flow count', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('multiple matching days render as separate rows ordered newest-first', async () => {
    seedStore([
      makeEntryAndFlow('2026-04-08', 'earliest riverbank walk', CURRENT_USER),
      makeEntryAndFlow('2026-04-12', 'latest riverbank walk', CURRENT_USER),
      makeEntryAndFlow('2026-04-10', 'middle riverbank walk', CURRENT_USER),
    ])
    renderDayView()
    await typeQuery('riverbank')
    await settleDebounce()

    const rows = getResultRows()
    expect(rows.length).toBe(3)
    expect(within(rows[0]!).getByText(/latest/i)).toBeTruthy()
    expect(within(rows[1]!).getByText(/middle/i)).toBeTruthy()
    expect(within(rows[2]!).getByText(/earliest/i)).toBeTruthy()
  })

  it('each row shows a snippet containing the matched text', async () => {
    seedStore([
      makeEntryAndFlow('2026-04-10', 'a long passage about a distinctivephrase here', CURRENT_USER),
    ])
    renderDayView()
    await typeQuery('distinctivephrase')
    await settleDebounce()
    const [row] = getResultRows()
    expect(within(row!).getByText(/distinctivephrase/i)).toBeTruthy()
  })

  it("each row shows the day's total flow count after ownership filtering", async () => {
    const { entry, flow } = makeEntryAndFlow(
      '2026-04-10',
      'first flow marktoken content',
      CURRENT_USER
    )
    const second = extraFlow(entry.id, '2026-04-10', 'second flow content', CURRENT_USER)
    const foreign = extraFlow(entry.id, '2026-04-10', 'foreign flow content', OTHER_USER)
    seedStore([{ entry, flow }], [second, foreign])

    renderDayView()
    await typeQuery('marktoken')
    await settleDebounce()

    const [row] = getResultRows()
    // Day has 3 raw flows but only 2 survive ownership filtering (current + anonymous rule).
    expect(row!.textContent).toMatch(/2/)
    expect(row!.textContent).not.toMatch(/3/)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Activating a result opens that day read-only inline, no new route
// ═════════════════════════════════════════════════════════════════════════
describe('Activating a result opens that day read-only via the existing inline reader, no new route', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    seedStore([makeEntryAndFlow('2026-04-10', 'a passage about riverlight at dusk', CURRENT_USER)])
  })

  it('the read-only Editor is NOT mounted before a result is activated', async () => {
    renderDayView()
    await typeQuery('riverlight')
    await settleDebounce()
    expect(screen.queryByTestId('editor-readonly')).toBeNull()
  })

  it("clicking a result row mounts the existing read-only Editor with that day's joined flow content", async () => {
    renderDayView()
    await typeQuery('riverlight')
    await settleDebounce()
    const [row] = getResultRows()
    fireEvent.click(row!)

    const editor = screen.getByTestId('editor-readonly')
    expect(editor.getAttribute('data-read-only')).toBe('true')
    expect(editor.getAttribute('data-initial-content')).toMatch(/riverlight/i)
  })

  it('activating a result row does NOT navigate to a new route', async () => {
    renderDayView()
    await typeQuery('riverlight')
    await settleDebounce()
    const [row] = getResultRows()
    fireEvent.click(row!)
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('a result row is activatable via keyboard (Enter) after receiving focus', async () => {
    renderDayView()
    await typeQuery('riverlight')
    await settleDebounce()
    const [row] = getResultRows()
    act(() => row!.focus())
    expect(document.activeElement).toBe(row)
    fireEvent.keyDown(row!, { key: 'Enter', code: 'Enter' })
    expect(screen.getByTestId('editor-readonly')).toBeTruthy()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Zero network requests on the search path
// ═════════════════════════════════════════════════════════════════════════
describe('Search fires zero network requests under any condition, including offline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('running a full search query touches neither the Supabase client nor the global fetch', async () => {
    const fetchSpy = vi.fn()
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    seedStore([makeEntryAndFlow('2026-04-10', 'a note about offline currents', CURRENT_USER)])
    renderDayView()
    await typeQuery('offline')
    await settleDebounce()
    expect(getResultRows().length).toBeGreaterThan(0)

    expect(rpcMock).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()

    globalThis.fetch = originalFetch
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Stays responsive against a large corpus (E2E sanity proxy)
// ═════════════════════════════════════════════════════════════════════════
describe('Search stays responsive end-to-end against a large corpus', () => {
  it('a ~1,000-entry / ~500-word corpus produces visible results within a generous post-debounce window', async () => {
    // Real timers here — this measures actual wall-clock latency of the full
    // user-facing workflow (typing → debounce → search → DOM update), not
    // the pure function in isolation. The strict 200ms budget on `searchFlows`
    // itself is covered by the dedicated state-level performance test; this
    // is a coarse "does the UI ever visibly hang" sanity bound with generous
    // headroom over the 300ms debounce for jsdom/RTL overhead.
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ')
    const seeds = Array.from({ length: 999 }, (_, i) => {
      const date = new Date(Date.UTC(2023, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)
      return makeEntryAndFlow(date, words, CURRENT_USER)
    })
    seeds.push(makeEntryAndFlow('2026-04-15', `${words} distinctperfmarker ${words}`, CURRENT_USER))

    seedStore(seeds)
    renderDayView()

    const start = performance.now()
    await typeQuery('distinctperfmarker')
    await waitFor(
      () => {
        expect(queryResultsContainer()).toBeTruthy()
      },
      { timeout: 2000 }
    )
    const elapsed = performance.now() - start

    // 300ms debounce + generous margin for a 1,000-entry scan and DOM commit
    // under jsdom — well above the strict 200ms pure-function budget, but
    // enough to catch a gross regression (e.g. an accidental O(n^2) path).
    expect(elapsed).toBeLessThan(1200)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Calm, spinner-free empty/no-match states
// ═════════════════════════════════════════════════════════════════════════
describe('Empty/no-match/short-query states use calm copy, with no spinner anywhere', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('an empty corpus with a >=2-char query shows the calm empty state rather than a blank screen', async () => {
    renderDayView()
    await typeQuery('anything')
    await settleDebounce()
    expect(screen.getByTestId('search-empty-state')).toBeTruthy()
    expect(screen.queryAllByTestId('search-result-row').length).toBe(0)
  })

  it('a >=2-char query with no matches against a non-empty corpus shows the calm empty state', async () => {
    seedStore([makeEntryAndFlow('2026-04-10', 'a note about mountains', CURRENT_USER)])
    renderDayView()
    await typeQuery('oceanbreeze')
    await settleDebounce()
    expect(screen.getByTestId('search-empty-state')).toBeTruthy()
  })

  it('no spinner or loading indicator ever appears on the search path', async () => {
    seedStore([makeEntryAndFlow('2026-04-10', 'a note about the tide', CURRENT_USER)])
    renderDayView()
    expectNoSpinner()
    await typeQuery('tide')
    expectNoSpinner()
    await settleDebounce()
    expect(getResultRows().length).toBeGreaterThan(0)
    expectNoSpinner()
  })
})
