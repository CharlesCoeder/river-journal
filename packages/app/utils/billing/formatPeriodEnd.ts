/**
 * formatPeriodEnd — the shared "Month DD, YYYY" period-end formatter used by
 * both the Billing status line and the cancel-confirmation copy.
 *
 * Mirrors the human-date convention used elsewhere in the app
 * (`toLocaleDateString('en-US', { month, day, year })`). An invalid, empty, or
 * missing value NEVER renders the literal string "Invalid Date" — it falls back
 * to a neutral empty string so callers can omit the date clause entirely.
 *
 * The period end is a server-defined instant at (or near) a UTC boundary, so it
 * is formatted with `timeZone: 'UTC'` — without that pin, a device in a
 * behind-UTC timezone would render the calendar day BEFORE the true boundary
 * (an off-by-one). This is deliberately different from local-time surfaces like
 * ModerationReceiptDialog: a billing boundary is UTC-defined, not device-local.
 */

export function formatPeriodEnd(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
