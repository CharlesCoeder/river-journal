/**
 * Web-specific persistence configuration for Legend-State
 * Uses IndexedDB for storage
 */

import { configureSynced } from '@legendapp/state/sync'
import { observablePersistIndexedDB } from '@legendapp/state/persist-plugins/indexeddb'

const DB_NAME = 'RiverJournal'
// 6: added 'tanstack-query' object store for the plaintext server-visible
// query cache (separate domain from Legend-State; see queryStorage.ts).
// 5: added 'grace-days' table (was 4: added 'lapsed-state').
const DB_VERSION = 6
const TABLE_NAMES = [
  'app-state',
  'flows',
  'entries',
  'lapsed-state',
  'grace-days',
  'tanstack-query',
]

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
