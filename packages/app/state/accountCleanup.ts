/**
 * accountCleanup — the post-deletion local-cleanup seam.
 *
 * Invoked (fire-and-forget) the moment account deletion is confirmed
 * server-side. Its job is to tear down the just-deleted user's local footprint
 * on THIS device and reset the pending-cleanup flag once that finishes.
 *
 * Right now it performs only the device-local teardown this surface owns —
 * signing out (which already clears the cached encryption master key, the
 * TanStack query cache + its persisted copy, and the sync cursors) then flipping
 * the pending flag off. The heavier local-store purge (entries, flows, grace
 * days, push tokens, profile — preserving anonymous `sync_excluded` data and the
 * onboarding-completed flag) plus the on-boot resume are wired in later by the
 * post-deletion local-data-purge feature at the marked extension point below.
 *
 * State-boundary note: this module lives in the Legend-State subtree, so it must
 * NOT import `@tanstack/react-query` — `signOut` already handles the query-cache
 * teardown internally from `utils/`.
 */

import { signOut } from 'app/utils'
import { ephemeral$ } from 'app/state/store'

export async function runPostDeletionCleanup(): Promise<void> {
  // Sign out first: this nulls the local session and clears the cached E2E
  // master key, the TanStack query cache (+ persisted copy), and sync cursors.
  await signOut()

  // ─── Extension point ───────────────────────────────────────────────────────
  // The device-local store purge for the just-deleted user is wired in here by
  // the post-deletion local-data-purge feature: a two-phase clear (nullify
  // `user_id` first, then replace the maps) of the user-scoped local stores,
  // preserving anonymous (`sync_excluded`) data and the onboarding-completed
  // flag, plus the boot-time resume that checks the pending flag below.
  // ─────────────────────────────────────────────────────────────────────────

  // Cleanup finished on this device — clear the pending marker.
  ephemeral$.pendingAccountCleanup.set(false)
}
