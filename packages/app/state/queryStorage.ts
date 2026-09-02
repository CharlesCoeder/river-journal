/**
 * Web/desktop AsyncStorage-shaped adapter over IndexedDB for TanStack Query
 * persistence.
 *
 * Owns a DEDICATED IndexedDB database (`RiverJournalQueryCache`, version 1)
 * containing a single object store, `'tanstack-query'`, created with
 * OUT-OF-LINE (explicit) keys — i.e. NO keyPath — so `store.put(value, key)`
 * is valid.
 *
 * Why a separate database: the shared `RiverJournal` database is also opened by
 * Legend-State's IndexedDB persist plugin (state/persistConfig.ts), which
 * creates every store it manages with `keyPath: 'id'` (in-line keys). Whichever
 * opener fires `onupgradeneeded` first wins the schema, and Legend-State opens
 * the DB first during boot — so a co-located `'tanstack-query'` store would end
 * up with `keyPath: 'id'`, and `put(value, explicitKey)` against an in-line-key
 * store throws a `DataError` on every write (Firefox: "Data provided to an
 * operation does not meet requirements"). Giving this cache its own database
 * eliminates the keyPath conflict entirely, with zero coordination needed with
 * Legend-State.
 *
 * Key namespace prefix: 'rj-tq:' — any callsite that writes here MUST include
 * the prefix in the key so a future grep catches stray persistence collisions.
 *
 * Resilience contract:
 *   - getItem returns `undefined` on any failure (never rejects).
 *   - setItem / removeItem swallow with `console.warn` (never reject).
 * The TanStack persister treats `getItem === undefined` as "no cache to
 * restore" — a far better failure mode than a rejected promise propagating
 * into the persist-client boot path.
 */

const DB_NAME = 'RiverJournalQueryCache'
const DB_VERSION = 1
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
      // This database is owned exclusively by this adapter, so there is no
      // second opener to coordinate with. Create the single store with
      // out-of-line keys (no keyPath) so `put(value, key)` is valid.
      const db = req.result
      if (!db.objectStoreNames.contains(TABLE_NAME)) {
        db.createObjectStore(TABLE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
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
