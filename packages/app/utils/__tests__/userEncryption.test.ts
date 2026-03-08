import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSingle,
  mockSelect,
  mockUpsert,
  mockFrom,
  mockStoreMasterKey,
  mockClearStoredMasterKey,
} = vi.hoisted(() => {
  const single = vi.fn()
  const select = vi.fn(() => ({ single }))
  const upsert = vi.fn(() => ({ select }))
  const from = vi.fn(() => ({ upsert }))
  const storeMasterKey = vi.fn()
  const clearStoredMasterKey = vi.fn()

  return {
    mockSingle: single,
    mockSelect: select,
    mockUpsert: upsert,
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

import { startE2EEncryptionBootstrap } from '../userEncryption'

describe('startE2EEncryptionBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSingle.mockResolvedValue({
      data: { encryption_mode: 'e2e', encryption_salt: 'abc123' },
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
    expect(mockUpsert).toHaveBeenCalledTimes(1)

    const upsertCalls = mockUpsert.mock.calls as unknown as Array<[Record<string, unknown>]>
    const payload = upsertCalls[0][0]
    expect(payload.id).toBe('user-1')
    expect(payload.encryption_mode).toBe('e2e')
    expect(typeof payload.encryption_salt).toBe('string')
    expect(payload.encryption_salt).toMatch(/^[0-9a-f]+$/)
    expect(payload).not.toHaveProperty('password')

    expect(mockStoreMasterKey).toHaveBeenCalledWith(
      'user-1',
      expect.any(Uint8Array)
    )
  })

  it('returns a structured error when salt persistence fails', async () => {
    mockSingle.mockResolvedValueOnce({
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
