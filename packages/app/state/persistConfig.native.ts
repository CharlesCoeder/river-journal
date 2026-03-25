/**
 * React Native-specific persistence configuration for Legend-State
 * Uses MMKV v4 for storage (createMMKV API)
 *
 * Custom plugin because @legendapp/state/persist-plugins/mmkv still
 * imports the removed `MMKV` class constructor from mmkv v3.
 */

import { setAtPath, internal } from '@legendapp/state'
import { configureSynced } from '@legendapp/state/sync'
import { createMMKV } from 'react-native-mmkv'
import type { MMKV } from 'react-native-mmkv'

const symbolDefault = Symbol()
const MetadataSuffix = '__m'
const { safeParse, safeStringify } = internal

class MMKVPersistPlugin {
  private data: Record<string, any> = {}
  private storages = new Map<string | symbol, MMKV>([
    [symbolDefault, createMMKV({ id: 'obsPersist' })],
  ])
  private configuration: any

  constructor(configuration?: any) {
    this.configuration = configuration
  }

  getTable(table: string, init: any, config: any) {
    const storage = this.getStorage(config)
    if (this.data[table] === undefined) {
      try {
        const value = storage.getString(table)
        this.data[table] = value ? safeParse(value) : init
      } catch (e) {
        console.error('[legend-state] MMKV failed to parse', table)
      }
    }
    return this.data[table]
  }

  getMetadata(table: string, config: any) {
    return this.getTable(table + MetadataSuffix, {}, config)
  }

  set(table: string, changes: any[], config: any) {
    if (!this.data[table]) {
      this.data[table] = {}
    }
    for (let i = 0; i < changes.length; i++) {
      const { path, valueAtPath, pathTypes } = changes[i]
      this.data[table] = setAtPath(this.data[table], path, pathTypes, valueAtPath)
    }
    this.save(table, config)
  }

  setMetadata(table: string, metadata: any, config: any) {
    return this.setValue(table + MetadataSuffix, metadata, config)
  }

  deleteTable(table: string, config: any) {
    const storage = this.getStorage(config)
    delete this.data[table]
    storage.remove(table)
  }

  deleteMetadata(table: string, config: any) {
    this.deleteTable(table + MetadataSuffix, config)
  }

  private getStorage(config: any): MMKV {
    const configuration = config?.mmkv || this.configuration
    if (configuration) {
      const key = JSON.stringify(configuration)
      let storage = this.storages.get(key)
      if (!storage) {
        storage = createMMKV(configuration)
        this.storages.set(key, storage)
      }
      return storage
    }
    return this.storages.get(symbolDefault)!
  }

  private async setValue(table: string, value: any, config: any) {
    this.data[table] = value
    this.save(table, config)
  }

  private save(table: string, config: any) {
    const storage = this.getStorage(config)
    const v = this.data[table]
    if (v !== undefined) {
      try {
        storage.set(table, safeStringify(v))
      } catch (err) {
        console.error(err)
      }
    } else {
      storage.remove(table)
    }
  }
}

export const persistPlugin = MMKVPersistPlugin

export const configurePersistence = configureSynced({
  persist: {
    plugin: persistPlugin,
  },
})
