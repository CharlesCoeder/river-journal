// packages/app/state/collective/locallyHidden.ts
//
// Boundary rule (D7) exception — Story 3-12
// ─────────────────────────────────────────────────────────────────────────────
// This file is the SECOND documented narrow exception to the D7 boundary rule
// (the first being feed.ts's single observe() block).
//
// Bridging Legend-State user preference into the TanStack-Query-driven feed
// surface; this is the only boundary-cross in Story 3-12 and is structurally
// additive (read-only, one-way).
//
// Rationale:
//   - locallyHiddenPosts is genuinely user-preference state that lives on the
//     Legend-State side (persisted to users.preferences JSONB via syncedSupabase).
//   - The bridge is read-only and one-way: the feed screen reads the set;
//     nothing in the TQ side writes to it.
//   - The exception lives in its own file so the boundary-rule test can cover
//     it in a dedicated describe block (mirroring the feed.ts exception block).
//
// The local-hide set is owned by Legend-State (server-synced via
// users.preferences). On cold start, the persisted Legend-State array
// re-materializes independently of the TQ mutation queue replay.
//
// No other state/collective/ file may import Legend-State.
// ─────────────────────────────────────────────────────────────────────────────

import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'

/**
 * Returns the set of locally-hidden post ids from the user's persisted
 * preferences.
 *
 * Legend-State's use$() returns a stable reference when the underlying value
 * has not changed, so the Set construction runs only when the array changes.
 *
 * Used by CollectiveFeedScreen to filter hidden posts from the feed.
 */
export function useLocallyHiddenPostIds(): Set<string> {
  const ids = use$(store$.profile.preferences.locallyHiddenPosts)
  return new Set(ids ?? [])
}
