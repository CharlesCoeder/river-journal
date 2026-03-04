/**
 * React Native-specific persistence configuration for Legend-State
 * Uses MMKV for storage
 */

import { configureSynced } from '@legendapp/state/sync'
import { ObservablePersistMMKV } from '@legendapp/state/persist-plugins/mmkv'

export const persistPlugin = ObservablePersistMMKV

export const configurePersistence = configureSynced({
  persist: {
    plugin: persistPlugin,
  },
})
