/**
 * Web-specific persistence configuration for Legend-State
 * Uses IndexedDB for storage
 */

import { configureSynced } from '@legendapp/state/sync'
import { observablePersistIndexedDB } from '@legendapp/state/persist-plugins/indexeddb'

const DB_NAME = 'RiverJournal'
const DB_VERSION = 5 // 5: added 'grace-days' table (was 4: added 'lapsed-state')
const TABLE_NAMES = ['app-state', 'flows', 'entries', 'lapsed-state', 'grace-days']

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
