/**
 * React Native-specific persistence configuration for Legend-State
 * Uses MMKV for storage
 */

import { configureSynced } from '@legendapp/state/sync'
import { ObservablePersistMMKV } from '@legendapp/state/persist-plugins/mmkv'

// Configure MMKV persistence
export const configurePersistence = configureSynced({
  persist: {
    name: 'app-state',
    plugin: ObservablePersistMMKV,
  },
})
