/**
 * celebrationVariant.ts
 *
 * Pure helper that decides which CelebrationScreen variant to render.
 *
 * Rules for 'handoff' (all three must be true; otherwise 'quieter'):
 *  1. `lastSavedFlow` is non-null AND `lastSavedFlow.wordCount >= 500`.
 *  2. The just-saved flow is the FIRST flow with wordCount >= 500 today:
 *     `todayEntry.flows` sorted by (timestamp asc, id asc) — the smallest
 *     entry with wordCount >= 500 must match `lastSavedFlow.timestamp`.
 *  3. `lastSavedFlow.timestamp`'s ISO date (UTC) equals `todayJournalDay`.
 *     Cross-day edge: if the user crosses local midnight between save and
 *     celebration mount, we never claim "first today" for a yesterday flow.
 *
 * Tie-break safety (AC 1): if multiple flows share the same timestamp
 * (test-only — production-impossible at ms precision), the canonical "first"
 * is the one with the lexicographically smallest `id`. Production rule:
 * the just-saved flow must be the FIRST `wordCount >= 500` flow when
 * `todayEntry.flows` is sorted by (timestamp asc, id asc).
 *
 * Contract: `todayEntry.flows` contains ONLY live (non-deleted) flows.
 * Tombstoned flows are removed from `flows$` at the sync boundary via
 * Legend-State's `fieldDeleted` mechanism — this function must NOT reference
 * `f.is_deleted` (the field does not exist on the local `Flow` type).
 *
 * Pure function — no observable reads, no I/O, no side effects.
 * Mirrors the `state/streak.ts` pure-function-then-wiring pattern.
 */

import type { LastSavedFlow, DailyEntryView } from 'app/state/types'

export type CelebrationVariant = 'handoff' | 'quieter'

/**
 * Determine which celebration variant to show after a flow is saved.
 *
 * @param lastSavedFlow - The just-saved flow, or null if the screen mounted without one.
 * @param todayEntry - The DailyEntryView for today's writing day (may be null defensively).
 * @param todayJournalDay - The canonical user-local writing day key ('YYYY-MM-DD').
 * @returns 'handoff' | 'quieter'
 *
 * Animation tokens degrade to `100ms` tween under prefers-reduced-motion;
 * content timing (auto-dismiss) is unaffected.
 */
export function chooseCelebrationVariant(
  lastSavedFlow: LastSavedFlow | null,
  todayEntry: DailyEntryView | null,
  todayJournalDay: string
): CelebrationVariant {
  // Rule 1: lastSavedFlow must exist and have wordCount >= 500
  if (!lastSavedFlow || lastSavedFlow.wordCount < 500) {
    return 'quieter'
  }

  // Rule 3: cross-day edge — the ISO date of the timestamp must match todayJournalDay
  // timestamp is a full ISO UTC string; extract date portion (YYYY-MM-DD)
  const savedDate = lastSavedFlow.timestamp.slice(0, 10)
  if (savedDate !== todayJournalDay) {
    return 'quieter'
  }

  // Rule 2: must have a todayEntry with flows to establish "first today"
  if (!todayEntry || todayEntry.flows.length === 0) {
    return 'quieter'
  }

  // Find the first >= 500-word flow when sorted by (timestamp asc, id asc)
  const qualifyingFlows = todayEntry.flows
    .filter((f) => f.wordCount >= 500)
    .sort((a, b) => {
      if (a.timestamp !== b.timestamp) {
        return a.timestamp < b.timestamp ? -1 : 1
      }
      // Tie-break: lexicographically smallest id is canonical first
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })

  if (qualifyingFlows.length === 0) {
    return 'quieter'
  }

  const firstQualifying = qualifyingFlows[0]!

  // The just-saved flow is the first qualifying flow iff its timestamp matches
  // (production-grade: ms-precision timestamps are unique; tie-break by id if equal)
  if (firstQualifying.timestamp === lastSavedFlow.timestamp) {
    return 'handoff'
  }

  return 'quieter'
}
