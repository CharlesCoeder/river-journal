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
  mockUsersUpdateIs,
  mockUsersUpdate,
  mockRpc,
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
  // writeVerifierIfAbsent: update(...).eq(...).is(...) → awaitable
  const usersUpdateIs = vi.fn().mockResolvedValue({ data: null, error: null })
  const usersUpdate = vi.fn(() => ({ eq: () => ({ is: usersUpdateIs }) }))
  const rpc = vi.fn()
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
  // _tbChain is a Record so indexed props read as possibly-undefined; every key
  // above is defined at construction, so `!` is safe here and below.
  _tbChain.select!.mockReturnValue(_tbChain)
  _tbChain.eq!.mockReturnValue(_tbChain)
  _tbChain.gte!.mockReturnValue(_tbChain)
  _tbChain.delete!.mockReturnValue(_tbChain)
  _tbChain.update!.mockReturnValue(_tbChain)

  const from = vi.fn((table: string) => {
    if (table === 'users') {
      return { upsert: usersUpsert, select: usersSelectRead, update: usersUpdate }
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
    mockUsersUpdateIs: usersUpdateIs,
    mockUsersUpdate: usersUpdate,
    mockRpc: rpc,
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
    rpc: mockRpc,
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

// Must match E2E_KEY_VERIFIER_PLAINTEXT in userEncryption.ts.
const KEY_VERIFIER_PLAINTEXT = 'river-key-check-v1'

describe('startE2EEncryptionBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlowsLimit.mockResolvedValue({
      data: [],
      error: null,
    })
    // Default: fresh bootstrap wins — the RPC echoes back the salt/verifier we
    // proposed, signalling the account had none before.
    mockRpc.mockImplementation((fnName: string, params: Record<string, string>) => {
      if (fnName === 'bootstrap_e2e_encryption') {
        return Promise.resolve({
          data: [{ out_salt: params.p_salt, out_verifier: params.p_verifier, out_mode: 'e2e' }],
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })
    mockStoreMasterKey.mockResolvedValue(undefined)
    mockClearStoredMasterKey.mockResolvedValue(undefined)
  })

  it('persists mode+salt via the guarded RPC, caches the key, and returns the master key', async () => {
    const result = await startE2EEncryptionBootstrap({
      userId: 'user-1',
      password: 'correct horse battery staple',
    })

    expect(result.error).toBeNull()
    expect(result.masterKey).toBeInstanceOf(Uint8Array)
    expect(mockRpc).toHaveBeenCalledTimes(1)

    const rpcCalls = mockRpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>
    const [fnName, params] = rpcCalls[0]!
    expect(fnName).toBe('bootstrap_e2e_encryption')
    expect(typeof params.p_salt).toBe('string')
    expect(params.p_salt).toMatch(BASE64_PATTERN)
    expect(typeof params.p_verifier).toBe('string')
    expect(params).not.toHaveProperty('password')

    // Key is cached in memory only — not written to keyring
    expect(mockCacheOnlyMasterKey).toHaveBeenCalledWith('user-1', expect.any(Uint8Array))
    expect(mockStoreMasterKey).not.toHaveBeenCalled()
  })

  it('returns a structured error when salt persistence fails', async () => {
    mockRpc.mockResolvedValueOnce({
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

  it('never overwrites an existing salt — treats a spurious re-bootstrap as UNLOCK', async () => {
    // Server already has a salt+verifier (e.g. the settings load blipped and the
    // dialog reopened). The RPC returns the EXISTING salt, not ours.
    const existingSalt = 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8='
    const correctKey = await deriveMasterKeyFromPassword('correct horse battery staple', existingSalt)
    const existingVerifier = encryptFlowContent(KEY_VERIFIER_PLAINTEXT, correctKey)

    mockRpc.mockResolvedValueOnce({
      data: [{ out_salt: existingSalt, out_verifier: existingVerifier, out_mode: 'e2e' }],
      error: null,
    })

    const result = await startE2EEncryptionBootstrap({
      userId: 'user-1',
      password: 'correct horse battery staple',
    })

    // Unlocks against the server salt rather than forking onto a new key.
    expect(result.error).toBeNull()
    expect(result.masterKey).toEqual(correctKey)
    expect(mockCacheOnlyMasterKey).toHaveBeenCalledWith('user-1', correctKey)
  })

  it('rejects a spurious re-bootstrap when the password is wrong', async () => {
    const existingSalt = 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8='
    const correctKey = await deriveMasterKeyFromPassword('correct horse battery staple', existingSalt)
    const existingVerifier = encryptFlowContent(KEY_VERIFIER_PLAINTEXT, correctKey)

    mockRpc.mockResolvedValueOnce({
      data: [{ out_salt: existingSalt, out_verifier: existingVerifier, out_mode: 'e2e' }],
      error: null,
    })

    const result = await startE2EEncryptionBootstrap({
      userId: 'user-1',
      password: 'wrong password',
    })

    expect(result.error).toEqual({
      message: 'Encryption password is incorrect for this account.',
      code: 'invalid_encryption_password',
    })
    expect(result.masterKey).toBeNull()
    expect(mockCacheOnlyMasterKey).not.toHaveBeenCalled()
  })
})

describe('unlockE2EEncryptionOnDevice', () => {
  const SALT = 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8='

  beforeEach(() => {
    vi.clearAllMocks()
    mockFlowsLimit.mockResolvedValue({
      data: [],
      error: null,
    })
    // Default: legacy account with no stored verifier → flow sampling.
    mockUsersMaybeSingle.mockResolvedValue({
      data: { encryption_key_verifier: null },
      error: null,
    })
    mockUsersUpdateIs.mockResolvedValue({ data: null, error: null })
    mockStoreMasterKey.mockResolvedValue(undefined)
    mockClearStoredMasterKey.mockResolvedValue(undefined)
  })

  it('unlocks against the stored verifier when the password is correct', async () => {
    const correctKey = await deriveMasterKeyFromPassword('correct horse battery staple', SALT)
    const verifier = encryptFlowContent(KEY_VERIFIER_PLAINTEXT, correctKey)
    mockUsersMaybeSingle.mockResolvedValueOnce({
      data: { encryption_key_verifier: verifier },
      error: null,
    })

    const result = await unlockE2EEncryptionOnDevice({
      userId: 'user-1',
      password: 'correct horse battery staple',
      salt: SALT,
    })

    expect(result.error).toBeNull()
    expect(result.masterKey).toEqual(correctKey)
    // Verifier proves the key without needing to sample flows.
    expect(mockFlowsSelect).not.toHaveBeenCalled()
    expect(mockCacheOnlyMasterKey).toHaveBeenCalledWith('user-1', correctKey)
    expect(mockStoreMasterKey).not.toHaveBeenCalled()
  })

  it('rejects a wrong password against the stored verifier even with no flows to sample', async () => {
    const correctKey = await deriveMasterKeyFromPassword('correct horse battery staple', SALT)
    const verifier = encryptFlowContent(KEY_VERIFIER_PLAINTEXT, correctKey)
    mockUsersMaybeSingle.mockResolvedValueOnce({
      data: { encryption_key_verifier: verifier },
      error: null,
    })

    const result = await unlockE2EEncryptionOnDevice({
      userId: 'user-1',
      password: 'wrong password',
      salt: SALT,
    })

    expect(result.error).toEqual({
      message: 'Encryption password is incorrect for this account.',
      code: 'invalid_encryption_password',
    })
    expect(result.masterKey).toBeNull()
    expect(mockCacheOnlyMasterKey).not.toHaveBeenCalled()
  })

  it('falls back to flow sampling for a legacy account and self-heals a verifier', async () => {
    const correctKey = await deriveMasterKeyFromPassword('correct horse battery staple', SALT)
    const encryptedPayload = encryptFlowContent('secret text', correctKey)
    mockFlowsLimit.mockResolvedValueOnce({
      data: [{ id: 'flow-1', content: encryptedPayload }],
      error: null,
    })

    const result = await unlockE2EEncryptionOnDevice({
      userId: 'user-1',
      password: 'correct horse battery staple',
      salt: SALT,
    })

    expect(result.error).toBeNull()
    expect(result.masterKey).toEqual(correctKey)
    expect(mockFrom).toHaveBeenCalledWith('flows')
    // Conclusive sampling → verifier is written back (guarded on NULL).
    expect(mockUsersUpdate).toHaveBeenCalledTimes(1)
    expect(mockUsersUpdateIs).toHaveBeenCalledTimes(1)
    expect(mockCacheOnlyMasterKey).toHaveBeenCalledWith('user-1', correctKey)
  })

  it('rejects the wrong password when a legacy encrypted flow cannot be decrypted', async () => {
    const correctKey = await deriveMasterKeyFromPassword('correct horse battery staple', SALT)
    const encryptedPayload = encryptFlowContent('secret text', correctKey)

    mockFlowsLimit.mockResolvedValueOnce({
      data: [{ id: 'flow-1', content: encryptedPayload }],
      error: null,
    })

    const result = await unlockE2EEncryptionOnDevice({
      userId: 'user-1',
      password: 'wrong password',
      salt: SALT,
    })

    expect(result.error).toEqual({
      message: 'Encryption password is incorrect for this account.',
      code: 'invalid_encryption_password',
    })
    expect(result.masterKey).toBeNull()
    // No verifier written for an unverified (wrong) key.
    expect(mockUsersUpdate).not.toHaveBeenCalled()
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
    // Default: fresh bootstrap wins — the RPC echoes back the key we proposed.
    mockRpc.mockImplementation((fnName: string, params: Record<string, string>) => {
      if (fnName === 'bootstrap_managed_encryption') {
        return Promise.resolve({
          data: [{ out_key: params.p_key, out_mode: 'managed' }],
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })
  })

  it('generates a managed key via the race-safe RPC and returns the base64 key', async () => {
    const result = await bootstrapManagedEncryption({ userId: 'user-1' })

    expect(result.error).toBeNull()
    expect(result.managedKeyB64).toBeTruthy()
    expect(typeof result.managedKeyB64).toBe('string')
    expect(result.managedKeyB64).toMatch(BASE64_PATTERN)
    expect(result.managedKeyB64).toHaveLength(44)
    expect(mockRpc).toHaveBeenCalledTimes(1)

    const rpcCalls = mockRpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>
    const [fnName, params] = rpcCalls[0]!
    expect(fnName).toBe('bootstrap_managed_encryption')
    expect(params.p_key).toMatch(BASE64_PATTERN)
  })

  it('converges on the winning key when another device already wrote one', async () => {
    // Simulates the race: the RPC keeps the pre-existing key (COALESCE) and
    // returns it, so this caller discards its own candidate.
    const existingKey = 'q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s='
    mockRpc.mockResolvedValueOnce({
      data: [{ out_key: existingKey, out_mode: 'managed' }],
      error: null,
    })

    const result = await bootstrapManagedEncryption({ userId: 'user-1' })

    expect(result.error).toBeNull()
    expect(result.managedKeyB64).toBe(existingKey)
    expect(mockRpc).toHaveBeenCalledTimes(1)
  })

  it('returns a structured error when the RPC fails', async () => {
    mockRpc.mockResolvedValueOnce({
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
    tbChain.select!.mockReturnValue(tbChain)
    tbChain.eq!.mockReturnValue(tbChain)
    tbChain.gte!.mockReturnValue(tbChain)
    tbChain.delete!.mockReturnValue(tbChain)
    tbChain.update!.mockReturnValue(tbChain)
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
    tbChain.select!.mockReturnValue(tbChain)
    tbChain.eq!.mockReturnValue(tbChain)
    tbChain.gte!.mockReturnValue(tbChain)
    tbChain.delete!.mockReturnValue(tbChain)
    tbChain.update!.mockReturnValue(tbChain)
  })

  it('returns { error: null } on success', async () => {
    // eq is called 3 times total across all from() calls:
    //   1st: .eq('user_id', userId) in rate-limit chain -> chaining (returns tbChain)
    //   2nd: .eq('user_id', userId) in total-count chain -> terminal (returns {count, error})
    // gte is called once as terminal in rate-limit chain
    let eqCallCount = 0
    tbChain.eq!.mockImplementation(() => {
      eqCallCount++
      // 2nd eq call is the terminal one for the total-count query
      if (eqCallCount === 2) return { count: 2, error: null }
      return tbChain
    })
    tbChain.gte!.mockReturnValueOnce({ count: 1, error: null })
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
    tbChain.gte!.mockReturnValueOnce({ count: 3, error: null })

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
    tbChain.gte!.mockReturnValueOnce({ count: 0, error: null })
    // Total count check: 1st eq is chaining (rate-limit), 2nd eq is terminal (total-count)
    let eqCallCount = 0
    tbChain.eq!.mockImplementation(() => {
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
    tbChain.gte!.mockReturnValueOnce({ count: 0, error: null })
    let eqCallCount = 0
    tbChain.eq!.mockImplementation(() => {
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
    tbChain.select!.mockReturnValue(tbChain)
    tbChain.eq!.mockReturnValue(tbChain)
    tbChain.gte!.mockReturnValue(tbChain)
    tbChain.delete!.mockReturnValue(tbChain)
    tbChain.update!.mockReturnValue(tbChain)
  })

  it('returns { error: null } on success', async () => {
    tbChain.eq!.mockReturnValueOnce({ error: null })

    const result = await revokeTrustedBrowser('browser-1')

    expect(result).toEqual({ error: null })
    expect(mockFrom).toHaveBeenCalledWith('trusted_browsers')
    expect(tbChain.eq).toHaveBeenCalledWith('id', 'browser-1')
  })

  it('returns structured error on delete failure', async () => {
    tbChain.eq!.mockReturnValueOnce({
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
    tbChain.select!.mockReturnValue(tbChain)
    tbChain.eq!.mockReturnValue(tbChain)
    tbChain.gte!.mockReturnValue(tbChain)
    tbChain.delete!.mockReturnValue(tbChain)
    tbChain.update!.mockReturnValue(tbChain)
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
    tbChain.select!.mockReturnValue(tbChain)
    tbChain.eq!.mockReturnValue(tbChain)
    tbChain.gte!.mockReturnValue(tbChain)
    tbChain.delete!.mockReturnValue(tbChain)
    tbChain.update!.mockReturnValue(tbChain)
  })

  it('returns { error: null } on success', async () => {
    // The chain is: delete() -> eq('user_id') -> eq('device_token_hash')
    // delete returns tbChain, first eq returns tbChain, second eq is terminal
    tbChain.eq!.mockReturnValueOnce(tbChain) // first eq
    tbChain.eq!.mockReturnValueOnce({ error: null }) // second eq (terminal)

    const result = await deleteTrustedBrowserByHash('user-1', 'hash-abc')

    expect(result).toEqual({ error: null })
    expect(mockFrom).toHaveBeenCalledWith('trusted_browsers')
    expect(tbChain.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(tbChain.eq).toHaveBeenCalledWith('device_token_hash', 'hash-abc')
  })

  it('returns structured error on failure', async () => {
    tbChain.eq!.mockReturnValueOnce(tbChain)
    tbChain.eq!.mockReturnValueOnce({
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
