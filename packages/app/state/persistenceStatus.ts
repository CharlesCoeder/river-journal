/**
 * persistenceStatus.ts — boot-time health of the local persistence layer,
 * surfaced so the boot gate can tell the user what is happening instead of
 * showing a blank screen.
 *
 * Shared (no platform imports). On native both flags stay false forever: MMKV
 * has no cross-tab open/upgrade handshake. On web they are driven by
 * `persistConfig.ts`:
 *
 *   - `blockedByOtherTab` — this tab needs to upgrade the IndexedDB schema
 *     (DB_VERSION bumped in a new deploy) but another tab still running the
 *     older build holds the database open, so the upgrade cannot proceed.
 *     Clears itself the moment that tab closes or reloads.
 *   - `staleTab` — this tab has been told (via `versionchange`) that a NEWER
 *     build in another tab is upgrading the schema. This tab has released its
 *     database connection so the newer tab can boot, and must reload to keep
 *     working — its persistence is closed.
 */

import { observable } from '@legendapp/state'

export const persistenceStatus$ = observable({
  blockedByOtherTab: false,
  staleTab: false,
})
