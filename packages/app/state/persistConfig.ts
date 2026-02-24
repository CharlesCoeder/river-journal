/**
 * Web-specific persistence configuration for Legend-State
 * Uses IndexedDB for storage
 */

import { configureSynced } from '@legendapp/state/sync'
import { observablePersistIndexedDB } from '@legendapp/state/persist-plugins/indexeddb'

// Database configuration for IndexedDB
const DB_NAME = 'RiverJournal'
const DB_VERSION = 2
const TABLE_NAMES = ['app-state', 'flows', 'entries']

// Configure IndexedDB persistence
export const configurePersistence = configureSynced({
  persist: {
    name: 'river-journal',
    plugin: observablePersistIndexedDB({
      databaseName: DB_NAME,
      version: DB_VERSION,
      tableNames: TABLE_NAMES,
    }),
  },
})
