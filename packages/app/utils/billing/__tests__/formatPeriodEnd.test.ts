/**
 * formatPeriodEnd.test.ts — the shared "Month DD, YYYY" period-end formatter
 * used by both the Billing status line and the cancel-confirmation copy.
 *
 * Contract pinned for the green-phase implementer:
 *   `packages/app/utils/billing/formatPeriodEnd.ts` exports
 *   `formatPeriodEnd(iso: string | null | undefined): string`
 *
 * A valid ISO timestamp renders via
 * `toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })`
 * (the same human-date convention as `ModerationReceiptDialog`'s `humanDate`,
 * but pinned to UTC because a billing period end is a server-defined UTC
 * boundary — not a device-local instant). Because of that pin the output is
 * timezone-independent: these assertions hold under ANY device timezone (no
 * TZ=UTC env pin required). An invalid, empty, or missing value MUST NEVER
 * render the literal string "Invalid Date" — it falls back to a neutral empty
 * string so callers can omit the date clause entirely.
 */

import { describe, expect, it } from 'vitest'

// Import under test — fails until formatPeriodEnd.ts exists.
import { formatPeriodEnd } from '../formatPeriodEnd'

const MONTHS =
  /January|February|March|April|May|June|July|August|September|October|November|December/

describe('formatPeriodEnd — valid input', () => {
  it('renders a "Month DD, YYYY" human date for a valid ISO timestamp', () => {
    expect(formatPeriodEnd('2026-08-14T00:00:00.000Z')).toMatch(MONTHS)
    expect(formatPeriodEnd('2026-08-14T00:00:00.000Z')).toMatch(/\d{4}/)
  })

  it("matches the exact UTC-pinned toLocaleDateString('en-US', ...) output for a known date", () => {
    const iso = '2026-08-14T00:00:00.000Z'
    const expected = new Date(iso).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    expect(formatPeriodEnd(iso)).toBe(expected)
  })

  it('renders the UTC calendar day regardless of the device timezone (no off-by-one)', () => {
    // A period end at the UTC-midnight boundary must display as its UTC calendar
    // day on EVERY device. Without the timeZone: 'UTC' pin, a behind-UTC device
    // (e.g. America/New_York) would render August 13 for this instant. Pinned to
    // the exact literal so this fails if the TZ pin is ever dropped — the
    // assertion is env-timezone-independent.
    expect(formatPeriodEnd('2026-08-14T00:00:00.000Z')).toBe('August 14, 2026')
  })

  it('renders the UTC calendar day for an instant just after UTC midnight', () => {
    expect(formatPeriodEnd('2026-08-14T00:30:00.000Z')).toBe('August 14, 2026')
  })

  it('formats a far-future date correctly', () => {
    expect(formatPeriodEnd('2030-01-01T00:00:00.000Z')).toMatch(MONTHS)
    expect(formatPeriodEnd('2030-01-01T00:00:00.000Z')).toContain('2030')
    expect(formatPeriodEnd('2030-01-01T00:00:00.000Z')).toBe('January 1, 2030')
  })
})

describe('formatPeriodEnd — invalid / missing input never emits "Invalid Date"', () => {
  it('returns a neutral fallback (not the literal "Invalid Date") for a malformed date string', () => {
    const result = formatPeriodEnd('not-a-real-date')
    expect(result).not.toContain('Invalid Date')
  })

  it('returns a neutral fallback for an empty string', () => {
    const result = formatPeriodEnd('')
    expect(result).not.toContain('Invalid Date')
  })

  it('returns a neutral fallback for null', () => {
    const result = formatPeriodEnd(null)
    expect(result).not.toContain('Invalid Date')
  })

  it('returns a neutral fallback for undefined', () => {
    const result = formatPeriodEnd(undefined)
    expect(result).not.toContain('Invalid Date')
  })

  it('the fallback is an empty string so callers can omit the date clause entirely', () => {
    expect(formatPeriodEnd(null)).toBe('')
    expect(formatPeriodEnd(undefined)).toBe('')
    expect(formatPeriodEnd('garbage')).toBe('')
  })
})
