/**
 * persistConfig.web.test.ts — the cross-tab IndexedDB open/upgrade handshake
 * that keeps a DB_VERSION bump from leaving the web app unable to boot.
 *
 * Runs against `fake-indexeddb`, which implements the real `blocked` /
 * `versionchange` semantics: an open at a higher version fires `versionchange`
 * on every existing connection, and fires `blocked` on the opener if any of
 * them fails to close. Each test gets a fresh IDBFactory so databases never
 * leak between cases.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { when } from '@legendapp/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)

import {
  DB_NAME,
  DB_VERSION,
  TABLE_NAMES,
  armPersistenceVersionChangeHandler,
  openPersistenceDatabase,
  persistPlugin,
} from '../persistConfig'
import { persistenceStatus$ } from '../persistenceStatus'

function openRaw(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version)
    req.onupgradeneeded = () => {
      // Deliberately creates nothing: simulates a build whose schema is
      // whatever the caller says it is, without touching object stores.
    }
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
  })
}

function settled<T>(p: Promise<T>): Promise<'pending' | 'settled'> {
  return Promise.race([
    p.then(
      () => 'settled' as const,
      () => 'settled' as const
    ),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 50)),
  ])
}

beforeEach(() => {
  ;(globalThis as any).indexedDB = new IDBFactory()
  persistenceStatus$.blockedByOtherTab.set(false)
  persistenceStatus$.staleTab.set(false)
})

afterEach(() => {
  ;(persistPlugin as unknown as { db?: IDBDatabase }).db = undefined
})

describe('openPersistenceDatabase — schema pre-flight', () => {
  it('creates every declared object store at DB_VERSION with in-line "id" keys, and closes its connection', async () => {
    await openPersistenceDatabase()

    const db = await openRaw()
    try {
      expect(db.version).toBe(DB_VERSION)
      for (const table of TABLE_NAMES) {
        expect(db.objectStoreNames.contains(table), `missing store ${table}`).toBe(true)
        expect(db.transaction(table).objectStore(table).keyPath).toBe('id')
      }
    } finally {
      db.close()
    }
    expect(persistenceStatus$.blockedByOtherTab.peek()).toBe(false)
  })

  it('is additive: an existing store from an older version is left intact', async () => {
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION - 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('flows', { keyPath: 'id' })
      }
      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve(req.result)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = legacy.transaction('flows', 'readwrite')
      tx.objectStore('flows').put({ id: 'keep-me' })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    legacy.close()

    await openPersistenceDatabase()

    const db = await openRaw()
    try {
      const row = await new Promise<unknown>((resolve, reject) => {
        const req = db.transaction('flows').objectStore('flows').get('keep-me')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      expect(row).toEqual({ id: 'keep-me' })
      expect(db.objectStoreNames.length).toBe(TABLE_NAMES.length)
    } finally {
      db.close()
    }
  })

  it('resolves immediately (no-op) when IndexedDB is unavailable, e.g. during SSR', async () => {
    ;(globalThis as any).indexedDB = undefined
    await expect(openPersistenceDatabase()).resolves.toBeUndefined()
  })
})

describe('openPersistenceDatabase — a stale tab blocking the upgrade', () => {
  it('reports blockedByOtherTab while an older-build tab holds the database, then completes once that tab closes', async () => {
    // An older build: holds a connection at DB_VERSION - 1 and, like the
    // shipped plugin, has NO versionchange handler, so it never steps aside.
    const staleTab = await openRaw(DB_VERSION - 1)

    const boot = openPersistenceDatabase()
    await when(persistenceStatus$.blockedByOtherTab)

    // Still blocked: boot must NOT have settled, but it must not have failed either.
    expect(await settled(boot)).toBe('pending')

    staleTab.close()
    await boot
    expect(persistenceStatus$.blockedByOtherTab.peek()).toBe(false)

    const db = await openRaw()
    try {
      expect(db.version).toBe(DB_VERSION)
    } finally {
      db.close()
    }
  })

  it('rejects instead of hanging when the stored database is NEWER than this build (rollback deploy)', async () => {
    const future = await openRaw(DB_VERSION + 1)
    future.close()

    await expect(openPersistenceDatabase()).rejects.toMatchObject({ name: 'VersionError' })
    expect(persistenceStatus$.blockedByOtherTab.peek()).toBe(false)
  })
})

describe('armPersistenceVersionChangeHandler — this tab yields to a newer build', () => {
  it('closes the plugin connection on versionchange so the newer tab is never blocked, and flags staleTab', async () => {
    // This build's tab: the plugin's live connection at the current version.
    await openPersistenceDatabase()
    const thisTab = await openRaw(DB_VERSION)
    ;(persistPlugin as unknown as { db?: IDBDatabase }).db = thisTab
    armPersistenceVersionChangeHandler()

    // A newer build in another tab bumps the version.
    const onBlocked = vi.fn()
    const newerTab = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION + 1)
      req.onblocked = onBlocked
      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve(req.result)
    })

    try {
      expect(onBlocked).not.toHaveBeenCalled()
      expect(newerTab.version).toBe(DB_VERSION + 1)
      expect(persistenceStatus$.staleTab.peek()).toBe(true)
      // The yielded connection is closed: any transaction on it must throw.
      expect(() => thisTab.transaction('flows')).toThrow()
    } finally {
      newerTab.close()
    }
  })

  it('is a safe no-op when the plugin has no live connection', () => {
    ;(persistPlugin as unknown as { db?: IDBDatabase }).db = undefined
    expect(() => armPersistenceVersionChangeHandler()).not.toThrow()
    expect(persistenceStatus$.staleTab.peek()).toBe(false)
  })

  it('the real plugin still stores its connection under `db` (the field this handshake depends on)', () => {
    // Vitest aliases the plugin to a mock, so guard the upstream-private-field
    // dependency at the source level: if a Legend-State upgrade renames `db`,
    // this fails loudly instead of silently un-arming the handler in prod.
    const pluginSource = readFileSync(
      require.resolve('@legendapp/state/persist-plugins/indexeddb'),
      'utf8'
    )
    expect(pluginSource).toMatch(/this\.db\s*=\s*openRequest\.result/)
  })
})
