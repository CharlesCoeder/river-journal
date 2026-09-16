/**
 * Web-specific persistence configuration for Legend-State
 * Uses IndexedDB for storage
 */

import { configureSynced } from '@legendapp/state/sync'
import { observablePersistIndexedDB } from '@legendapp/state/persist-plugins/indexeddb'
import { persistenceStatus$ } from './persistenceStatus'

// Canonical RiverJournal IndexedDB schema source-of-truth for Legend-State's
// persist plugin. Legend-State creates every store listed here with
// `keyPath: 'id'` (in-line keys). Keep this list the only place store names are
// declared.
//
// NOTE: 'tanstack-query' remains in this list for backward compatibility — the
// store was created here in DB_VERSION 6 and removing it would require a risky
// production IndexedDB migration. Nothing writes to it: the TanStack Query
// cache adapter (state/queryStorage.ts) now owns a SEPARATE database
// (`RiverJournalQueryCache`) with an out-of-line-key store, precisely because
// Legend-State's forced `keyPath: 'id'` here is incompatible with the
// explicit-key `put(value, key)` writes the query cache requires.
//
// 13: added 'billing-receipt' table for the local-only app-open entitlement
//     re-validation receipt (the `cs_...`/receipt id to re-POST on app open;
//     see state/billing.ts). Never synced, never encrypted. Additive-only
//     upgrade: the new object store is created and every existing table is left
//     intact.
// 12: added 'telemetry-consent' table for the local-only, per-device telemetry
//     opt-in preference (default OFF; gates telemetry SDK init; see
//     state/telemetryConsent.ts). Never synced. Additive-only upgrade: the new
//     object store is created and every existing table is left intact.
// 11: added 'app-lock' table for the local-only, per-device App Lock
//     preference (on/off + auto-lock interval + passcode salt/verifier; see
//     state/appLock.ts). Never synced. Additive-only upgrade: the new object
//     store is created and every existing table is left intact.
// 10: added 'push-tokens' table for user_push_tokens synced observable
//     (device push tokens for notification fan-out; see state/push_tokens.ts).
// 9: added 'auth-return' table for local-only post-auth intent markers
//    (pending Collective return + deferred Google-web attestation; see
//    state/authReturn.ts). Never synced.
// 8: added 'onboarding-state' table for local-only first-launch onboarding
//    completion + resume state (see state/onboarding.ts). Never synced.
// 7: added 'device-state' table for cross-account device memory
// (lastAuthedUserId + acknowledgedAccountTransitions; see syncConfig.ts).
//    Survives sign-out by design; drives the previous-account banner.
// 6: added 'tanstack-query' object store for the plaintext server-visible
// query cache (separate domain from Legend-State; see queryStorage.ts).
// 5: added 'grace-days' table (was 4: added 'lapsed-state').
export const DB_NAME = 'RiverJournal'
export const DB_VERSION = 13
export const TABLE_NAMES = [
  'app-state',
  'flows',
  'entries',
  'lapsed-state',
  'grace-days',
  'tanstack-query',
  'device-state',
  'onboarding-state',
  'auth-return',
  'push-tokens',
  'app-lock',
  'telemetry-consent',
  'billing-receipt',
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
export const SYNC_CURSOR_TABLES = ['flows', 'entries', 'grace-days', 'push-tokens'] as const

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

// ─── Cross-tab open/upgrade handshake ─────────────────────────────────────────
//
// Legend-State's IndexedDB plugin opens the database with no `onblocked`
// handler, an `onerror` that only logs, and no `versionchange` handler on the
// resulting connection. Because `initializePersistence()` awaits every store's
// `isPersistLoaded`, that means:
//
//   1. If a tab running an OLDER build still holds the database open, a tab
//      running a build with a bumped DB_VERSION is `blocked` on its upgrade,
//      its persist promises never settle, and the app never boots — with no
//      UI to explain why. Re-armed by every DB_VERSION bump.
//   2. If the open request errors (e.g. VersionError after a rollback deploy
//      leaves the stored version newer than the build's), the promise never
//      settles either.
//   3. A tab running THIS build would, without a versionchange handler, be the
//      "older tab" that blocks the next bump.
//
// The two helpers below fix all three without patching the plugin:
// `openPersistenceDatabase()` runs BEFORE the plugin's own open, performs the
// identical additive upgrade under our own handlers (blocked → status flag,
// error → reject), and closes; the plugin's subsequent open then finds the
// schema already at DB_VERSION and needs no upgrade. IndexedDB serializes
// open requests on one database, so the plugin can never race ahead of us.
// `armPersistenceVersionChangeHandler()` runs AFTER persistence has loaded and
// makes the plugin's live connection step aside for a future newer tab.

/**
 * Pre-flight open of the RiverJournal database at DB_VERSION, creating any
 * missing object store exactly as the plugin would (`keyPath: 'id'`, every
 * name in TABLE_NAMES, never deleting). Resolves once the schema is at
 * DB_VERSION and our connection is closed again. While an older tab blocks
 * the upgrade, `persistenceStatus$.blockedByOtherTab` is true; it clears on
 * success. Rejects (instead of hanging) if the open request errors. No-op
 * outside a browser (SSR / tests without IndexedDB).
 */
export function openPersistenceDatabase(): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(error)
      return
    }

    request.onblocked = () => {
      persistenceStatus$.blockedByOtherTab.set(true)
    }

    request.onupgradeneeded = () => {
      const db = request.result
      for (const table of TABLE_NAMES) {
        if (!db.objectStoreNames.contains(table)) {
          db.createObjectStore(table, { keyPath: 'id' })
        }
      }
    }

    request.onerror = () => {
      persistenceStatus$.blockedByOtherTab.set(false)
      reject(request.error ?? new Error('IndexedDB open failed'))
    }

    request.onsuccess = () => {
      persistenceStatus$.blockedByOtherTab.set(false)
      request.result.close()
      resolve()
    }
  })
}

/**
 * Makes this tab's live persistence connection yield to a newer build.
 *
 * Call once persistence has loaded (the plugin only assigns its connection in
 * its own `onsuccess`). When another tab opens the database at a higher
 * version, `versionchange` fires here; we close the connection immediately so
 * the newer tab's upgrade is not blocked, and flag `persistenceStatus$.staleTab`
 * so the boot gate replaces the UI with a reload prompt — after `close()` this
 * tab can no longer persist anything, so it must not keep accepting edits.
 *
 * Reads the plugin's `db` field, which upstream declares `private`; it is the
 * only handle to the connection the plugin exposes. Best-effort: if the field
 * is ever absent the handler is simply not armed (the pre-flight open still
 * protects the NEXT tab's boot from hanging, just without auto-yield).
 */
export function armPersistenceVersionChangeHandler(): void {
  const db = (persistPlugin as unknown as { db?: IDBDatabase }).db
  if (!db) return
  db.onversionchange = () => {
    db.close()
    persistenceStatus$.staleTab.set(true)
  }
}
