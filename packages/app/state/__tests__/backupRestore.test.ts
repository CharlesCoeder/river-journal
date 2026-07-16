// @vitest-environment happy-dom
/**
 * Unit tests for the store-side additive restore action (`state/backupRestore.ts`)
 * against the REAL `entries$`/`flows$` observables. The expensive scrypt KDF is
 * swapped for a fast stand-in so a full encrypt→decrypt→restore round trip runs
 * cheaply while exercising the real serializer/planner/AEAD.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}))

vi.mock('app/utils/supabase', () => ({
  supabase: { rpc: rpcMock, from: fromMock },
}))

vi.mock('app/utils/encryption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/utils/encryption')>()
  const { createHash } = await import('node:crypto')
  return {
    ...actual,
    deriveMasterKeyFromPassword: async (password: string, saltB64: string) =>
      new Uint8Array(createHash('sha256').update(`${password}::${saltB64}`).digest()),
  }
})

import type { DailyEntryView, Entry, Flow } from 'app/state/types'
import { entries$ } from 'app/state/entries'
import { flows$ } from 'app/state/flows'
import { isSyncReady$ } from 'app/state/syncConfig'
import { restoreBackup } from '../backupRestore'
import { buildBackupPayload, type BackupPayload } from 'app/utils/backupJournal'
import { encryptBackup, decryptBackup } from 'app/utils/backupCrypto'
import { parseAndValidateBackup } from 'app/utils/backupJournal'

function entry(id: string, userId: string | null = 'me'): Entry {
  return {
    id,
    entryDate: '2026-04-10',
    lastModified: '2026-04-10T12:00:00.000Z',
    user_id: userId,
    local_session_id: 'session-1',
  }
}

function flow(id: string, entryId: string, userId: string | null = 'me'): Flow {
  return {
    id,
    dailyEntryId: entryId,
    timestamp: '2026-04-10T12:00:00.000Z',
    content: 'a written passage',
    wordCount: 3,
    user_id: userId,
    local_session_id: 'session-1',
  }
}

function payloadOf(entries: Entry[], flows: Flow[]): BackupPayload {
  return {
    schemaVersion: 1,
    createdAt: 'x',
    appVersion: '1.0.0',
    entryCount: entries.length,
    flowCount: flows.length,
    entries,
    flows,
  }
}

beforeEach(() => {
  entries$.set({})
  flows$.set({})
  isSyncReady$.set(false)
  rpcMock.mockClear()
  fromMock.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('restoreBackup — additive single-batch merge', () => {
  it('skips existing ids and inserts new ones with a correct counts summary', () => {
    entries$.set({ e1: entry('e1') })
    flows$.set({ f1: flow('f1', 'e1') })

    const result = restoreBackup(
      payloadOf([entry('e1'), entry('e2')], [flow('f1', 'e1'), flow('f2', 'e2')])
    )

    expect(result).toEqual({
      entriesRestored: 1,
      flowsRestored: 1,
      entriesSkipped: 1,
      flowsSkipped: 1,
    })
    expect(Object.keys(entries$.get() ?? {}).sort()).toEqual(['e1', 'e2'])
    expect(Object.keys(flows$.get() ?? {}).sort()).toEqual(['f1', 'f2'])
  })

  it('is a calm no-op for an empty payload', () => {
    entries$.set({ e1: entry('e1') })
    const result = restoreBackup(payloadOf([], []))
    expect(result).toEqual({
      entriesRestored: 0,
      flowsRestored: 0,
      entriesSkipped: 0,
      flowsSkipped: 0,
    })
    expect(Object.keys(entries$.get() ?? {})).toEqual(['e1'])
  })

  it('inserts a foreign-owned item verbatim and does not flip isSyncReady$', () => {
    restoreBackup(
      payloadOf([entry('e-foreign', 'other-user')], [flow('f-foreign', 'e-foreign', 'other-user')])
    )

    expect(entries$['e-foreign']!.get()?.user_id).toBe('other-user')
    expect(flows$['f-foreign']!.get()?.user_id).toBe('other-user')
    expect(isSyncReady$.get()).toBe(false)
  })
})

describe('full encrypt → decrypt → restore round trip', () => {
  it('deep-equals the original corpus (ignoring lastModified) and touches no network', async () => {
    const fetchSpy = vi.fn()
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    try {
      entries$.set({ e1: entry('e1'), e2: entry('e2') })
      flows$.set({ f1: flow('f1', 'e1'), f2: flow('f2', 'e2') })

      const view = (id: string): DailyEntryView =>
        ({ ...entry(id), flows: [], totalWords: 0 }) as unknown as DailyEntryView
      // Build the payload from the real view shape (entry + embedded flows).
      const views: DailyEntryView[] = [
        { ...view('e1'), flows: [flow('f1', 'e1')], totalWords: 3 } as unknown as DailyEntryView,
        { ...view('e2'), flows: [flow('f2', 'e2')], totalWords: 3 } as unknown as DailyEntryView,
      ]
      const payload = buildBackupPayload(views, 'me', '1.0.0')
      const originalEntries = entries$.get()
      const originalFlows = flows$.get()

      const ciphertext = await encryptBackup(JSON.stringify(payload), 'a passphrase')

      // Fresh device.
      entries$.set({})
      flows$.set({})

      const decrypted = await decryptBackup(ciphertext, 'a passphrase')
      const parsed = parseAndValidateBackup(decrypted)
      restoreBackup(parsed)

      const stripLm = (obj: Record<string, unknown> | undefined) =>
        Object.fromEntries(
          Object.entries(obj ?? {}).map(([id, v]) => [
            id,
            { ...(v as object), lastModified: undefined },
          ])
        )
      expect(stripLm(entries$.get())).toEqual(stripLm(originalEntries))
      expect(flows$.get()).toEqual(originalFlows)

      expect(rpcMock).not.toHaveBeenCalled()
      expect(fromMock).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
