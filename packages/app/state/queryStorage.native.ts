/**
 * RN AsyncStorage-shaped adapter over a dedicated MMKV instance for TanStack
 * Query persistence. Uses a SEPARATE MMKV id (`'rj-tq'`) from the Legend-State
 * MMKV instance (`'obsPersist'` in persistConfig.native.ts) so the two
 * persistence domains stay strictly disjoint and can be cleared independently.
 *
 * Resilience contract (AC #20): getItem returns `undefined` on failure;
 * setItem / removeItem swallow with `console.warn`. The TanStack persister
 * treats `getItem === undefined` as "no cache to restore."
 */

import { createMMKV } from 'react-native-mmkv'

const storage = createMMKV({ id: 'rj-tq' })

export const queryStorage = {
  async getItem(key: string): Promise<string | undefined> {
    try {
      const value = storage.getString(key)
      return value === undefined ? undefined : value
    } catch (err) {
      console.warn('[rj-tq] getItem failed', err)
      return undefined
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      storage.set(key, value)
    } catch (err) {
      console.warn('[rj-tq] setItem failed', err)
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      storage.remove(key)
    } catch (err) {
      console.warn('[rj-tq] removeItem failed', err)
    }
  },
}
