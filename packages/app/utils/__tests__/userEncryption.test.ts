import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptFlowContent, deriveMasterKeyFromPassword } from '../encryption'

const {
  mockUsersSingle,
  mockUsersSelect,
  mockUsersUpsert,
  mockFlowsLimit,
  mockFlowsSelect,
  mockFrom,
  mockStoreMasterKey,
  mockCacheOnlyMasterKey,
  mockClearStoredMasterKey,
} = vi.hoisted(() => {
  const usersSingle = vi.fn()
  const usersSelect = vi.fn(() => ({ single: usersSingle }))
  const usersUpsert = vi.fn(() => ({ select: usersSelect }))
  const flowsLimit = vi.fn()
  const flowsSelect = vi.fn(() => ({ limit: flowsLimit }))
  const from = vi.fn((table: string) => {
    if (table === 'users') {
      return { upsert: usersUpsert }
    }

    if (table === 'flows') {
      return { select: flowsSelect }
    }

    throw new Error(`Unexpected table: ${table}`)
  })
  const storeMasterKey = vi.fn()
  const cacheOnlyMasterKey = vi.fn()
  const clearStoredMasterKey = vi.fn()

  return {
    mockUsersSingle: usersSingle,
    mockUsersSelect: usersSelect,
    mockUsersUpsert: usersUpsert,
    mockFlowsLimit: flowsLimit,
    mockFlowsSelect: flowsSelect,
    mockFrom: from,
    mockStoreMasterKey: storeMasterKey,
    mockCacheOnlyMasterKey: cacheOnlyMasterKey,
    mockClearStoredMasterKey: clearStoredMasterKey,
  }
})

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}))

vi.mock('../encryptionKeyStore', () => ({
  storeMasterKey: mockStoreMasterKey,
  cacheOnlyMasterKey: mockCacheOnlyMasterKey,
  clearStoredMasterKey: mockClearStoredMasterKey,
  loadMasterKey: vi.fn(),
  getCachedMasterKey: vi.fn(),
  hasStoredMasterKey: vi.fn(),
  hasPlatformKeyring: vi.fn().mockResolvedValue(false),
}))

import {
  startE2EEncryptionBootstrap,
  unlockE2EEncryptionOnDevice,
  persistMasterKeyToKeyring,
} from '../userEncryption'

describe('startE2EEncryptionBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsersSingle.mockResolvedValue({
      data: { encryption_mode: 'e2e', encryption_salt: 'abc123' },
      error: null,
    })
    mockFlowsLimit.mockResolvedValue({
      data: [],
      error: null,
    })
    mockStoreMasterKey.mockResolvedValue(undefined)
    mockClearStoredMasterKey.mockResolvedValue(undefined)
  })

  it('persists mode+salt, caches the key in memory, and returns the master key', async () => {
    const result = await startE2EEncryptionBootstrap({
      userId: 'user-1',
      password: 'correct horse battery staple',
    })

    expect(result.error).toBeNull()
    expect(result.masterKey).toBeInstanceOf(Uint8Array)
    expect(mockFrom).toHaveBeenCalledWith('users')
    expect(mockUsersUpsert).toHaveBeenCalledTimes(1)

    const upsertCalls = mockUsersUpsert.mock.calls as unknown as Array<[Record<string, unknown>]>
    const payload = upsertCalls[0][0]
    expect(payload.id).toBe('user-1')
    expect(payload.encryption_mode).toBe('e2e')
    expect(typeof payload.encryption_salt).toBe('string')
    expect(payload.encryption_salt).toMatch(/^[0-9a-f]+$/)
    expect(payload).not.toHaveProperty('password')

    // Key is cached in memory only — not written to keyring
    expect(mockCacheOnlyMasterKey).toHaveBeenCalledWith('user-1', expect.any(Uint8Array))
    expect(mockStoreMasterKey).not.toHaveBeenCalled()
  })

  it('returns a structured error when salt persistence fails', async () => {
    mockUsersSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'DB failed', code: 'db_failed' },
    })

    const result = await startE2EEncryptionBootstrap({
      userId: 'user-1',
      password: 'correct horse battery staple',
    })

    expect(result.error).toEqual({
      message: 'DB failed',
      code: 'db_failed',
    })
    expect(result.masterKey).toBeNull()
    expect(mockCacheOnlyMasterKey).not.toHaveBeenCalled()
    expect(mockStoreMasterKey).not.toHaveBeenCalled()
  })
})

describe('unlockE2EEncryptionOnDevice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlowsLimit.mockResolvedValue({
      data: [],
      error: null,
    })
    mockStoreMasterKey.mockResolvedValue(undefined)
    mockClearStoredMasterKey.mockResolvedValue(undefined)
  })

  it('derives and caches the local key in memory without writing to keyring', async () => {
    const result = await unlockE2EEncryptionOnDevice({
      userId: 'user-1',
      password: 'correct horse battery staple',
      salt: '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df',
    })

    expect(result.error).toBeNull()
    expect(result.masterKey).toBeInstanceOf(Uint8Array)
    expect(mockFrom).toHaveBeenCalledWith('flows')
    expect(mockCacheOnlyMasterKey).toHaveBeenCalledWith('user-1', expect.any(Uint8Array))
    expect(mockStoreMasterKey).not.toHaveBeenCalled()
  })

  it('rejects the wrong encryption password when existing encrypted flows cannot be decrypted', async () => {
    const correctKey = await deriveMasterKeyFromPassword(
      'correct horse battery staple',
      '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df'
    )
    const encryptedPayload = encryptFlowContent('secret text', correctKey)

    mockFlowsLimit.mockResolvedValueOnce({
      data: [{ id: 'flow-1', content: encryptedPayload }],
      error: null,
    })

    const result = await unlockE2EEncryptionOnDevice({
      userId: 'user-1',
      password: 'wrong password',
      salt: '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df',
    })

    expect(result.error).toEqual({
      message: 'Encryption password is incorrect for this account.',
      code: 'invalid_encryption_password',
    })
    expect(result.masterKey).toBeNull()
    expect(mockCacheOnlyMasterKey).not.toHaveBeenCalled()
    expect(mockStoreMasterKey).not.toHaveBeenCalled()
  })
})

describe('persistMasterKeyToKeyring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreMasterKey.mockResolvedValue(undefined)
  })

  it('writes the key to the platform keyring', async () => {
    const key = new Uint8Array(32).fill(1)
    const result = await persistMasterKeyToKeyring({ userId: 'user-1', masterKey: key })

    expect(result.error).toBeNull()
    expect(mockStoreMasterKey).toHaveBeenCalledWith('user-1', key)
  })

  it('returns a structured error when keyring write fails', async () => {
    mockStoreMasterKey.mockRejectedValueOnce(new Error('keychain unavailable'))
    const key = new Uint8Array(32).fill(1)

    const result = await persistMasterKeyToKeyring({ userId: 'user-1', masterKey: key })

    expect(result.error).toEqual({
      message: 'keychain unavailable',
      code: 'keyring_persist_failed',
    })
  })
})
