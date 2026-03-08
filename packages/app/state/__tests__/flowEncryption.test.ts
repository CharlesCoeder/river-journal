import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLoadEncryptionKey = vi.fn()

vi.mock('../../utils/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    })),
  },
}))

vi.mock('../persistConfig', () => ({
  persistPlugin: {
    getTable: vi.fn(() => ({})),
    setTable: vi.fn(),
    deleteTable: vi.fn(),
    getMetadata: vi.fn(),
    setMetadata: vi.fn(),
    deleteMetadata: vi.fn(),
    loadTable: vi.fn(),
    saveTable: vi.fn(),
    set: vi.fn(),
  },
  configurePersistence: vi.fn(),
}))

vi.mock('../../utils/encryptionKeyStore', () => ({
  loadEncryptionKey: (...args: unknown[]) => mockLoadEncryptionKey(...args),
}))

import { bytesToKeyHex, deriveMasterKey, encryptFlowContent } from '../../utils/encryption'
import {
  encryptionSyncLockRequested$,
  syncEncryptionError$,
  syncEncryptionMode$,
  syncUserId$,
} from '../syncConfig'
import { transformLocalFlowForRemote, transformRemoteFlowRow } from '../flows'

describe('flow encryption transforms', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    syncEncryptionMode$.set(null)
    syncEncryptionError$.set(null)
    encryptionSyncLockRequested$.set(false)
    syncUserId$.set('user-1')

    const key = bytesToKeyHex(await deriveMasterKey('password123', 'ab'.repeat(16)))
    mockLoadEncryptionKey.mockResolvedValue({
      keyHex: key,
      backend: 'secure',
    })
  })

  it('encrypts plaintext flow content before remote save in E2E mode', async () => {
    syncEncryptionMode$.set('e2e')

    const payload = await transformLocalFlowForRemote({
      id: 'flow-1',
      user_id: 'user-1',
      dailyEntryId: 'entry-1',
      content: 'hello world',
      wordCount: 2,
      timestamp: '2026-03-08T10:00:00Z',
      local_session_id: 'sess-1',
    })

    expect(payload).toMatchObject({
      id: 'flow-1',
      daily_entry_id: 'entry-1',
      word_count: 2,
    })
    expect(String(payload?.content)).toMatch(/^rjenc:v1:xchacha20poly1305:/)
  })

  it('decrypts encrypted remote payloads back into plaintext local content', async () => {
    const keyBytes = await deriveMasterKey('password123', 'ab'.repeat(16))
    const encryptedContent = await encryptFlowContent('hello world', keyBytes)

    const localFlow = await transformRemoteFlowRow({
      id: 'flow-1',
      daily_entry_id: 'entry-1',
      content: encryptedContent,
      word_count: 2,
      created_at: '2026-03-08T10:00:00Z',
      updated_at: '2026-03-08T10:00:00Z',
      is_deleted: false,
    })

    expect(localFlow.content).toBe('hello world')
    expect(localFlow.wordCount).toBe(2)
  })

  it('leaves managed-mode payloads plaintext', async () => {
    syncEncryptionMode$.set('managed')

    const payload = await transformLocalFlowForRemote({
      id: 'flow-2',
      user_id: 'user-1',
      dailyEntryId: 'entry-2',
      content: 'managed text',
      wordCount: 2,
      timestamp: '2026-03-08T10:00:00Z',
      local_session_id: 'sess-1',
    })

    expect(payload).toEqual({
      id: 'flow-2',
      daily_entry_id: 'entry-2',
      content: 'managed text',
      word_count: 2,
      created_at: '2026-03-08T10:00:00Z',
    })
  })

  it('blocks E2E save when the local key is missing', async () => {
    syncEncryptionMode$.set('e2e')
    mockLoadEncryptionKey.mockResolvedValueOnce({
      keyHex: null,
      backend: 'session',
    })

    await expect(
      transformLocalFlowForRemote({
        id: 'flow-3',
        user_id: 'user-1',
        dailyEntryId: 'entry-3',
        content: 'locked',
        wordCount: 1,
        timestamp: '2026-03-08T10:00:00Z',
        local_session_id: 'sess-1',
      })
    ).rejects.toThrow('E2E key is unavailable on this device.')

    expect(syncEncryptionError$.get()).toEqual({
      message: 'This device still needs your encryption password before Cloud Sync can turn on.',
      code: 'encryption_key_required',
    })
  })

  it('surfaces malformed encrypted payloads explicitly', async () => {
    await expect(
      transformRemoteFlowRow({
        id: 'flow-4',
        daily_entry_id: 'entry-4',
        content: `rjenc:v1:xchacha20poly1305:${'aa'.repeat(24)}:zz`,
        word_count: 1,
        created_at: '2026-03-08T10:00:00Z',
        updated_at: '2026-03-08T10:00:00Z',
        is_deleted: false,
      })
    ).rejects.toThrow()

    expect(syncEncryptionError$.get()).toEqual({
      message: 'An encrypted journal payload is malformed or uses an unsupported version.',
      code: 'encrypted_payload_invalid',
    })
  })
})
