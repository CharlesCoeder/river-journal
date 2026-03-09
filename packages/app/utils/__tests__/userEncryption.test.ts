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
  const clearStoredMasterKey = vi.fn()

  return {
    mockUsersSingle: usersSingle,
    mockUsersSelect: usersSelect,
    mockUsersUpsert: usersUpsert,
    mockFlowsLimit: flowsLimit,
    mockFlowsSelect: flowsSelect,
    mockFrom: from,
    mockStoreMasterKey: storeMasterKey,
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
  clearStoredMasterKey: mockClearStoredMasterKey,
  loadMasterKey: vi.fn(),
  getCachedMasterKey: vi.fn(),
  hasStoredMasterKey: vi.fn(),
}))

import { startE2EEncryptionBootstrap, unlockE2EEncryptionOnDevice } from '../userEncryption'

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

  it('persists mode+salt and stores the derived key locally', async () => {
    const result = await startE2EEncryptionBootstrap({
      userId: 'user-1',
      password: 'correct horse battery staple',
    })

    expect(result.error).toBeNull()
    expect(mockFrom).toHaveBeenCalledWith('users')
    expect(mockUsersUpsert).toHaveBeenCalledTimes(1)

    const upsertCalls = mockUsersUpsert.mock.calls as unknown as Array<[Record<string, unknown>]>
    const payload = upsertCalls[0][0]
    expect(payload.id).toBe('user-1')
    expect(payload.encryption_mode).toBe('e2e')
    expect(typeof payload.encryption_salt).toBe('string')
    expect(payload.encryption_salt).toMatch(/^[0-9a-f]+$/)
    expect(payload).not.toHaveProperty('password')

    expect(mockStoreMasterKey).toHaveBeenCalledWith('user-1', expect.any(Uint8Array))
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
    expect(mockStoreMasterKey).not.toHaveBeenCalled()
    expect(mockClearStoredMasterKey).toHaveBeenCalledWith('user-1')
  })

  it('returns a structured error and cleans partial state when local key storage fails', async () => {
    mockStoreMasterKey.mockRejectedValueOnce(new Error('secure-store unavailable'))

    const result = await startE2EEncryptionBootstrap({
      userId: 'user-1',
      password: 'correct horse battery staple',
    })

    expect(result.error).toEqual({
      message: 'secure-store unavailable',
      code: 'local_key_store_failed',
    })
    expect(mockClearStoredMasterKey).toHaveBeenCalledWith('user-1')
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

  it('derives and stores the local key without writing users row state', async () => {
    const result = await unlockE2EEncryptionOnDevice({
      userId: 'user-1',
      password: 'correct horse battery staple',
      salt: '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df',
    })

    expect(result.error).toBeNull()
    expect(mockFrom).toHaveBeenCalledWith('flows')
    expect(mockStoreMasterKey).toHaveBeenCalledWith('user-1', expect.any(Uint8Array))
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
    expect(mockStoreMasterKey).not.toHaveBeenCalled()
  })

  it('returns a structured error when local storage fails', async () => {
    mockStoreMasterKey.mockRejectedValueOnce(new Error('secure-store unavailable'))

    const result = await unlockE2EEncryptionOnDevice({
      userId: 'user-1',
      password: 'correct horse battery staple',
      salt: '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df',
    })

    expect(result.error).toEqual({
      message: 'secure-store unavailable',
      code: 'local_key_store_failed',
    })
    expect(mockClearStoredMasterKey).toHaveBeenCalledWith('user-1')
  })
})
