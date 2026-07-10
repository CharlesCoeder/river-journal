/**
 * state/authReturn.ts
 *
 * Local-only, persisted markers that carry post-auth intent across the account
 * gate — including the web/desktop Google OAuth full-page redirect, where no
 * inline post-auth code can run. Both markers are per-device UI state: never
 * synced to Supabase, never encrypted. Persistence is wired in initializeApp.ts
 * (IndexedDB on web/desktop, MMKV on native), and joins the boot `isPersistLoaded`
 * gate so they are rehydrated BEFORE HomeScreen mounts / the flush observer runs.
 *
 * - `pendingCollectiveReturn$`: set true by the gate when a user arrives from a
 *   Collective tap; consumed once by HomeScreen's home-forward effect after
 *   `isSyncReady$` opens (clear-before-navigate, single-fire).
 * - `pendingAgeAttestation$`: set true before initiating Google OAuth (only
 *   ever when the 13+ box is checked); flushed once a session exists.
 *
 * Both live under a single persisted observable so they share one storage table.
 */

import { observable } from '@legendapp/state'

export const authReturn$ = observable<{
  pendingCollectiveReturn: boolean
  pendingAgeAttestation: boolean
}>({
  pendingCollectiveReturn: false,
  pendingAgeAttestation: false,
})

/** Post-auth return-to-Collective intent (see HomeScreen home-forward effect). */
export const pendingCollectiveReturn$ = authReturn$.pendingCollectiveReturn

/** Deferred 13+ attestation intent for the Google web/desktop redirect flow. */
export const pendingAgeAttestation$ = authReturn$.pendingAgeAttestation

/**
 * Flush the deferred Google-web-redirect attestation once a session exists.
 *
 * No-op unless the marker is pending AND a userId is present — an abandoned
 * OAuth attempt (no session) must leave the marker untouched so a later
 * successful session can flush it. `recordAgeAttestation` is idempotent-if-null,
 * so a redundant flush is harmless.
 *
 * `recordAgeAttestation` is imported lazily to keep the auth/supabase module
 * tree out of the surfaces that only need the marker observables (e.g. the
 * HomeScreen render path).
 */
export async function flushPendingAgeAttestation(userId: string | null): Promise<void> {
  if (!pendingAgeAttestation$.peek()) return
  if (!userId) return
  const { recordAgeAttestation } = await import('../utils/auth')
  await recordAgeAttestation(userId)
  pendingAgeAttestation$.set(false)
}
