// @vitest-environment happy-dom
// Toggle behavior tests for DayViewScreen — Linear ↔ Calendar view-mode toggle.
// RED phase — toggle and CalendarMonthView do not exist yet; tests will fail.

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted() — spies for mock factories
// ─────────────────────────────────────────────────────────────────────────────
const { pushSpy, mockAllEntries, mockEntriesSortedObservable } = vi.hoisted(() => {
  const mockAllEntries = { value: [] as any[] }

  const mockEntriesSortedObservable = {
    get: () => mockAllEntries.value,
    peek: () => mockAllEntries.value,
  }

  return {
    pushSpy: vi.fn(),
    mockAllEntries,
    mockEntriesSortedObservable,
  }
})

// ─── @my/ui ──────────────────────────────────────────────────────────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const {
      testID,
      onPress,
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

  const Dialog = ({ children, open }: any) => {
    if (!open) return null
    return ReactModule.createElement('div', { role: 'dialog' }, children)
  }
  Dialog.Portal = ({ children }: any) => ReactModule.createElement(ReactModule.Fragment, null, children)
  Dialog.Overlay = () => null
  Dialog.Content = ({ children }: any) => ReactModule.createElement('div', {}, children)
  Dialog.Title = ({ children }: any) => ReactModule.createElement('h2', {}, children)
  Dialog.Description = ({ children }: any) => ReactModule.createElement('p', {}, children)
  Dialog.Close = ({ children }: any) => ReactModule.createElement(ReactModule.Fragment, null, children)

  return {
    AnimatePresence: ({ children }: any) => ReactModule.createElement(ReactModule.Fragment, null, children),
    ScrollView: passthrough('div'),
    YStack: passthrough('div'),
    XStack: passthrough('div'),
    View: passthrough('div'),
    Text: passthrough('span'),
    Dialog,
    ExpandingLineButton,
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

// ─── app/state/store ─────────────────────────────────────────────────────────
vi.mock('app/state/store', () => {
  const store$ = {
    views: {
      allEntriesSorted: () => mockEntriesSortedObservable,
      entriesByMonth: (_month: string) => ({
        get: () => [],
        peek: () => [],
      }),
    },
  }
  return {
    store$,
    deleteFlow: vi.fn(),
  }
})

// ─── @legendapp/state/react ──────────────────────────────────────────────────
vi.mock('@legendapp/state/react', () => ({
  use$: (observable: any) => {
    if (observable === mockEntriesSortedObservable) {
      return mockAllEntries.value
    }
    try {
      return observable?.get?.() ?? null
    } catch {
      return null
    }
  },
}))

// ─── app/state/date-utils ────────────────────────────────────────────────────
vi.mock('app/state/date-utils', () => ({
  getTodayJournalDayString: () => '2026-04-15',
}))

// ─── CalendarMonthView stub — keeps toggle tests focused on toggle behavior ──
vi.mock('../CalendarMonthView', () => ({
  CalendarMonthView: () =>
    React.createElement('div', { 'data-testid': 'calendar-stub' }),
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

// ─── Import under test ───────────────────────────────────────────────────────
import { DayViewScreen } from '../DayViewScreen'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function renderDayView() {
  return render(React.createElement(DayViewScreen))
}

function clickCalendarToggle() {
  fireEvent.click(screen.getByRole('button', { name: /calendar/i }))
}

function clickLinearToggle() {
  fireEvent.click(screen.getByRole('button', { name: /linear/i }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Test isolation
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  mockAllEntries.value = []
  pushSpy.mockClear()
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
// Toggle renders (AC 1)
// ─────────────────────────────────────────────────────────────────────────────
describe('View-mode toggle renders in DayViewScreen', () => {
  it('renders a "Linear" toggle button', () => {
    renderDayView()
    expect(screen.getByRole('button', { name: /linear/i })).toBeTruthy()
  })

  it('renders a "Calendar" toggle button', () => {
    renderDayView()
    expect(screen.getByRole('button', { name: /calendar/i })).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Initial state — linear mode is default (AC 1, 2, 3)
// ─────────────────────────────────────────────────────────────────────────────
describe('Default view mode is linear (preserves v1 behavior)', () => {
  it('calendar stub is NOT in the DOM on initial render', () => {
    renderDayView()
    expect(screen.queryByTestId('calendar-stub')).toBeNull()
  })

  it('"Linear" button has aria-pressed="true" on initial render', () => {
    renderDayView()
    const linearBtn = screen.getByRole('button', { name: /linear/i })
    expect(linearBtn.getAttribute('aria-pressed')).toBe('true')
  })

  it('"Calendar" button has aria-pressed="false" on initial render', () => {
    renderDayView()
    const calendarBtn = screen.getByRole('button', { name: /calendar/i })
    expect(calendarBtn.getAttribute('aria-pressed')).toBe('false')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Toggle to calendar mode (AC 4)
// ─────────────────────────────────────────────────────────────────────────────
describe('Tapping Calendar toggle switches to calendar mode', () => {
  it('CalendarMonthView stub appears after tapping Calendar', () => {
    renderDayView()
    clickCalendarToggle()
    expect(screen.getByTestId('calendar-stub')).toBeTruthy()
  })

  it('"Calendar" button has aria-pressed="true" after tapping Calendar', () => {
    renderDayView()
    clickCalendarToggle()
    expect(screen.getByRole('button', { name: /calendar/i }).getAttribute('aria-pressed')).toBe('true')
  })

  it('"Linear" button has aria-pressed="false" after tapping Calendar', () => {
    renderDayView()
    clickCalendarToggle()
    expect(screen.getByRole('button', { name: /linear/i }).getAttribute('aria-pressed')).toBe('false')
  })

  it('linear-mode empty state is NOT in the DOM after switching to calendar', () => {
    mockAllEntries.value = []
    renderDayView()
    clickCalendarToggle()
    expect(screen.queryByText(/river is dry/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Toggle back to linear mode (AC 3)
// ─────────────────────────────────────────────────────────────────────────────
describe('Tapping Linear toggle returns to linear mode', () => {
  it('CalendarMonthView stub is removed after toggling back to Linear', () => {
    renderDayView()
    clickCalendarToggle()
    expect(screen.getByTestId('calendar-stub')).toBeTruthy()
    clickLinearToggle()
    expect(screen.queryByTestId('calendar-stub')).toBeNull()
  })

  it('"Linear" button has aria-pressed="true" after toggling back', () => {
    renderDayView()
    clickCalendarToggle()
    clickLinearToggle()
    expect(screen.getByRole('button', { name: /linear/i }).getAttribute('aria-pressed')).toBe('true')
  })

  it('"Calendar" button has aria-pressed="false" after toggling back to Linear', () => {
    renderDayView()
    clickCalendarToggle()
    clickLinearToggle()
    expect(screen.getByRole('button', { name: /calendar/i }).getAttribute('aria-pressed')).toBe('false')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Linear list preserved verbatim (AC 3) — empty state smoke
// ─────────────────────────────────────────────────────────────────────────────
describe('Linear mode preserves existing entry list behavior', () => {
  it('renders the "river is dry" empty state when there are no entries in linear mode', () => {
    mockAllEntries.value = []
    renderDayView()
    // Default mode is linear — the empty-state copy should be present
    expect(screen.getByText(/river is dry/i)).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Page header and navigation preserved in both modes (AC 4)
// ─────────────────────────────────────────────────────────────────────────────
describe('Page header and WordLinkNav remain visible in both modes', () => {
  it('Past Entries heading is visible in linear mode', () => {
    renderDayView()
    expect(screen.getByText(/Past Entries/i)).toBeTruthy()
  })

  it('Past Entries heading is visible in calendar mode', () => {
    renderDayView()
    clickCalendarToggle()
    expect(screen.getByText(/Past Entries/i)).toBeTruthy()
  })

  it('WordLinkNav is visible in linear mode', () => {
    renderDayView()
    expect(screen.getByTestId('word-link-nav')).toBeTruthy()
  })

  it('WordLinkNav is visible in calendar mode', () => {
    renderDayView()
    clickCalendarToggle()
    expect(screen.getByTestId('word-link-nav')).toBeTruthy()
  })

  it('"Back to Home" link is visible in linear mode', () => {
    renderDayView()
    expect(screen.getByText(/Back to Home/i)).toBeTruthy()
  })

  it('"Back to Home" link is visible in calendar mode', () => {
    renderDayView()
    clickCalendarToggle()
    expect(screen.getByText(/Back to Home/i)).toBeTruthy()
  })
})
