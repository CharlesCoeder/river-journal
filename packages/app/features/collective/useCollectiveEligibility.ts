// packages/app/features/collective/useCollectiveEligibility.ts
//
// Eligibility hook (UI layer). Composes:
//   - useCurrentUserId  (auth)               — TanStack Query
//   - useIsSuspended    (suspension)         — TanStack Query
//   - useEligibleToPost (server 500-day pred) — TanStack Query
//   - store$.session.syncEnabled (Legend-State sync flag)
//
// D7 boundary: this file lives in features/, not state/collective/, so the
// Legend-State `use$` carve-out is permitted here (mirrors PostComposer.tsx's
// `store$` read). The state/collective/eligibility.ts hook stays D7-clean.
//
// Precedence ladder (top to bottom):
//   loading → unauthenticated → suspended → sync-disabled → not-qualified → eligible
//
// `isSuspended === undefined` collapses to `loading` (we don't yet know
// whether the user is suspended; rendering 'sync-disabled' or 'not-qualified'
// risks showing a misleading explainer).
//
// Eligibility-RPC error with no cache also collapses to `loading` (deliberate;
// see Spec Change Log) — a transport blip should NOT gate the user out of
// posting they're entitled to. The query keeps retrying; the gate stays on
// the loading skeleton until it resolves.

import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { useCurrentUserId } from 'app/state/collective/currentUser'
import { useIsSuspended } from 'app/state/collective/suspension'
import { useEligibleToPost } from 'app/state/collective/eligibility'

export type EligibilityStatus =
  | 'loading'
  | 'unauthenticated'
  | 'suspended'
  | 'sync-disabled'
  | 'not-qualified'
  | 'eligible'

export interface EligibilityState {
  status: EligibilityStatus
}

export function useCollectiveEligibility(): EligibilityState {
  const currentUserId = useCurrentUserId()
  const isSuspended = useIsSuspended(currentUserId ?? null)
  const eligibility = useEligibleToPost()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const syncEnabled = use$((store$ as any).session.syncEnabled)

  // 1. loading: auth not yet resolved
  if (currentUserId === undefined) return { status: 'loading' }

  // 2. unauthenticated
  if (currentUserId === null) return { status: 'unauthenticated' }

  // 3. suspended (undefined collapses to loading — we don't render
  //    sync/qualified explainers when we don't yet know suspension state)
  if (isSuspended === undefined) return { status: 'loading' }
  if (isSuspended === true) return { status: 'suspended' }

  // 4. sync disabled
  if (syncEnabled !== true) return { status: 'sync-disabled' }

  // 5. server-confirmed daily-500
  // Eligibility-RPC error with no cached value → 'loading' (deliberate;
  // a transport error must NOT degrade to 'not-qualified' for an actually-
  // qualified user).
  if (eligibility.data === undefined) return { status: 'loading' }
  if (eligibility.data === false) return { status: 'not-qualified' }

  return { status: 'eligible' }
}
