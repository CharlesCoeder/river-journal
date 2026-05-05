// @vitest-environment happy-dom
// Pure-helper unit tests for CalendarMonthView utility functions.
// These helpers must be exported from CalendarMonthView.tsx as named exports.
// All tests are in RED phase — helpers do not exist yet; imports will fail.

import { describe, expect, it } from 'vitest'
import {
  prevMonthString,
  nextMonthString,
  cellAriaLabel,
  joinFlowsForReader,
  computeMonthGrid,
} from '../CalendarMonthView'

// ─────────────────────────────────────────────────────────────────────────────
// prevMonthString
// ─────────────────────────────────────────────────────────────────────────────
describe('prevMonthString — moves back one month', () => {
  it('returns the previous month within the same year', () => {
    expect(prevMonthString('2026-04')).toBe('2026-03')
  })

  it('wraps from January to December of the prior year', () => {
    expect(prevMonthString('2026-01')).toBe('2025-12')
  })

  it('handles mid-year correctly', () => {
    expect(prevMonthString('2026-07')).toBe('2026-06')
  })

  it('handles December correctly', () => {
    expect(prevMonthString('2026-12')).toBe('2026-11')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// nextMonthString
// ─────────────────────────────────────────────────────────────────────────────
describe('nextMonthString — moves forward one month', () => {
  it('advances to the next month within the same year', () => {
    expect(nextMonthString('2026-04')).toBe('2026-05')
  })

  it('wraps from December to January of the next year', () => {
    expect(nextMonthString('2026-12')).toBe('2027-01')
  })

  it('handles January correctly', () => {
    expect(nextMonthString('2026-01')).toBe('2026-02')
  })

  it('handles mid-year correctly', () => {
    expect(nextMonthString('2026-06')).toBe('2026-07')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// cellAriaLabel
// ─────────────────────────────────────────────────────────────────────────────
describe('cellAriaLabel — returns accessible label for a date cell', () => {
  it('labels a cell with one entry as "N entry" (singular)', () => {
    const label = cellAriaLabel('2026-04-28', { flows: [{}] } as any)
    expect(label).toMatch(/April 28, 1 entry/)
  })

  it('labels a cell with no entry as "no entries"', () => {
    const label = cellAriaLabel('2026-04-29', undefined)
    expect(label).toMatch(/April 29, no entries/)
  })

  it('labels a cell with multiple entries using plural "entries"', () => {
    const label = cellAriaLabel('2026-04-30', { flows: [{}, {}, {}] } as any)
    expect(label).toMatch(/April 30, 3 entries/)
  })

  it('uses local-midnight parsing to avoid UTC day shift', () => {
    // 2026-04-01 must resolve to April 1 (not March 31 via UTC parse)
    const label = cellAriaLabel('2026-04-01', undefined)
    expect(label).toMatch(/April 1/)
  })

  it('labels a cell with two entries using plural "entries"', () => {
    const label = cellAriaLabel('2026-04-15', { flows: [{}, {}] } as any)
    expect(label).toMatch(/April 15, 2 entries/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// joinFlowsForReader
// ─────────────────────────────────────────────────────────────────────────────
describe('joinFlowsForReader — joins flows chronologically with double-newline separator', () => {
  it('sorts flows by timestamp and joins with \\n\\n', () => {
    const result = joinFlowsForReader([
      { timestamp: '2026-04-28T10:00:00Z', content: 'B' },
      { timestamp: '2026-04-28T08:00:00Z', content: 'A' },
    ] as any)
    expect(result).toBe('A\n\nB')
  })

  it('returns a single flow content with no separator', () => {
    const result = joinFlowsForReader([
      { timestamp: '2026-04-28T09:00:00Z', content: 'Only flow' },
    ] as any)
    expect(result).toBe('Only flow')
  })

  it('joins three flows in chronological order', () => {
    const result = joinFlowsForReader([
      { timestamp: '2026-04-28T12:00:00Z', content: 'Third' },
      { timestamp: '2026-04-28T08:00:00Z', content: 'First' },
      { timestamp: '2026-04-28T10:00:00Z', content: 'Second' },
    ] as any)
    expect(result).toBe('First\n\nSecond\n\nThird')
  })

  it('returns empty string for empty flows array', () => {
    const result = joinFlowsForReader([] as any)
    expect(result).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// computeMonthGrid
// ─────────────────────────────────────────────────────────────────────────────
describe('computeMonthGrid — builds the 42-cell calendar fill grid', () => {
  it('always returns exactly 42 cells', () => {
    expect(computeMonthGrid('2026-04')).toHaveLength(42)
    expect(computeMonthGrid('2026-02')).toHaveLength(42)
    expect(computeMonthGrid('2025-12')).toHaveLength(42)
  })

  it('April 2026 starts on Wednesday — first 3 cells are prior-month spillover (March 29, 30, 31)', () => {
    const grid = computeMonthGrid('2026-04')
    // April 1 2026 is a Wednesday → cells 0,1,2 = Sun, Mon, Tue = March 29, 30, 31
    expect(grid[0].inMonth).toBe(false)
    expect(grid[0].date).toBe('2026-03-29')
    expect(grid[1].inMonth).toBe(false)
    expect(grid[1].date).toBe('2026-03-30')
    expect(grid[2].inMonth).toBe(false)
    expect(grid[2].date).toBe('2026-03-31')
  })

  it('April 2026 — cells 3 through 32 are April 1–30 (inMonth: true)', () => {
    const grid = computeMonthGrid('2026-04')
    const aprilCells = grid.slice(3, 33)
    expect(aprilCells).toHaveLength(30)
    aprilCells.forEach((cell) => {
      expect(cell.inMonth).toBe(true)
    })
    expect(aprilCells[0].date).toBe('2026-04-01')
    expect(aprilCells[29].date).toBe('2026-04-30')
  })

  it('April 2026 — trailing 9 cells are May 1–9 (inMonth: false)', () => {
    const grid = computeMonthGrid('2026-04')
    const trailingCells = grid.slice(33)
    expect(trailingCells).toHaveLength(9)
    trailingCells.forEach((cell) => {
      expect(cell.inMonth).toBe(false)
    })
    expect(trailingCells[0].date).toBe('2026-05-01')
    expect(trailingCells[8].date).toBe('2026-05-09')
  })

  it('each cell has a date string in YYYY-MM-DD format', () => {
    const grid = computeMonthGrid('2026-04')
    const isoDateRe = /^\d{4}-\d{2}-\d{2}$/
    grid.forEach((cell) => {
      expect(cell.date).toMatch(isoDateRe)
    })
  })

  it('cell dates are consecutive with no gaps', () => {
    const grid = computeMonthGrid('2026-04')
    for (let i = 1; i < grid.length; i++) {
      const prev = new Date(grid[i - 1].date + 'T00:00:00').getTime()
      const curr = new Date(grid[i].date + 'T00:00:00').getTime()
      expect(curr - prev).toBe(86400000) // exactly one day
    }
  })
})
