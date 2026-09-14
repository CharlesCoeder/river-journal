import { describe, expect, it } from 'vitest'
import { formatJournalDayLong, getJournalDayString } from '../date-utils'

describe('formatJournalDayLong', () => {
  it('renders a Journal Day key as the long home-hero form', () => {
    expect(formatJournalDayLong('2026-09-13')).toBe('Sunday, September 13')
    expect(formatJournalDayLong('2026-01-01')).toBe('Thursday, January 1')
  })

  it('never shifts the day for users west of UTC (parses as local midnight, not the ISO UTC default)', () => {
    // Round-trip: the rendered day must be the same calendar day the key names,
    // in whatever timezone the test runs in.
    const key = '2026-09-13'
    const local = new Date(`${key}T00:00:00`)
    expect(getJournalDayString(local)).toBe(key)
    expect(formatJournalDayLong(key)).toContain('September 13')
  })
})
