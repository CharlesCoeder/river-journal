// packages/app/state/collective/todayWordCount.ts
//
// ─── BOUNDARY-RULE NARROW EXCEPTION (D7) ──────────────────────────────────────
// Alongside feed.ts, this is one of the only places state/collective/** imports
// Legend-State. The Collective FEATURE layer (features/collective/**) MUST NOT
// import Legend-State or app/state/store; this hook lives on the state/hook side
// of that boundary and bridges the journal-side "today's word count" into the
// Collective locked screen's `words` progress gate. The feed screen imports this
// hook, never the store — keeping features/collective/** D7-clean.
// ──────────────────────────────────────────────────────────────────────────────

import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { useToday } from 'app/state/today'

/**
 * `useTodayWordCount()` — today's total word count for the current user, sourced
 * from the SAME canonical selector HomeScreen uses
 * (`store$.views.statsByDate(today)`), so the Collective gate shows the user's
 * real progress (e.g. 480 / 500) instead of a hard-coded 0.
 *
 * Reactive: recomputes as the user writes, and rolls over at local midnight via
 * `useToday()`. Returns 0 before any words are logged today.
 */
export function useTodayWordCount(): number {
  const today = useToday()
  const stats = use$(store$.views.statsByDate(today))
  return stats?.totalWords ?? 0
}
