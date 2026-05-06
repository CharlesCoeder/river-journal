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
// 6: added 'tanstack-query' object store for the plaintext server-visible
// query cache (separate domain from Legend-State; see queryStorage.ts).
// 5: added 'grace-days' table (was 4: added 'lapsed-state').
export const DB_NAME = 'RiverJournal'
export const DB_VERSION = 6
export const TABLE_NAMES = [
  'app-state',
  'flows',
  'entries',
  'lapsed-state',
  'grace-days',
  'tanstack-query',
] as const

export const persistPlugin = observablePersistIndexedDB({
  databaseName: DB_NAME,
  version: DB_VERSION,
  tableNames: TABLE_NAMES,
})

export const configurePersistence = configureSynced({
  persist: {
    plugin: persistPlugin,
  },
})
