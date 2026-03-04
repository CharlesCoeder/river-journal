/**
 * Web-specific persistence configuration for Legend-State
 * Uses IndexedDB for storage
 */

import { configureSynced } from '@legendapp/state/sync'
import { observablePersistIndexedDB } from '@legendapp/state/persist-plugins/indexeddb'

const DB_NAME = 'RiverJournal'
const DB_VERSION = 2
const TABLE_NAMES = ['app-state', 'flows', 'entries']

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
