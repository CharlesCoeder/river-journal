import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('../../utils/supabase', () => ({
  supabase: {},
}))

import {
  generateUUID,
  dbEntryToLocal,
  localEntryToDb,
  dbFlowToLocal,
  localFlowToDb,
  mapDbFlowToLocalOrKeepExisting,
  syncEncryptionError$,
  syncEncryptionMode$,
  syncManagedKeyHex$,
  syncUserId$,
} from '../syncConfig'
import {
  deriveMasterKeyFromPassword,
  encryptFlowContentManaged,
  generateManagedEncryptionKey,
  isEncryptedFlowPayload,
  isManagedEncryptedPayload,
} from '../../utils/encryption'
import { clearStoredMasterKey, storeMasterKey } from '../../utils/encryptionKeyStore'
import { hexToBytes } from '@noble/ciphers/utils.js'

describe('generateUUID', () => {
  it('returns a valid UUID v4 format', () => {
    const uuid = generateUUID()
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUUID()))
    expect(ids.size).toBe(100)
  })
})

describe('Entry transforms', () => {
  const dbRow = {
    id: 'e1',
    entry_date: '2026-03-03',
    user_id: 'u1',
    created_at: '2026-03-03T10:00:00Z',
    updated_at: '2026-03-03T12:00:00Z',
    is_deleted: false,
  }

  it('dbEntryToLocal converts snake_case → camelCase', () => {
    const local = dbEntryToLocal(dbRow)
    expect(local).toEqual({
      id: 'e1',
      entryDate: '2026-03-03',
      lastModified: '2026-03-03T12:00:00Z',
      user_id: 'u1',
      local_session_id: '',
    })
  })

  it('localEntryToDb converts camelCase → snake_case', () => {
    const db = localEntryToDb({
      id: 'e1',
      entryDate: '2026-03-03',
      lastModified: '2026-03-03T12:00:00Z',
      user_id: 'u1',
      local_session_id: 'sess1',
    })
    expect(db).toEqual({
      id: 'e1',
      entry_date: '2026-03-03',
      user_id: 'u1',
    })
    // local-only fields must not leak to DB
    expect(db).not.toHaveProperty('local_session_id')
    expect(db).not.toHaveProperty('lastModified')
    expect(db).not.toHaveProperty('updated_at')
  })

  it('localEntryToDb handles partial updates', () => {
    const db = localEntryToDb({ id: 'e1', entryDate: '2026-03-04' })
    expect(db).toEqual({ id: 'e1', entry_date: '2026-03-04' })
  })
})

describe('Flow transforms', () => {
  beforeEach(async () => {
    syncEncryptionError$.set(null)
    syncEncryptionMode$.set(null)
    syncManagedKeyHex$.set(null)
    syncUserId$.set('user-1')
    await clearStoredMasterKey('user-1')
  })

  const dbRow = {
    id: 'f1',
    daily_entry_id: 'e1',
    content: 'Hello world',
    word_count: 2,
    created_at: '2026-03-03T10:05:00Z',
    updated_at: '2026-03-03T10:05:00Z',
    is_deleted: false,
  }

  it('dbFlowToLocal converts snake_case → camelCase', () => {
    const local = dbFlowToLocal(dbRow)
    expect(local).toEqual({
      id: 'f1',
      dailyEntryId: 'e1',
      content: 'Hello world',
      wordCount: 2,
      timestamp: '2026-03-03T10:05:00Z',
      local_session_id: '',
    })
  })

  it('dbFlowToLocal maps created_at → timestamp', () => {
    const local = dbFlowToLocal(dbRow)
    expect(local.timestamp).toBe(dbRow.created_at)
  })

  it('localFlowToDb converts camelCase → snake_case', () => {
    const db = localFlowToDb({
      id: 'f1',
      dailyEntryId: 'e1',
      content: 'Hello world',
      wordCount: 2,
      timestamp: '2026-03-03T10:05:00Z',
      local_session_id: 'sess1',
    })
    expect(db).toEqual({
      id: 'f1',
      daily_entry_id: 'e1',
      content: 'Hello world',
      word_count: 2,
      created_at: '2026-03-03T10:05:00Z',
    })
    expect(db).not.toHaveProperty('local_session_id')
    expect(db).not.toHaveProperty('user_id')
  })

  it('localFlowToDb handles partial updates', () => {
    const db = localFlowToDb({ id: 'f1', content: 'Updated text', wordCount: 2 })
    expect(db).toEqual({
      id: 'f1',
      content: 'Updated text',
      word_count: 2,
    })
    expect(db).not.toHaveProperty('daily_entry_id')
  })

  it('encrypts flow content at the sync boundary for e2e mode and decrypts on load', async () => {
    const key = await deriveMasterKeyFromPassword(
      'correct horse battery staple',
      '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df'
    )
    await storeMasterKey('user-1', key)
    syncEncryptionMode$.set('e2e')

    const plaintext = 'Flow content that should be encrypted in Supabase.'
    const db = localFlowToDb({
      id: 'f1',
      dailyEntryId: 'e1',
      content: plaintext,
      wordCount: 8,
      timestamp: '2026-03-03T10:05:00Z',
      user_id: 'user-1',
      local_session_id: 'sess1',
    })

    expect(db).toHaveProperty('content')
    expect(typeof db.content).toBe('string')
    expect(db.content).not.toBe(plaintext)
    expect(isEncryptedFlowPayload(db.content as string)).toBe(true)

    const local = dbFlowToLocal({
      ...dbRow,
      content: db.content as string,
    })

    expect(local.content).toBe(plaintext)
    expect(syncEncryptionError$.get()).toBeNull()
  })

  it('fails loudly instead of uploading plaintext when e2e mode has no local key', () => {
    syncEncryptionMode$.set('e2e')

    expect(() =>
      localFlowToDb({
        id: 'f1',
        dailyEntryId: 'e1',
        content: 'should not upload',
        user_id: 'user-1',
        local_session_id: 'sess1',
      })
    ).toThrowError(/e2e_password_required/)

    expect(syncEncryptionError$.get()).toEqual({
      message: 'Encryption password required on this device before encrypted flows can sync.',
      code: 'e2e_password_required',
    })
  })

  it('surfaces explicit errors when encrypted payload cannot be decrypted', async () => {
    const encryptionKey = await deriveMasterKeyFromPassword(
      'correct horse battery staple',
      '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df'
    )
    await storeMasterKey('user-1', encryptionKey)
    syncEncryptionMode$.set('e2e')

    const dbPayload = localFlowToDb({
      id: 'f1',
      dailyEntryId: 'e1',
      content: 'secret text',
      user_id: 'user-1',
      local_session_id: 'sess1',
    })

    await clearStoredMasterKey('user-1')
    const wrongKey = await deriveMasterKeyFromPassword(
      'wrong key',
      '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df'
    )
    await storeMasterKey('user-1', wrongKey)

    expect(() =>
      dbFlowToLocal({
        ...dbRow,
        content: dbPayload.content as string,
      })
    ).toThrowError(/flow_decrypt_failed/)

    expect(syncEncryptionError$.get()?.code).toBe('flow_decrypt_failed')
  })

  it('preserves existing local plaintext when a downloaded encrypted row cannot be decrypted', async () => {
    const encryptionKey = await deriveMasterKeyFromPassword(
      'correct horse battery staple',
      '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df'
    )
    await storeMasterKey('user-1', encryptionKey)
    syncEncryptionMode$.set('e2e')

    const dbPayload = localFlowToDb({
      id: 'f1',
      dailyEntryId: 'e1',
      content: 'secret text',
      user_id: 'user-1',
      local_session_id: 'sess1',
    })

    await clearStoredMasterKey('user-1')
    const wrongKey = await deriveMasterKeyFromPassword(
      'wrong key',
      '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df'
    )
    await storeMasterKey('user-1', wrongKey)

    const existingLocalFlow = {
      id: 'f1',
      dailyEntryId: 'e1',
      content: 'existing plaintext',
      wordCount: 2,
      timestamp: '2026-03-03T10:05:00Z',
      local_session_id: 'sess1',
    }

    const result = mapDbFlowToLocalOrKeepExisting(
      {
        ...dbRow,
        content: dbPayload.content as string,
      },
      existingLocalFlow
    )

    expect(result).toEqual(existingLocalFlow)
    expect(syncEncryptionError$.get()?.code).toBe('flow_decrypt_failed')
  })

  it('drops unreadable encrypted rows instead of leaking ciphertext into local state', async () => {
    const encryptionKey = await deriveMasterKeyFromPassword(
      'correct horse battery staple',
      '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df'
    )
    await storeMasterKey('user-1', encryptionKey)
    syncEncryptionMode$.set('e2e')

    const dbPayload = localFlowToDb({
      id: 'f1',
      dailyEntryId: 'e1',
      content: 'secret text',
      user_id: 'user-1',
      local_session_id: 'sess1',
    })

    await clearStoredMasterKey('user-1')
    const wrongKey = await deriveMasterKeyFromPassword(
      'wrong key',
      '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df'
    )
    await storeMasterKey('user-1', wrongKey)

    const result = mapDbFlowToLocalOrKeepExisting({
      ...dbRow,
      content: dbPayload.content as string,
    })

    expect(result).toBeNull()
    expect(syncEncryptionError$.get()?.code).toBe('flow_decrypt_failed')
  })

  it('encrypts flow content with managed prefix in managed mode', () => {
    const keyHex = generateManagedEncryptionKey()
    syncManagedKeyHex$.set(keyHex)
    syncEncryptionMode$.set('managed')

    const plaintext = 'Managed encryption content'
    const db = localFlowToDb({
      id: 'f1',
      dailyEntryId: 'e1',
      content: plaintext,
      wordCount: 3,
      timestamp: '2026-03-10T10:00:00Z',
      user_id: 'user-1',
      local_session_id: 'sess1',
    })

    expect(db.content).not.toBe(plaintext)
    expect(isManagedEncryptedPayload(db.content as string)).toBe(true)
    expect(isEncryptedFlowPayload(db.content as string)).toBe(false)
    expect(syncEncryptionError$.get()).toBeNull()
  })

  it('decrypts managed-prefix content from DB using the managed key', () => {
    const keyHex = generateManagedEncryptionKey()
    const managedKey = hexToBytes(keyHex)
    syncManagedKeyHex$.set(keyHex)

    const plaintext = 'Managed round-trip test'
    const encrypted = encryptFlowContentManaged(plaintext, managedKey)

    const local = dbFlowToLocal({
      ...dbRow,
      content: encrypted,
    })

    expect(local.content).toBe(plaintext)
    expect(syncEncryptionError$.get()).toBeNull()
  })

  it('managed encrypt/decrypt round-trips through sync transforms', () => {
    const keyHex = generateManagedEncryptionKey()
    syncManagedKeyHex$.set(keyHex)
    syncEncryptionMode$.set('managed')

    const plaintext = 'Full managed round-trip through sync transforms'
    const db = localFlowToDb({
      id: 'f1',
      dailyEntryId: 'e1',
      content: plaintext,
      wordCount: 7,
      timestamp: '2026-03-10T10:00:00Z',
      user_id: 'user-1',
      local_session_id: 'sess1',
    })

    const local = dbFlowToLocal({
      ...dbRow,
      content: db.content as string,
    })

    expect(local.content).toBe(plaintext)
  })

  it('fails loudly when managed mode has no cached key', () => {
    syncEncryptionMode$.set('managed')
    syncManagedKeyHex$.set(null)

    expect(() =>
      localFlowToDb({
        id: 'f1',
        dailyEntryId: 'e1',
        content: 'should not upload',
        user_id: 'user-1',
        local_session_id: 'sess1',
      })
    ).toThrowError(/managed_key_missing/)

    expect(syncEncryptionError$.get()).toEqual({
      message: 'Managed encryption key is not available. Please sign in again.',
      code: 'managed_key_missing',
    })
  })

  it('E2E payloads still use the E2E decrypt path even when managed key is available', async () => {
    const e2eKey = await deriveMasterKeyFromPassword(
      'correct horse battery staple',
      '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df'
    )
    await storeMasterKey('user-1', e2eKey)
    syncEncryptionMode$.set('e2e')

    // Also set a managed key to prove it doesn't interfere
    syncManagedKeyHex$.set(generateManagedEncryptionKey())

    const plaintext = 'E2E content still works'
    const db = localFlowToDb({
      id: 'f1',
      dailyEntryId: 'e1',
      content: plaintext,
      user_id: 'user-1',
      local_session_id: 'sess1',
    })

    expect(isEncryptedFlowPayload(db.content as string)).toBe(true)
    expect(isManagedEncryptedPayload(db.content as string)).toBe(false)

    const local = dbFlowToLocal({
      ...dbRow,
      content: db.content as string,
    })
    expect(local.content).toBe(plaintext)
  })
})
