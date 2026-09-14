/**
 * date-utils.ts
 * * Manages all date-related logic to ensure a consistent, timezone-agnostic
 * approach to journaling. The core principle is to use a simple 'YYYY-MM-DD'
 * string to represent a "Journal Day," which is derived from the user's
 * local time, making the experience intuitive regardless of their location.
 */

/**
 * Generates a timezone-agnostic "Journal Day" string (e.g., '2025-09-23')
 * from a given Date object.
 * * This function is the heart of our date management. It intentionally uses
 * the local date components (getFullYear, getMonth, getDate) to capture the
 * calendar day as the user perceives it on their device, rather than the
 * strict UTC day.
 * * @param date The Date object to convert.
 * @returns A string in 'YYYY-MM-DD' format.
 */
export const getJournalDayString = (date: Date): string => {
  const year = date.getFullYear()
  // getMonth() is 0-indexed, so we add 1.
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')

  return `${year}-${month}-${day}`
}

/**
 * A convenience function to get the "Journal Day" string for the current moment.
 * It creates a new Date() object, which reflects the device's current local time,
 * and then formats it.
 * * @returns The 'YYYY-MM-DD' string for today.
 */
export const getTodayJournalDayString = (): string => {
  return getJournalDayString(new Date())
}

/**
 * Formats a 'YYYY-MM-DD' Journal Day for the home date hero, e.g.
 * "Sunday, September 13". Parses as LOCAL midnight — a bare 'YYYY-MM-DD' is
 * UTC per ISO 8601 and would render as the previous day west of UTC.
 * Surfaces should feed this the reactive `useToday()` key rather than
 * `new Date()` so the hero and the streak math can never disagree about what
 * day it is.
 */
export const formatJournalDayLong = (yyyymmdd: string): string => {
  return new Date(`${yyyymmdd}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}
