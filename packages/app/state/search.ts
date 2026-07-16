/**
 * Local full-text search over the on-device journal corpus.
 *
 * This module is a pure, synchronous, side-effect-free function over
 * already-loaded local state. It performs no I/O, no async work, and touches
 * no network client — results resolve synchronously so the calling surface
 * never needs a loading state. The only shared logic it reaches for is the
 * cross-identity ownership filter used by the export path, so a previous
 * account's surviving local plaintext can never surface under a new identity.
 *
 * Runtime imports are deliberately limited to `filterExportableEntries`; the
 * `DailyEntryView` / `SearchResultRow` shapes are type-only.
 */

import type { DailyEntryView } from 'app/state/types'
import { filterExportableEntries } from 'app/utils/exportJournal'

/** One search result row — a single matching day. */
export interface SearchResultRow {
  /** The matching day, 'YYYY-MM-DD'. */
  entryDate: string
  /** A ~80-character window of the first matching flow, centered on the match. */
  snippet: string
  /** Offset of the match within `snippet` (never negative). */
  matchStart: number
  /** Length of the matched substring (equals the trimmed query length). */
  matchLength: number
  /** The day's total flow count after ownership filtering. */
  flowCount: number
}

/** Minimum trimmed query length before a search runs. */
const MIN_QUERY_LENGTH = 2

/** Characters of context to keep on each side of the match in a snippet. */
const SNIPPET_RADIUS = 40

/**
 * Extracts a ~80-character snippet centered on a match, clamped cleanly at the
 * content boundaries — it never produces a negative offset or an over-length
 * slice. Returns the snippet plus the match's offset *within the snippet*, so
 * the caller can emphasize the matched substring.
 *
 * Exported for direct unit testing.
 */
export function extractSnippet(
  content: string,
  matchIndex: number,
  matchLength: number,
  radius: number = SNIPPET_RADIUS
): { snippet: string; matchStart: number; matchLength: number } {
  const start = Math.max(0, matchIndex - radius)
  const end = Math.min(content.length, matchIndex + matchLength + radius)
  const snippet = content.slice(start, end)
  return { snippet, matchStart: matchIndex - start, matchLength }
}

/**
 * Searches the local corpus for a case-insensitive substring match of `query`
 * over each flow's content, returning one row per matching day sorted newest
 * first.
 *
 * The entry pool is first passed through `filterExportableEntries` so results
 * respect the exact cross-identity ownership rule the export path uses. A query
 * shorter than two characters (after trimming) yields no results.
 *
 * Pure and synchronous — the caller passes plain arrays; this function reads no
 * observables and performs no I/O.
 */
export function searchFlows(
  entries: DailyEntryView[],
  query: string,
  currentUserId: string | null
): SearchResultRow[] {
  const q = query.trim()
  if (q.length < MIN_QUERY_LENGTH) return []

  const owned = filterExportableEntries(entries, currentUserId)
  const needle = q.toLowerCase()
  const rows: SearchResultRow[] = []

  for (const entry of owned) {
    let matchIndex = -1
    let matchContent = ''
    for (const flow of entry.flows) {
      const content = flow.content ?? ''
      const idx = content.toLowerCase().indexOf(needle)
      if (idx !== -1) {
        matchIndex = idx
        matchContent = content
        break
      }
    }
    if (matchIndex === -1) continue

    const { snippet, matchStart, matchLength } = extractSnippet(matchContent, matchIndex, q.length)
    rows.push({
      entryDate: entry.entryDate,
      snippet,
      matchStart,
      matchLength,
      flowCount: entry.flows.length,
    })
  }

  rows.sort((a, b) => b.entryDate.localeCompare(a.entryDate))
  return rows
}
