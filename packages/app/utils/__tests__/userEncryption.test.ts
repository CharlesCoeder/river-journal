import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptFlowContent, deriveMasterKeyFromPassword } from '../encryption'

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

const {
  mockUsersSingle,
  mockUsersSelect,
  mockUsersUpsert,
  mockUsersMaybeSingle,
  mockUsersEq,
  mockUsersSelectRead,
  mockFlowsLimit,
  mockFlowsSelect,
  mockFrom,
  mockStoreMasterKey,
  mockCacheOnlyMasterKey,
  mockClearStoredMasterKey,
  tbMaybeSingle,
  tbInsert,
  tbOrder,
  tbChain,
} = vi.hoisted(() => {
  const usersSingle = vi.fn()
  const usersSelect = vi.fn(() => ({ single: usersSingle }))
  const usersUpsert = vi.fn(() => ({ select: usersSelect }))
  const usersMaybeSingle = vi.fn()
  const usersEq = vi.fn(() => ({ maybeSingle: usersMaybeSingle }))
  const usersSelectRead = vi.fn(() => ({ eq: usersEq }))
  const flowsLimit = vi.fn()
  const flowsSelect = vi.fn(() => ({ limit: flowsLimit }))

  // Trusted browsers: self-referential chainable mock
  const _tbMaybeSingle = vi.fn()
  const _tbInsert = vi.fn()
  const _tbOrder = vi.fn()
  const _tbChain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    order: _tbOrder,
    maybeSingle: _tbMaybeSingle,
    insert: _tbInsert,
    delete: vi.fn(),
    update: vi.fn(),
  }
  _tbChain.select.mockReturnValue(_tbChain)
  _tbChain.eq.mockReturnValue(_tbChain)
  _tbChain.gte.mockReturnValue(_tbChain)
  _tbChain.delete.mockReturnValue(_tbChain)
  _tbChain.update.mockReturnValue(_tbChain)

  const from = vi.fn((table: string) => {
    if (table === 'users') {
      return { upsert: usersUpsert, select: usersSelectRead }
    }

    if (table === 'flows') {
      return { select: flowsSelect }
    }

    if (table === 'trusted_browsers') {
      return _tbChain
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
    mockUsersMaybeSingle: usersMaybeSingle,
    mockUsersEq: usersEq,
    mockUsersSelectRead: usersSelectRead,
    mockFlowsLimit: flowsLimit,
    mockFlowsSelect: flowsSelect,
    mockFrom: from,
    mockStoreMasterKey: storeMasterKey,
    mockCacheOnlyMasterKey: cacheOnlyMasterKey,
    mockClearStoredMasterKey: clearStoredMasterKey,
    tbMaybeSingle: _tbMaybeSingle,
    tbInsert: _tbInsert,
    tbOrder: _tbOrder,
    tbChain: _tbChain,
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
  bootstrapManagedEncryption,
  fetchManagedEncryptionKey,
  verifyTrustedBrowser,
  registerTrustedBrowser,
  revokeTrustedBrowser,
  fetchTrustedBrowsers,
  deleteTrustedBrowserByHash,
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
    expect(payload.encryption_salt).toMatch(BASE64_PATTERN)
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
      salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
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
      'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8='
    )
    const encryptedPayload = encryptFlowContent('secret text', correctKey)

    mockFlowsLimit.mockResolvedValueOnce({
      data: [{ id: 'flow-1', content: encryptedPayload }],
      error: null,
    })

    const result = await unlockE2EEncryptionOnDevice({
      userId: 'user-1',
      password: 'wrong password',
      salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
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

describe('bootstrapManagedEncryption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsersMaybeSingle.mockResolvedValue({
      data: { managed_encryption_key: null },
      error: null,
    })
    mockUsersSingle.mockResolvedValue({
      data: { encryption_mode: 'managed', managed_encryption_key: 'abc123' },
      error: null,
    })
  })

  it('generates a managed key, upserts to Supabase, and returns the base64 key', async () => {
    const result = await bootstrapManagedEncryption({ userId: 'user-1' })

    expect(result.error).toBeNull()
    expect(result.managedKeyB64).toBeTruthy()
    expect(typeof result.managedKeyB64).toBe('string')
    expect(result.managedKeyB64).toMatch(BASE64_PATTERN)
    expect(result.managedKeyB64).toHaveLength(44)
    expect(mockFrom).toHaveBeenCalledWith('users')
    expect(mockUsersUpsert).toHaveBeenCalledTimes(1)

    const upsertCalls = mockUsersUpsert.mock.calls as unknown as Array<[Record<string, unknown>]>
    const payload = upsertCalls[0][0]
    expect(payload.id).toBe('user-1')
    expect(payload.encryption_mode).toBe('managed')
    expect(payload.managed_encryption_key).toMatch(BASE64_PATTERN)
  })

  it('reuses existing managed key instead of generating a new one', async () => {
    const existingKey = 'q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s='
    mockUsersMaybeSingle.mockResolvedValueOnce({
      data: { managed_encryption_key: existingKey },
      error: null,
    })

    const result = await bootstrapManagedEncryption({ userId: 'user-1' })

    expect(result.error).toBeNull()
    expect(result.managedKeyB64).toBe(existingKey)
    expect(mockUsersUpsert).toHaveBeenCalledTimes(1)

    const upsertCalls = mockUsersUpsert.mock.calls as unknown as Array<[Record<string, unknown>]>
    const payload = upsertCalls[0][0]
    expect(payload.encryption_mode).toBe('managed')
    expect(payload).not.toHaveProperty('managed_encryption_key')
  })

  it('propagates fetch errors instead of blindly generating a new key', async () => {
    mockUsersMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'Connection lost', code: 'network_error' },
    })

    const result = await bootstrapManagedEncryption({ userId: 'user-1' })

    expect(result.error).toEqual({
      message: 'Connection lost',
      code: 'network_error',
    })
    expect(result.managedKeyB64).toBeNull()
    expect(mockUsersUpsert).not.toHaveBeenCalled()
  })

  it('returns a structured error when upsert fails', async () => {
    mockUsersSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'DB failed', code: 'db_failed' },
    })

    const result = await bootstrapManagedEncryption({ userId: 'user-1' })

    expect(result.error).toEqual({
      message: 'DB failed',
      code: 'db_failed',
    })
    expect(result.managedKeyB64).toBeNull()
  })
})

describe('fetchManagedEncryptionKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads managed_encryption_key from Supabase', async () => {
    const validB64Key = 'q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s='
    mockUsersMaybeSingle.mockResolvedValueOnce({
      data: { managed_encryption_key: validB64Key },
      error: null,
    })

    const result = await fetchManagedEncryptionKey('user-1')

    expect(result.error).toBeNull()
    expect(result.data).toBe(validB64Key)
    expect(mockFrom).toHaveBeenCalledWith('users')
  })

  it('returns error when managed key is missing', async () => {
    mockUsersMaybeSingle.mockResolvedValueOnce({
      data: { managed_encryption_key: null },
      error: null,
    })

    const result = await fetchManagedEncryptionKey('user-1')

    expect(result.data).toBeNull()
    expect(result.error).toEqual({
      message: 'Managed encryption key not found for this account.',
      code: 'managed_key_missing',
    })
  })

  it('returns error when managed key is invalid', async () => {
    mockUsersMaybeSingle.mockResolvedValueOnce({
      data: { managed_encryption_key: 'not-valid-base64!' },
      error: null,
    })

    const result = await fetchManagedEncryptionKey('user-1')

    expect(result.data).toBeNull()
    expect(result.error).toEqual({
      message: 'Managed encryption key is invalid. Expected a base64-encoded 32-byte key.',
      code: 'managed_key_invalid',
    })
  })

  it('returns error on DB failure', async () => {
    mockUsersMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'Connection lost', code: 'network_error' },
    })

    const result = await fetchManagedEncryptionKey('user-1')

    expect(result.data).toBeNull()
    expect(result.error).toEqual({
      message: 'Connection lost',
      code: 'network_error',
    })
  })
})

// =================================================================
// TRUSTED BROWSERS
// =================================================================

describe('verifyTrustedBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tbChain.select.mockReturnValue(tbChain)
    tbChain.eq.mockReturnValue(tbChain)
    tbChain.gte.mockReturnValue(tbChain)
    tbChain.delete.mockReturnValue(tbChain)
    tbChain.update.mockReturnValue(tbChain)
  })

  it('returns valid with id when row is found', async () => {
    tbMaybeSingle.mockResolvedValueOnce({
      data: { id: 'browser-1' },
      error: null,
    })

    const result = await verifyTrustedBrowser('user-1', 'hash-abc')

    expect(result).toEqual({ status: 'valid', id: 'browser-1' })
    expect(mockFrom).toHaveBeenCalledWith('trusted_browsers')
    expect(tbChain.select).toHaveBeenCalledWith('id')
    expect(tbChain.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(tbChain.eq).toHaveBeenCalledWith('device_token_hash', 'hash-abc')
  })

  it('returns revoked when no matching row', async () => {
    tbMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    })

    const result = await verifyTrustedBrowser('user-1', 'hash-abc')

    expect(result).toEqual({ status: 'revoked' })
  })

  it('returns network_error on Supabase error', async () => {
    tbMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'timeout', code: 'PGRST301' },
    })

    const result = await verifyTrustedBrowser('user-1', 'hash-abc')

    expect(result).toEqual({ status: 'network_error' })
  })
})

describe('registerTrustedBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tbChain.select.mockReturnValue(tbChain)
    tbChain.eq.mockReturnValue(tbChain)
    tbChain.gte.mockReturnValue(tbChain)
    tbChain.delete.mockReturnValue(tbChain)
    tbChain.update.mockReturnValue(tbChain)
  })

  it('returns { error: null } on success', async () => {
    // eq is called 3 times total across all from() calls:
    //   1st: .eq('user_id', userId) in rate-limit chain -> chaining (returns tbChain)
    //   2nd: .eq('user_id', userId) in total-count chain -> terminal (returns {count, error})
    // gte is called once as terminal in rate-limit chain
    let eqCallCount = 0
    tbChain.eq.mockImplementation(() => {
      eqCallCount++
      // 2nd eq call is the terminal one for the total-count query
      if (eqCallCount === 2) return { count: 2, error: null }
      return tbChain
    })
    tbChain.gte.mockReturnValueOnce({ count: 1, error: null })
    tbInsert.mockResolvedValueOnce({ error: null })

    const result = await registerTrustedBrowser('user-1', 'hash-abc', 'Chrome on Mac')

    expect(result).toEqual({ error: null })
    expect(mockFrom).toHaveBeenCalledWith('trusted_browsers')
    expect(tbInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        device_token_hash: 'hash-abc',
        label: 'Chrome on Mac',

      })
    )
  })

  it('returns rate_limited error when 3+ registrations in past hour', async () => {
    // gte is terminal in rate-limit chain, returns count >= 3
    tbChain.gte.mockReturnValueOnce({ count: 3, error: null })

    const result = await registerTrustedBrowser('user-1', 'hash-abc', 'Chrome on Mac')

    expect(result).toEqual({
      error: {
        message: 'Too many browsers trusted recently. Please wait before trusting another browser.',
        code: 'rate_limited',
      },
    })
    expect(tbInsert).not.toHaveBeenCalled()
  })

  it('returns max_trusted_browsers error when 10 browsers exist', async () => {
    // Rate limit check passes (gte terminal)
    tbChain.gte.mockReturnValueOnce({ count: 0, error: null })
    // Total count check: 1st eq is chaining (rate-limit), 2nd eq is terminal (total-count)
    let eqCallCount = 0
    tbChain.eq.mockImplementation(() => {
      eqCallCount++
      if (eqCallCount === 2) return { count: 10, error: null }
      return tbChain
    })

    const result = await registerTrustedBrowser('user-1', 'hash-abc', 'Chrome on Mac')

    expect(result).toEqual({
      error: {
        message: 'Maximum of 10 trusted browsers reached. Revoke an existing browser first.',
        code: 'max_trusted_browsers',
      },
    })
    expect(tbInsert).not.toHaveBeenCalled()
  })

  it('maps Postgres trigger exception to max_trusted_browsers error', async () => {
    // Rate limit and total count checks pass
    tbChain.gte.mockReturnValueOnce({ count: 0, error: null })
    let eqCallCount = 0
    tbChain.eq.mockImplementation(() => {
      eqCallCount++
      if (eqCallCount === 2) return { count: 9, error: null }
      return tbChain
    })
    // Insert returns trigger error (TOCTOU race)
    tbInsert.mockResolvedValueOnce({
      error: { message: 'Maximum of 10 trusted browsers per user', code: 'P0001' },
    })

    const result = await registerTrustedBrowser('user-1', 'hash-abc', 'Chrome on Mac')

    expect(result).toEqual({
      error: {
        message: 'Maximum of 10 trusted browsers reached. Revoke an existing browser first.',
        code: 'max_trusted_browsers',
      },
    })
  })
})

describe('revokeTrustedBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tbChain.select.mockReturnValue(tbChain)
    tbChain.eq.mockReturnValue(tbChain)
    tbChain.gte.mockReturnValue(tbChain)
    tbChain.delete.mockReturnValue(tbChain)
    tbChain.update.mockReturnValue(tbChain)
  })

  it('returns { error: null } on success', async () => {
    tbChain.eq.mockReturnValueOnce({ error: null })

    const result = await revokeTrustedBrowser('browser-1')

    expect(result).toEqual({ error: null })
    expect(mockFrom).toHaveBeenCalledWith('trusted_browsers')
    expect(tbChain.eq).toHaveBeenCalledWith('id', 'browser-1')
  })

  it('returns structured error on delete failure', async () => {
    tbChain.eq.mockReturnValueOnce({
      error: { message: 'Row not found', code: 'PGRST116' },
    })

    const result = await revokeTrustedBrowser('browser-1')

    expect(result).toEqual({
      error: {
        message: 'Row not found',
        code: 'PGRST116',
      },
    })
  })
})

describe('fetchTrustedBrowsers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tbChain.select.mockReturnValue(tbChain)
    tbChain.eq.mockReturnValue(tbChain)
    tbChain.gte.mockReturnValue(tbChain)
    tbChain.delete.mockReturnValue(tbChain)
    tbChain.update.mockReturnValue(tbChain)
  })

  it('returns mapped browser list on success', async () => {
    tbOrder.mockResolvedValueOnce({
      data: [
        {
          id: 'b-1',
          label: 'Chrome on Mac',
  
          created_at: '2025-01-01T00:00:00Z',
          last_used_at: '2025-06-01T00:00:00Z',
          device_token_hash: 'hash-1',
        },
        {
          id: 'b-2',
          label: 'Firefox on Linux',
  
          created_at: '2025-02-01T00:00:00Z',
          last_used_at: '2025-05-01T00:00:00Z',
          device_token_hash: 'hash-2',
        },
      ],
      error: null,
    })

    const result = await fetchTrustedBrowsers('user-1')

    expect(result).toEqual([
      {
        id: 'b-1',
        label: 'Chrome on Mac',

        createdAt: '2025-01-01T00:00:00Z',
        lastUsedAt: '2025-06-01T00:00:00Z',
        deviceTokenHash: 'hash-1',
      },
      {
        id: 'b-2',
        label: 'Firefox on Linux',

        createdAt: '2025-02-01T00:00:00Z',
        lastUsedAt: '2025-05-01T00:00:00Z',
        deviceTokenHash: 'hash-2',
      },
    ])
    expect(mockFrom).toHaveBeenCalledWith('trusted_browsers')
    expect(tbChain.order).toHaveBeenCalledWith('last_used_at', { ascending: false })
  })

  it('returns empty array on error', async () => {
    tbOrder.mockResolvedValueOnce({
      data: null,
      error: { message: 'DB down', code: 'network_error' },
    })

    const result = await fetchTrustedBrowsers('user-1')

    expect(result).toEqual([])
  })
})

describe('deleteTrustedBrowserByHash', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tbChain.select.mockReturnValue(tbChain)
    tbChain.eq.mockReturnValue(tbChain)
    tbChain.gte.mockReturnValue(tbChain)
    tbChain.delete.mockReturnValue(tbChain)
    tbChain.update.mockReturnValue(tbChain)
  })

  it('returns { error: null } on success', async () => {
    // The chain is: delete() -> eq('user_id') -> eq('device_token_hash')
    // delete returns tbChain, first eq returns tbChain, second eq is terminal
    tbChain.eq.mockReturnValueOnce(tbChain) // first eq
    tbChain.eq.mockReturnValueOnce({ error: null }) // second eq (terminal)

    const result = await deleteTrustedBrowserByHash('user-1', 'hash-abc')

    expect(result).toEqual({ error: null })
    expect(mockFrom).toHaveBeenCalledWith('trusted_browsers')
    expect(tbChain.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(tbChain.eq).toHaveBeenCalledWith('device_token_hash', 'hash-abc')
  })

  it('returns structured error on failure', async () => {
    tbChain.eq.mockReturnValueOnce(tbChain)
    tbChain.eq.mockReturnValueOnce({
      error: { message: 'Permission denied', code: 'PGRST403' },
    })

    const result = await deleteTrustedBrowserByHash('user-1', 'hash-abc')

    expect(result).toEqual({
      error: {
        message: 'Permission denied',
        code: 'PGRST403',
      },
    })
  })
})
