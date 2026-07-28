/**
 * accountCleanup — the post-deletion local-cleanup seam.
 *
 * Invoked (fire-and-forget) the moment account deletion is confirmed
 * server-side, and again on the next boot if the app was closed mid-cleanup.
 * Its job is to tear down the just-deleted user's local footprint on THIS
 * device and clear the persisted pending-cleanup marker once that finishes.
 *
 * Order is load-bearing:
 *   1. `clearUserData()` — the carryover two-phase purge (nullify `user_id`
 *      first so Legend-State enqueues no ghost Supabase deletes, then replace
 *      the maps keeping only anonymous `sync_excluded` items). It reads the
 *      still-live `store$.session.userId` to scope grace-day/push-token
 *      nullification, so it MUST run while the session is still authenticated —
 *      i.e. BEFORE sign-out. Anonymous local-only data and the onboarding flag
 *      (`onboarding$`, a separate store) are preserved by this helper's own
 *      contract — no carve-out is added here.
 *   2. `signOut()` — nulls the local Supabase session and clears the cached E2E
 *      master key, the TanStack query cache (+ its persisted copy), and the
 *      sync cursors. Attempted best-effort even if `clearUserData()` threw.
 *
 * Failure semantics (boot-resume retry contract): the run counts as failed if
 * `clearUserData()` throws OR `signOut()` returns a non-null `error`. The
 * persisted marker (`deviceState$.pendingAccountCleanup`) is cleared ONLY on a
 * fully clean completion; on any failure it is left set (so the next boot
 * retries) and the promise rejects (so the fire-and-forget caller's `.catch`
 * can surface a calm sub-line). Logging is metadata-only.
 *
 * State-boundary note: this module lives in the Legend-State subtree, so it must
 * NOT import the TanStack Query package — `signOut` already handles that query
 * cache's teardown internally from `utils/`.
 */

import { signOut } from 'app/utils'
import { clearUserData } from 'app/state/store'
import { deviceState$ } from 'app/state/syncConfig'

export async function runPostDeletionCleanup(): Promise<void> {
  let purgeError: unknown = null

  // Phase 1 — purge the user-scoped local stores while the session is still
  // live (clearUserData reads store$.session.userId to scope its nullification).
  // A throw here is treated as a failure but does NOT skip the sign-out below.
  try {
    clearUserData()
  } catch (error) {
    purgeError = error
  }

  // Phase 2 — tear down the local session (best-effort even if the purge threw).
  const { error: signOutError } = await signOut()

  if (purgeError || signOutError) {
    console.warn(
      '[account-cleanup] post-deletion local cleanup did not complete cleanly',
      purgeError instanceof Error ? purgeError.message : (signOutError ?? 'unknown error')
    )
    // Leave the persisted marker set so the next boot retries.
    throw new Error('post-deletion local cleanup failed')
  }

  // Clean completion on this device — clear the persisted marker.
  deviceState$.pendingAccountCleanup.set(false)
}
