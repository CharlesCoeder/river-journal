/**
 * Web-specific persistence configuration for Legend-State
 * Uses IndexedDB for storage
 */

import { configureSynced } from '@legendapp/state/sync'
import { observablePersistIndexedDB } from '@legendapp/state/persist-plugins/indexeddb'

// Canonical RiverJournal IndexedDB schema source-of-truth. Both Legend-State
// (this module) and the TanStack Query adapter (state/queryStorage.ts) open
// the SAME database at the SAME version and MUST agree on the full set of
// object stores. Whichever caller fires `onupgradeneeded` first is responsible
// for creating any missing stores — otherwise a later opener at the same
// version sees no upgrade event and silently misses its store. Keep this list
// the only place store names are declared.
//
// 8: added 'onboarding-state' table for local-only first-launch onboarding
//    completion + resume state (see state/onboarding.ts). Never synced.
// 7: added 'device-state' table for cross-account device memory
// (lastAuthedUserId + acknowledgedAccountTransitions; see syncConfig.ts).
//    Survives sign-out by design; drives the previous-account banner.
// 6: added 'tanstack-query' object store for the plaintext server-visible
// query cache (separate domain from Legend-State; see queryStorage.ts).
// 5: added 'grace-days' table (was 4: added 'lapsed-state').
export const DB_NAME = 'RiverJournal'
export const DB_VERSION = 8
export const TABLE_NAMES = [
  'app-state',
  'flows',
  'entries',
  'lapsed-state',
  'grace-days',
  'tanstack-query',
  'device-state',
  'onboarding-state',
] as const

export const persistPlugin = observablePersistIndexedDB({
  databaseName: DB_NAME,
  version: DB_VERSION,
  // Spread to a mutable copy: TABLE_NAMES is a readonly `as const` tuple but
  // the plugin's tableNames param is a mutable string[].
  tableNames: [...TABLE_NAMES],
})

export const configurePersistence = configureSynced({
  persist: {
    plugin: persistPlugin,
  },
})

// Legend-State tables that sync to Supabase with `changesSince: 'last-sync'`
// (see syncConfig.ts). Each keeps a persisted `lastSync` cursor in its persist
// metadata. These are the ONLY observables whose cursor must be reset on
// sign-out — 'app-state' / 'lapsed-state' / 'device-state' are local-only.
export const SYNC_CURSOR_TABLES = ['flows', 'entries', 'grace-days'] as const

/**
 * Clears ONLY the `changesSince` (lastSync) metadata for the synced tables,
 * leaving the persisted row data intact. Called on sign-out so the NEXT login
 * performs a full pull instead of an incremental one — otherwise the new user's
 * older rows (created before the previous user's last sync) are silently never
 * fetched (missing history / broken streaks).
 *
 * We deliberately do NOT use syncState().resetPersistence(): that also deletes
 * the persisted DATA, which must survive sign-out so the previous-account
 * banner can still detect and offer to remove the prior user's local rows.
 *
 * `persistPlugin` is the SAME instance Legend-State reuses (it dedups a plugin
 * to a single instance internally), so deleteMetadata() clears both the
 * in-memory metadata cache and the IndexedDB row. Best-effort: a failure just
 * means the next login may do an incremental pull instead of a full one.
 */
export async function resetSyncCursors(): Promise<void> {
  for (const table of SYNC_CURSOR_TABLES) {
    try {
      await persistPlugin.deleteMetadata(table, {})
    } catch {
      // Best-effort — never block sign-out on cursor cleanup.
    }
  }
}
