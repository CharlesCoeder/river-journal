/**
 * Web/desktop AsyncStorage-shaped adapter over IndexedDB for TanStack Query
 * persistence. Reuses the `RiverJournal` database opened by persistConfig.ts
 * (single DB, separate object store: `'tanstack-query'`). The schema authority
 * is `state/persistConfig.ts` — DB_NAME, DB_VERSION, and TABLE_NAMES live
 * there and are imported here so both openers agree on the full schema.
 *
 * Key namespace prefix: 'rj-tq:' — any callsite that writes here MUST include
 * the prefix in the key so a future grep catches stray persistence collisions.
 *
 * Resilience contract (AC #20):
 *   - getItem returns `undefined` on any failure (never rejects).
 *   - setItem / removeItem swallow with `console.warn` (never reject).
 * The TanStack persister treats `getItem === undefined` as "no cache to
 * restore" — a far better failure mode than a rejected promise propagating
 * into the persist-client boot path.
 */

import { DB_NAME, DB_VERSION, TABLE_NAMES } from './persistConfig'

const TABLE_NAME = 'tanstack-query'

function hasIndexedDB(): boolean {
  return typeof globalThis !== 'undefined' && typeof (globalThis as any).indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = (globalThis as any).indexedDB.open(DB_NAME, DB_VERSION) as IDBOpenDBRequest
    req.onupgradeneeded = () => {
      // Race-safety: whichever caller (this adapter vs. Legend-State's
      // observablePersistIndexedDB) opens the DB first at a new version is
      // the ONLY one that receives `onupgradeneeded`. Therefore each
      // upgrade handler must create EVERY expected store, not just the one
      // it directly cares about — otherwise the later opener at the same
      // version sees no upgrade event and its store is silently missing.
      const db = req.result
      for (const name of TABLE_NAMES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name)
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    openDb()
      .then((db) => {
        let store: IDBObjectStore
        try {
          store = db.transaction(TABLE_NAME, mode).objectStore(TABLE_NAME)
        } catch (err) {
          db.close()
          reject(err)
          return
        }
        const req = run(store)
        req.onsuccess = () => {
          resolve(req.result)
          db.close()
        }
        req.onerror = () => {
          reject(req.error ?? new Error('IndexedDB request failed'))
          db.close()
        }
      })
      .catch(reject)
  })
}

export const queryStorage = {
  async getItem(key: string): Promise<string | undefined> {
    try {
      const value = await tx<unknown>('readonly', (store) => store.get(key))
      if (value === undefined || value === null) return undefined
      return typeof value === 'string' ? value : String(value)
    } catch (err) {
      console.warn('[rj-tq] getItem failed', err)
      return undefined
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      await tx('readwrite', (store) => store.put(value, key))
    } catch (err) {
      console.warn('[rj-tq] setItem failed', err)
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      await tx('readwrite', (store) => store.delete(key))
    } catch (err) {
      console.warn('[rj-tq] removeItem failed', err)
    }
  },
}
