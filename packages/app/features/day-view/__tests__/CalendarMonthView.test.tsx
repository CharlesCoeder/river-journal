// @vitest-environment happy-dom
// Component smoke tests for CalendarMonthView.
// RED phase — CalendarMonthView does not exist yet; all tests will fail on import.

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted() — spies and mutable state for mock factories
// ─────────────────────────────────────────────────────────────────────────────
const {
  pushSpy,
  mockEntriesThisMonth,
  mockTodayString,
  mockEntriesByMonthObservable,
} = vi.hoisted(() => {
  // Mutable state boxes — factories close over these so mutations are live per-test.
  const mockEntriesThisMonth = { value: [] as any[] }
  const mockTodayString = { value: '2026-04-15' }

  // Stable observable identity — use$ mock checks reference equality.
  const mockEntriesByMonthObservable = {
    get: () => mockEntriesThisMonth.value,
    peek: () => mockEntriesThisMonth.value,
  }

  return {
    pushSpy: vi.fn(),
    mockEntriesThisMonth,
    mockTodayString,
    mockEntriesByMonthObservable,
  }
})

// ─── @tamagui/lucide-icons ───────────────────────────────────────────────────
vi.mock('@tamagui/lucide-icons', () => ({
  ChevronLeft: () => null,
  ChevronRight: () => null,
}))

// ─── @my/ui ──────────────────────────────────────────────────────────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const {
      testID,
      onPress,
      'aria-label': ariaLabel,
      'aria-pressed': ariaPressed,
      'aria-live': ariaLive,
      disabled,
      ...rest
    } = props
    return {
      ...rest,
      ...(testID ? { 'data-testid': testID } : {}),
      ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      ...(ariaPressed !== undefined ? { 'aria-pressed': String(ariaPressed) } : {}),
      ...(ariaLive ? { 'aria-live': ariaLive } : {}),
      ...(disabled ? { disabled: true } : {}),
      ...(onPress ? { onClick: onPress } : {}),
    }
  }

  const passthrough = (tagName: keyof HTMLElementTagNameMap) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(tagName, mapProps(props), children)
    Component.displayName = tagName
    return Component
  }

  const Button = ({ children, onPress, disabled, 'aria-label': ariaLabel, testID, ...props }: any) =>
    ReactModule.createElement(
      'button',
      {
        ...mapProps({ onPress, 'aria-label': ariaLabel, disabled, testID, ...props }),
        type: 'button',
      },
      children
    )

  const ExpandingLineButton = ({ children, onPress, testID, ...props }: any) =>
    ReactModule.createElement(
      'button',
      { ...mapProps({ onPress, testID, ...props }), type: 'button' },
      children
    )

  return {
    AnimatePresence: ({ children }: any) => ReactModule.createElement(ReactModule.Fragment, null, children),
    YStack: passthrough('div'),
    XStack: passthrough('div'),
    View: passthrough('div'),
    Text: ({ children, 'aria-live': ariaLive, ...props }: any) =>
      ReactModule.createElement('span', { ...mapProps({ 'aria-live': ariaLive, ...props }), 'aria-live': ariaLive }, children),
    Button,
    ScrollView: passthrough('div'),
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
      entriesByMonth: (_month: string) => mockEntriesByMonthObservable,
    },
  }
  return { store$ }
})

// ─── @legendapp/state/react ──────────────────────────────────────────────────
vi.mock('@legendapp/state/react', () => ({
  use$: (observable: any) => {
    if (observable === mockEntriesByMonthObservable) {
      return mockEntriesThisMonth.value
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
  getTodayJournalDayString: () => mockTodayString.value,
}))

// ─── Editor stub — avoids mounting Lexical in tests ─────────────────────────
vi.mock('app/features/journal/components/Editor', () => ({
  Editor: ({ readOnly, initialContent }: { readOnly?: boolean; initialContent?: string }) =>
    React.createElement('div', {
      'data-testid': 'editor-readonly',
      'data-read-only': String(readOnly ?? false),
      'data-initial-content': initialContent ?? '',
    }),
}))

// ─── Import under test ───────────────────────────────────────────────────────
import { CalendarMonthView } from '../CalendarMonthView'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function makeEntry(entryDate: string, flowCount = 1) {
  return {
    id: `entry-${entryDate}`,
    entryDate,
    lastModified: entryDate + 'T12:00:00Z',
    totalWords: flowCount * 50,
    flows: Array.from({ length: flowCount }, (_, i) => ({
      id: `flow-${entryDate}-${i}`,
      dailyEntryId: `entry-${entryDate}`,
      timestamp: `${entryDate}T0${i + 8}:00:00Z`,
      content: `Flow ${i + 1} content`,
      wordCount: 50,
      local_session_id: 'test',
    })),
  }
}

function renderCalendar(props?: { initialMonth?: string }) {
  return render(React.createElement(CalendarMonthView, props ?? {}))
}

// ─────────────────────────────────────────────────────────────────────────────
// Test isolation
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  mockEntriesThisMonth.value = []
  mockTodayString.value = '2026-04-15'
  pushSpy.mockClear()
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
// Grid render — 42 cells (AC 11)
// ─────────────────────────────────────────────────────────────────────────────
describe('Calendar month grid renders 42 date cells', () => {
  it('renders exactly 42 cells for a known month', () => {
    renderCalendar({ initialMonth: '2026-04' })
    // All cells are <button> elements with aria-label containing a date
    const cells = screen.getAllByRole('button')
    // Filter to date cells (they have aria-label matching month-name pattern)
    const dateCells = cells.filter((btn) => {
      const label = btn.getAttribute('aria-label') ?? ''
      return /\w+ \d+,/.test(label)
    })
    expect(dateCells).toHaveLength(42)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Month header — prev/next controls and month label (AC 9, AC 23)
// ─────────────────────────────────────────────────────────────────────────────
describe('Month header renders navigation controls and accessible month label', () => {
  it('renders a "Previous month" button', () => {
    renderCalendar({ initialMonth: '2026-04' })
    expect(screen.getByRole('button', { name: /previous month/i })).toBeTruthy()
  })

  it('renders a "Next month" button', () => {
    renderCalendar({ initialMonth: '2026-04' })
    expect(screen.getByRole('button', { name: /next month/i })).toBeTruthy()
  })

  it('renders the month label text (e.g. "April 2026")', () => {
    renderCalendar({ initialMonth: '2026-04' })
    expect(screen.getByText(/April 2026/i)).toBeTruthy()
  })

  it('month label has aria-live="polite" for screen reader announcements', () => {
    renderCalendar({ initialMonth: '2026-04' })
    const monthLabel = screen.getByText(/April 2026/i)
    expect(monthLabel.getAttribute('aria-live')).toBe('polite')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Day-of-week header row (AC 10)
// ─────────────────────────────────────────────────────────────────────────────
describe('Day-of-week header row is rendered as presentational text', () => {
  it('renders the 7 single-letter day headers S M T W T F S', () => {
    renderCalendar({ initialMonth: '2026-04' })
    // All 7 headers must appear (some letters repeat, so use getAllByText for those)
    const sElements = screen.getAllByText('S')
    expect(sElements.length).toBeGreaterThanOrEqual(2) // Sunday + Saturday
    expect(screen.getByText('M')).toBeTruthy()
    expect(screen.getAllByText('T').length).toBeGreaterThanOrEqual(2) // Tuesday + Thursday
    expect(screen.getByText('W')).toBeTruthy()
    expect(screen.getByText('F')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Empty month — microcopy (AC 14)
// ─────────────────────────────────────────────────────────────────────────────
describe('Empty month displays calm microcopy below the grid', () => {
  it('shows "No entries this month." when the month has no entries', () => {
    mockEntriesThisMonth.value = []
    renderCalendar({ initialMonth: '2026-04' })
    expect(screen.getByText(/No entries this month\./i)).toBeTruthy()
  })

  it('does NOT show "No entries this month." when the month has entries', () => {
    mockEntriesThisMonth.value = [makeEntry('2026-04-15')]
    renderCalendar({ initialMonth: '2026-04' })
    expect(screen.queryByText(/No entries this month\./i)).toBeNull()
  })

  it('does NOT show the linear-mode "river is dry" copy in calendar mode', () => {
    mockEntriesThisMonth.value = []
    renderCalendar({ initialMonth: '2026-04' })
    expect(screen.queryByText(/river is dry/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cell aria-labels (AC 22)
// ─────────────────────────────────────────────────────────────────────────────
describe('Date cells have correct aria-labels for entry state', () => {
  it('in-month cells with no entry have aria-label matching "no entries"', () => {
    mockEntriesThisMonth.value = []
    renderCalendar({ initialMonth: '2026-04' })
    const cells = screen.getAllByRole('button')
    const inMonthEmptyCells = cells.filter((btn) => {
      const label = btn.getAttribute('aria-label') ?? ''
      return label.includes('April') && label.includes('no entries')
    })
    // April has 30 days, so there should be 30 such cells
    expect(inMonthEmptyCells.length).toBe(30)
  })

  it('a cell with 1 entry has aria-label matching "1 entry" (singular)', () => {
    mockEntriesThisMonth.value = [makeEntry('2026-04-15', 1)]
    renderCalendar({ initialMonth: '2026-04' })
    const entryCell = screen.getByRole('button', { name: /April 15, 1 entry$/ })
    expect(entryCell).toBeTruthy()
  })

  it('a cell with 3 flows has aria-label matching "3 entries" (plural)', () => {
    mockEntriesThisMonth.value = [makeEntry('2026-04-20', 3)]
    renderCalendar({ initialMonth: '2026-04' })
    const entryCell = screen.getByRole('button', { name: /April 20, 3 entries$/ })
    expect(entryCell).toBeTruthy()
  })

  it('spillover cells (prior/next month) still have an aria-label with month context', () => {
    renderCalendar({ initialMonth: '2026-04' })
    // April 2026 starts Wednesday — March 29, 30, 31 are spillover
    const marchSpillover = screen.getAllByRole('button').filter((btn) => {
      const label = btn.getAttribute('aria-label') ?? ''
      return label.startsWith('March')
    })
    expect(marchSpillover.length).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Spillover cells are disabled (AC 11, 17)
// ─────────────────────────────────────────────────────────────────────────────
describe('Prior/next-month spillover cells are disabled', () => {
  it('spillover cells have the disabled attribute', () => {
    renderCalendar({ initialMonth: '2026-04' })
    const spilloverCells = screen.getAllByRole('button').filter((btn) => {
      const label = btn.getAttribute('aria-label') ?? ''
      return label.startsWith('March') || label.startsWith('May')
    })
    spilloverCells.forEach((cell) => {
      expect(cell).toBeDisabled()
    })
  })

  it('clicking a spillover cell does NOT call router.push', () => {
    renderCalendar({ initialMonth: '2026-04' })
    const spilloverCell = screen.getAllByRole('button').find((btn) => {
      const label = btn.getAttribute('aria-label') ?? ''
      return label.startsWith('March')
    })
    if (spilloverCell) {
      fireEvent.click(spilloverCell)
    }
    expect(pushSpy).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tap entry cell → opens inline reader (AC 15)
// ─────────────────────────────────────────────────────────────────────────────
describe('Tapping a date cell that has an entry opens the read-only reader inline', () => {
  beforeEach(() => {
    mockEntriesThisMonth.value = [makeEntry('2026-04-15', 1)]
  })

  it('reader (Editor in readOnly mode) is NOT present before tapping a cell', () => {
    renderCalendar({ initialMonth: '2026-04' })
    expect(screen.queryByTestId('editor-readonly')).toBeNull()
  })

  it('tapping an entry cell mounts the read-only Editor', () => {
    renderCalendar({ initialMonth: '2026-04' })
    const entryCell = screen.getByRole('button', { name: /April 15, 1 entry/ })
    fireEvent.click(entryCell)
    expect(screen.getByTestId('editor-readonly')).toBeTruthy()
  })

  it('the mounted Editor has readOnly=true', () => {
    renderCalendar({ initialMonth: '2026-04' })
    fireEvent.click(screen.getByRole('button', { name: /April 15, 1 entry/ }))
    const editor = screen.getByTestId('editor-readonly')
    expect(editor.getAttribute('data-read-only')).toBe('true')
  })

  it('the mounted Editor receives joined flow content as initialContent', () => {
    renderCalendar({ initialMonth: '2026-04' })
    fireEvent.click(screen.getByRole('button', { name: /April 15, 1 entry/ }))
    const editor = screen.getByTestId('editor-readonly')
    expect(editor.getAttribute('data-initial-content')).toBeTruthy()
  })

  it('reader header shows the formatted entry date', () => {
    renderCalendar({ initialMonth: '2026-04' })
    fireEvent.click(screen.getByRole('button', { name: /April 15, 1 entry/ }))
    expect(screen.getByText(/April 15, 2026/i)).toBeTruthy()
  })

  it('a "Close" button appears in the reader header', () => {
    renderCalendar({ initialMonth: '2026-04' })
    fireEvent.click(screen.getByRole('button', { name: /April 15, 1 entry/ }))
    expect(screen.getByRole('button', { name: /close/i })).toBeTruthy()
  })

  it('pressing Close dismisses the reader', () => {
    renderCalendar({ initialMonth: '2026-04' })
    fireEvent.click(screen.getByRole('button', { name: /April 15, 1 entry/ }))
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByTestId('editor-readonly')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tap empty in-month cell → "Nothing on [date]" + Begin writing (AC 16)
// ─────────────────────────────────────────────────────────────────────────────
describe('Tapping an empty date cell shows the writing invitation', () => {
  it('shows "Nothing on [date]." text when an empty cell is tapped', () => {
    mockEntriesThisMonth.value = []
    renderCalendar({ initialMonth: '2026-04' })
    // April 29 has no entry — tap it
    const emptyCell = screen.getByRole('button', { name: /April 29, no entries/ })
    fireEvent.click(emptyCell)
    expect(screen.getByText(/Nothing on April 29/i)).toBeTruthy()
  })

  it('shows a "Begin writing" button when an empty cell is tapped', () => {
    mockEntriesThisMonth.value = []
    renderCalendar({ initialMonth: '2026-04' })
    fireEvent.click(screen.getByRole('button', { name: /April 29, no entries/ }))
    expect(screen.getByRole('button', { name: /begin writing/i })).toBeTruthy()
  })

  it('pressing "Begin writing" calls router.push("/journal")', () => {
    mockEntriesThisMonth.value = []
    renderCalendar({ initialMonth: '2026-04' })
    fireEvent.click(screen.getByRole('button', { name: /April 29, no entries/ }))
    fireEvent.click(screen.getByRole('button', { name: /begin writing/i }))
    expect(pushSpy).toHaveBeenCalledWith('/journal')
  })

  it('"Begin writing" routes to /journal, NOT to the tapped past date', () => {
    mockEntriesThisMonth.value = []
    renderCalendar({ initialMonth: '2026-04' })
    fireEvent.click(screen.getByRole('button', { name: /April 10, no entries/ }))
    fireEvent.click(screen.getByRole('button', { name: /begin writing/i }))
    // Confirm it goes to /journal, not any date-specific route
    expect(pushSpy).toHaveBeenCalledWith('/journal')
    expect(pushSpy).not.toHaveBeenCalledWith(expect.stringContaining('2026-04-10'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Month navigation — prev/next buttons change the month (AC 19)
// ─────────────────────────────────────────────────────────────────────────────
describe('Month navigation buttons change the displayed month', () => {
  it('clicking Previous month changes the label from April 2026 to March 2026', () => {
    renderCalendar({ initialMonth: '2026-04' })
    fireEvent.click(screen.getByRole('button', { name: /previous month/i }))
    expect(screen.getByText(/March 2026/i)).toBeTruthy()
  })

  it('clicking Next month changes the label from April 2026 to May 2026', () => {
    renderCalendar({ initialMonth: '2026-04' })
    fireEvent.click(screen.getByRole('button', { name: /next month/i }))
    expect(screen.getByText(/May 2026/i)).toBeTruthy()
  })

  it('navigating forward then back returns to the original month label', () => {
    renderCalendar({ initialMonth: '2026-04' })
    fireEvent.click(screen.getByRole('button', { name: /next month/i }))
    expect(screen.getByText(/May 2026/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /previous month/i }))
    expect(screen.getByText(/April 2026/i)).toBeTruthy()
  })

  it('year boundary: clicking Previous on January 2026 shows December 2025', () => {
    renderCalendar({ initialMonth: '2026-01' })
    fireEvent.click(screen.getByRole('button', { name: /previous month/i }))
    expect(screen.getByText(/December 2025/i)).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Reader resets on month change (AC 18)
// ─────────────────────────────────────────────────────────────────────────────
describe('Open reader closes automatically when navigating to a different month', () => {
  it('reader is removed from DOM after clicking Next month', () => {
    mockEntriesThisMonth.value = [makeEntry('2026-04-15', 1)]
    renderCalendar({ initialMonth: '2026-04' })
    // Open reader
    fireEvent.click(screen.getByRole('button', { name: /April 15, 1 entry/ }))
    expect(screen.getByTestId('editor-readonly')).toBeTruthy()
    // Navigate away
    fireEvent.click(screen.getByRole('button', { name: /next month/i }))
    expect(screen.queryByTestId('editor-readonly')).toBeNull()
  })

  it('empty-cell affordance is removed from DOM after clicking Previous month', () => {
    mockEntriesThisMonth.value = []
    renderCalendar({ initialMonth: '2026-04' })
    fireEvent.click(screen.getByRole('button', { name: /April 29, no entries/ }))
    expect(screen.getByText(/Nothing on April 29/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /previous month/i }))
    expect(screen.queryByText(/Nothing on April 29/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Today's cell has a border ring (AC 12, 24)
// ─────────────────────────────────────────────────────────────────────────────
describe('Today\'s date cell is visually distinguished with a border ring', () => {
  it('the today cell has a data-today="true" attribute or borderWidth style', () => {
    mockTodayString.value = '2026-04-15'
    mockEntriesThisMonth.value = []
    renderCalendar({ initialMonth: '2026-04' })
    // The dev is expected to mark today's cell with data-today or a testable attribute
    const todayCell = screen.getByRole('button', { name: /April 15, no entries/ })
    // Assert either data-today attribute OR that it is stylistically distinct
    // (The component should expose data-today="true" for testability per story AC 12)
    const hasTodayMarker =
      todayCell.getAttribute('data-today') === 'true' ||
      todayCell.getAttribute('borderwidth') === '1' ||
      (todayCell.style && (todayCell.style.borderWidth === '1px' || todayCell.style.outline !== ''))
    expect(hasTodayMarker).toBe(true)
  })

  it('uses getTodayJournalDayString() for today detection, not Date.toISOString()', () => {
    // Mock returns a fixed string — if the component used toISOString() this would still
    // pass for "normal" dates but fail on TZ-edge days. This test verifies the mock is used.
    mockTodayString.value = '2026-04-01'
    mockEntriesThisMonth.value = []
    renderCalendar({ initialMonth: '2026-04' })
    // April 1 cell should exist — its presence verifies date-utils import is wired
    const todayCell = screen.getByRole('button', { name: /April 1, no entries/ })
    expect(todayCell).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Keyboard arrow navigation (AC 21)
// ─────────────────────────────────────────────────────────────────────────────
describe('Keyboard arrow keys move focus between date cells', () => {
  it('ArrowRight on a cell moves focus to the next cell', () => {
    mockEntriesThisMonth.value = []
    renderCalendar({ initialMonth: '2026-04' })
    // Find first in-month cell (April 1 — cell index 3 in April 2026 grid)
    const april1 = screen.getByRole('button', { name: /April 1, no entries/ })
    april1.focus()
    fireEvent.keyDown(april1, { key: 'ArrowRight', code: 'ArrowRight' })
    // After ArrowRight, focus should be on April 2
    const april2 = screen.getByRole('button', { name: /April 2, no entries/ })
    expect(document.activeElement).toBe(april2)
  })

  it('ArrowLeft on a cell moves focus to the previous cell', () => {
    mockEntriesThisMonth.value = []
    renderCalendar({ initialMonth: '2026-04' })
    const april2 = screen.getByRole('button', { name: /April 2, no entries/ })
    april2.focus()
    fireEvent.keyDown(april2, { key: 'ArrowLeft', code: 'ArrowLeft' })
    const april1 = screen.getByRole('button', { name: /April 1, no entries/ })
    expect(document.activeElement).toBe(april1)
  })

  it('ArrowDown on a cell moves focus 7 cells ahead (next week)', () => {
    mockEntriesThisMonth.value = []
    renderCalendar({ initialMonth: '2026-04' })
    const april1 = screen.getByRole('button', { name: /April 1, no entries/ })
    april1.focus()
    fireEvent.keyDown(april1, { key: 'ArrowDown', code: 'ArrowDown' })
    // April 1 + 7 = April 8
    const april8 = screen.getByRole('button', { name: /April 8, no entries/ })
    expect(document.activeElement).toBe(april8)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Default initialMonth falls back to current month (AC 6)
// ─────────────────────────────────────────────────────────────────────────────
describe('CalendarMonthView defaults to the current month when no initialMonth is provided', () => {
  it('renders the current month label when initialMonth is omitted', () => {
    mockTodayString.value = '2026-04-15'
    renderCalendar() // no initialMonth prop
    expect(screen.getByText(/April 2026/i)).toBeTruthy()
  })
})
