// packages/app/features/collective/useCollectiveAccess.ts
//
// Access hook (UI layer) — the gate that decides whether the Collective FEED
// itself should mount at all. Distinct from `useCollectiveEligibility`, which
// answers the narrower "can this user POST right now?" question.
//
// Reading the feed (even in sub-500 `preview` mode) requires two things the
// feed RPC's RLS policies enforce:
//   1. an authenticated session, and
//   2. cloud sync enabled (the server can only resolve the caller against the
//      collective tables once their account is syncing).
// Without both, `collective_feed_page` fails the RLS check and the screen would
// otherwise surface a bare "Couldn't load the feed." This hook lets us catch
// those two states up front and show a guiding screen instead.
//
// Deliberately NARROWER than eligibility:
//   - It does NOT fire the suspension / 500-word RPCs (those need a session +
//     sync anyway, and firing them for a logged-out visitor is wasted work).
//   - Suspension and the daily-500 gate do NOT block READING: a suspended user
//     still reads the room (read-only), and a sub-500 user sees `preview` mode.
//     So neither belongs in the access decision — both flow through to the feed.
//
// D7 boundary: this file lives in features/, not state/collective/, so the
// Legend-State `use$` carve-out is permitted here (mirrors
// useCollectiveEligibility.ts and PostComposer.tsx). The feed/row/preview
// rendering files stay D7-clean.
//
// Precedence ladder (top to bottom):
//   loading → unauthenticated → sync-disabled → granted

import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { useCurrentUserId } from 'app/state/collective/currentUser'

export type CollectiveAccessStatus =
  | 'loading'
  | 'unauthenticated'
  | 'sync-disabled'
  | 'granted'

export interface CollectiveAccessState {
  status: CollectiveAccessStatus
}

export function useCollectiveAccess(): CollectiveAccessState {
  const currentUserId = useCurrentUserId()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const syncEnabled = use$((store$ as any).session.syncEnabled)

  // 1. loading: auth not yet resolved
  if (currentUserId === undefined) return { status: 'loading' }

  // 2. unauthenticated: no session
  if (currentUserId === null) return { status: 'unauthenticated' }

  // 3. sync disabled: signed in, but the feed RPC's RLS needs sync on
  if (syncEnabled !== true) return { status: 'sync-disabled' }

  // 4. granted: feed may mount (preview vs full mode is the feed's call)
  return { status: 'granted' }
}
