import React, { useMemo, useRef, useState } from 'react'
import { Button, ExpandingLineButton, XStack, YStack, Text, View, useReducedMotion } from '@my/ui'
import { ChevronLeft, ChevronRight } from '@tamagui/lucide-icons'
import { use$ } from '@legendapp/state/react'
import { useRouter } from 'solito/navigation'
import { store$ } from 'app/state/store'
import { getTodayJournalDayString } from 'app/state/date-utils'
import { Editor } from 'app/features/journal/components/Editor'
import type { DailyEntryView, Flow } from 'app/state/types'

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for unit tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the previous month as a 'YYYY-MM' string.
 * Uses local Date constructor — timezone-agnostic for month math.
 */
export function prevMonthString(monthYYYY_MM: string): string {
  const parts = monthYYYY_MM.split('-').map(Number)
  const y = parts[0] as number
  const m = parts[1] as number
  const d = new Date(y, m - 1 - 1, 1) // m is 1-indexed; subtract 1 for prev
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Returns the next month as a 'YYYY-MM' string.
 * Uses local Date constructor — timezone-agnostic for month math.
 */
export function nextMonthString(monthYYYY_MM: string): string {
  const parts = monthYYYY_MM.split('-').map(Number)
  const y = parts[0] as number
  const m = parts[1] as number
  const d = new Date(y, m - 1 + 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Returns the accessible aria-label for a calendar date cell.
 * Uses local-midnight parsing to avoid UTC day shift.
 */
export function cellAriaLabel(date: string, entry: DailyEntryView | undefined): string {
  const d = new Date(date + 'T00:00:00') // local midnight to avoid TZ shift
  const monthDay = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  if (!entry) return `${monthDay}, no entries`
  const count = entry.flows.length
  return `${monthDay}, ${count} ${count === 1 ? 'entry' : 'entries'}`
}

/**
 * Joins flows chronologically with double-newline separators for display in the reader.
 * Uses .getTime() for Date subtraction to satisfy TypeScript.
 */
export function joinFlowsForReader(flows: Flow[]): string {
  if (flows.length === 0) return ''
  return [...flows]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((f) => f.content)
    .join('\n\n')
}

/** A single cell in the 42-cell month grid. */
export interface MonthGridCell {
  date: string // 'YYYY-MM-DD'
  inMonth: boolean
}

/**
 * Builds the 42-cell calendar fill grid for the given 'YYYY-MM' month string.
 * Starts on the Sunday before the first of the month and always returns exactly 42 cells.
 */
export function computeMonthGrid(month: string): MonthGridCell[] {
  const parts = month.split('-').map(Number)
  const y = parts[0] as number
  const m = parts[1] as number
  const firstOfMonth = new Date(y, m - 1, 1)
  // Walk back to the prior Sunday (dayOfWeek 0 = Sunday)
  const startDay = new Date(firstOfMonth)
  startDay.setDate(firstOfMonth.getDate() - firstOfMonth.getDay())

  const cells: MonthGridCell[] = []
  const cursor = new Date(startDay)
  for (let i = 0; i < 42; i++) {
    const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    cells.push({
      date: dateStr,
      inMonth: cursor.getMonth() + 1 === m && cursor.getFullYear() === y,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return cells
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface CalendarMonthViewProps {
  /** 'YYYY-MM' string. Defaults to the current month from getTodayJournalDayString(). */
  initialMonth?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Day-of-week header labels
// ─────────────────────────────────────────────────────────────────────────────
const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// ─────────────────────────────────────────────────────────────────────────────
// CalendarMonthView component
// ─────────────────────────────────────────────────────────────────────────────

export function CalendarMonthView({ initialMonth }: CalendarMonthViewProps): React.ReactElement {
  const router = useRouter()
  const reduceMotion = useReducedMotion()

  // Internal state
  const [currentMonth, setCurrentMonth] = useState<string>(
    () => initialMonth ?? getTodayJournalDayString().slice(0, 7)
  )
  const [focusedDate, setFocusedDate] = useState<string | null>(null)
  const [openEntryDate, setOpenEntryDate] = useState<string | null>(null)

  // Subscribe to entries reactively
  const entriesThisMonth = use$(store$.views.entriesByMonth(currentMonth))

  // Build a date → entry lookup map
  const entryByDate = useMemo(
    () => Object.fromEntries((entriesThisMonth ?? []).map((e) => [e.entryDate, e])),
    [entriesThisMonth]
  )

  // Compute the 42-cell grid
  const grid = useMemo(() => computeMonthGrid(currentMonth), [currentMonth])

  // Today's date string for ring highlighting
  const todayString = getTodayJournalDayString()

  // Month label for display (e.g. "April 2026")
  const monthLabel = useMemo(() => {
    const lparts = currentMonth.split('-').map(Number)
    const y = lparts[0] as number
    const m = lparts[1] as number
    const d = new Date(y, m - 1, 1)
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }, [currentMonth])

  // ── Navigation handlers ──────────────────────────────────────────────────
  function handlePrevMonth() {
    setCurrentMonth(prevMonthString(currentMonth))
    setOpenEntryDate(null)
  }

  function handleNextMonth() {
    setCurrentMonth(nextMonthString(currentMonth))
    setOpenEntryDate(null)
  }

  // ── Refs ─────────────────────────────────────────────────────────────────
  const gridRef = useRef<HTMLDivElement | null>(null)

  // ── Touch swipe state ────────────────────────────────────────────────────
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  function handleTouchStart(e: any) {
    const touch = e.touches?.[0] ?? e.nativeEvent?.touches?.[0]
    if (touch) {
      touchStartX.current = touch.clientX
      touchStartY.current = touch.clientY
    }
  }

  function handleTouchEnd(e: any) {
    if (touchStartX.current === null || touchStartY.current === null) return
    const touch = e.changedTouches?.[0] ?? e.nativeEvent?.changedTouches?.[0]
    if (!touch) return
    const deltaX = touch.clientX - touchStartX.current
    const deltaY = touch.clientY - touchStartY.current
    touchStartX.current = null
    touchStartY.current = null
    if (Math.abs(deltaX) > 50 && Math.abs(deltaY) < 30) {
      if (deltaX > 0) {
        handlePrevMonth()
      } else {
        handleNextMonth()
      }
    }
  }

  // ── Keyboard arrow navigation ────────────────────────────────────────────
  function handleCellKeyDown(e: any, cellIndex: number) {
    const key = e.key
    let targetIndex: number | null = null
    if (key === 'ArrowRight') {
      targetIndex = cellIndex + 1 < 42 ? cellIndex + 1 : null
    } else if (key === 'ArrowLeft') {
      targetIndex = cellIndex - 1 >= 0 ? cellIndex - 1 : null
    } else if (key === 'ArrowDown') {
      targetIndex = cellIndex + 7 < 42 ? cellIndex + 7 : null
    } else if (key === 'ArrowUp') {
      targetIndex = cellIndex - 7 >= 0 ? cellIndex - 7 : null
    }
    if (targetIndex !== null) {
      e.preventDefault?.()
      const buttons = gridRef.current?.querySelectorAll('[data-calendar-cell]') ?? []
      const target = buttons[targetIndex] as HTMLElement | undefined
      if (target) {
        target.focus()
        setFocusedDate(grid[targetIndex]?.date ?? null)
      }
    }
  }

  // ── Cell tap handler ─────────────────────────────────────────────────────
  function handleCellPress(cell: MonthGridCell) {
    if (!cell.inMonth) return
    setOpenEntryDate(cell.date)
  }

  // ── Reader formatted date ─────────────────────────────────────────────────
  function formatReaderDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }

  function formatNothingOnDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  }

  // ── Determine what to render below the grid ──────────────────────────────
  const openEntry = openEntryDate ? entryByDate[openEntryDate] : null
  const showReader = openEntryDate !== null && !!openEntry
  const showEmptyAffordance = openEntryDate !== null && !openEntry && !!grid.find(c => c.date === openEntryDate && c.inMonth)

  return (
    <YStack>
      {/* Month header */}
      <XStack justifyContent="space-between" alignItems="center" marginBottom="$4">
        <Button
          unstyled
          aria-label="Previous month"
          onPress={handlePrevMonth}
        >
          <ChevronLeft />
        </Button>

        <Text
          fontFamily="$journalItalic"
          fontStyle="italic"
          fontSize="$6"
          color="$color"
          aria-live="polite"
        >
          {monthLabel}
        </Text>

        <Button
          unstyled
          aria-label="Next month"
          onPress={handleNextMonth}
        >
          <ChevronRight />
        </Button>
      </XStack>

      {/* Day-of-week header row */}
      <XStack>
        {DOW_LABELS.map((label, idx) => (
          <Text
            key={`dow-${idx}`}
            width="14.2857%"
            textAlign="center"
            fontFamily="$body"
            fontSize="$3"
            color="$color8"
            letterSpacing={0.5}
          >
            {label}
          </Text>
        ))}
      </XStack>

      {/* 42-cell date grid with swipe support */}
      <View
        ref={gridRef as any}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <XStack flexWrap="wrap">
          {grid.map((cell, idx) => {
            const entry = entryByDate[cell.date]
            const isToday = cell.date === todayString
            const ariaLabel = cellAriaLabel(cell.date, entry)

            return (
              <Button
                key={cell.date}
                unstyled
                width="14.2857%"
                height={48}
                alignItems="center"
                justifyContent="center"
                disabled={!cell.inMonth}
                aria-label={ariaLabel}
                {...(cell.date === focusedDate ? { 'aria-current': 'date' } as any : {})}
                {...(isToday ? { 'data-today': 'true' } as any : {})}
                {...({ 'data-calendar-cell': idx } as any)}
                onPress={() => handleCellPress(cell)}
                onKeyDown={(e: any) => handleCellKeyDown(e, idx)}
                onFocus={() => setFocusedDate(cell.date)}
                color={!cell.inMonth ? '$color6' : entry ? '$color' : '$color8'}
                borderWidth={isToday ? 1 : 0}
                borderColor={isToday ? '$color' : undefined}
              >
                <YStack alignItems="center">
                  <Text
                    fontFamily="$body"
                    fontSize="$3"
                    color={!cell.inMonth ? '$color6' : entry ? '$color' : '$color8'}
                  >
                    {new Date(cell.date + 'T00:00:00').getDate()}
                  </Text>
                  {entry && cell.inMonth && (
                    <View
                      width={4}
                      height={4}
                      borderRadius={2}
                      backgroundColor="$color"
                      marginTop={2}
                    />
                  )}
                </YStack>
              </Button>
            )
          })}
        </XStack>
      </View>

      {/* Empty month microcopy */}
      {(entriesThisMonth ?? []).length === 0 && (
        <Text
          textAlign="center"
          fontFamily="$body"
          fontSize="$3"
          color="$color8"
          marginTop="$4"
        >
          No entries this month.
        </Text>
      )}

      {/* Below-grid reader / empty-cell affordance */}
      {showReader && openEntryDate && openEntry && (
        <YStack
          marginTop="$4"
          transition={reduceMotion ? '100ms' : 'designEnter'}
          enterStyle={{ opacity: 0, y: 10 }}
        >
          <XStack justifyContent="space-between" alignItems="center" marginBottom="$3">
            <Text
              fontFamily="$journalItalic"
              fontStyle="italic"
              fontSize="$5"
              color="$color"
            >
              {formatReaderDate(openEntryDate)}
            </Text>
            <ExpandingLineButton
              aria-label="Close"
              onPress={() => setOpenEntryDate(null)}
            >
              Close
            </ExpandingLineButton>
          </XStack>
          <Editor
            readOnly
            initialContent={joinFlowsForReader(openEntry.flows)}
          />
        </YStack>
      )}

      {showEmptyAffordance && openEntryDate && (
        <YStack
          marginTop="$4"
          transition={reduceMotion ? '100ms' : 'designEnter'}
          enterStyle={{ opacity: 0, y: 10 }}
        >
          <Text
            fontFamily="$body"
            fontSize="$4"
            color="$color8"
            marginBottom="$3"
          >
            Nothing on {formatNothingOnDate(openEntryDate)}.
          </Text>
          <ExpandingLineButton
            aria-label="Begin writing"
            onPress={() => router.push('/journal')}
          >
            Begin writing
          </ExpandingLineButton>
        </YStack>
      )}
    </YStack>
  )
}
