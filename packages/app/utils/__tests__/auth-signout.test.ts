/**
 * Sign-out hygiene tests (shared-device privacy fix).
 *
 * Covers the device-local cleanup contract in utils/auth.ts:
 *   - signOut() clears the E2E master key (memory + keychain), the TanStack
 *     Query cache (in-memory + persisted 'rj-tq-cache'), and the Legend-State
 *     sync cursors — and returns its result rather than throwing.
 *   - Cleanup runs EVEN WHEN supabase.auth.signOut() returns an error or
 *     throws (callers navigate away regardless, so cleanup must be
 *     unskippable).
 *   - A failing cleanup step never blocks the others.
 *   - The SIGNED_OUT auth event triggers the same cleanup (session expiry /
 *     revocation / other-tab sign-out path).
 *   - TOKEN_REFRESHED NEVER triggers cleanup (the "stay signed in" path must
 *     not wipe the user's keys).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks (before importing ../auth) ────────────────────────────────────────

const mockSignOutSupabase = vi.fn()
type AuthChangeCallback = (event: string, session: unknown) => void
let authChangeCallback: AuthChangeCallback | null = null

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      signOut: (...args: unknown[]) => mockSignOutSupabase(...args),
      onAuthStateChange: vi.fn((cb: AuthChangeCallback) => {
        authChangeCallback = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signInWithOAuth: vi.fn(),
    },
  },
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
}))

let currentUserId: string | null = 'user-1'
vi.mock('../../state/store', () => ({
  store$: {
    session: {
      assign: vi.fn(),
      userId: {
        peek: () => currentUserId,
      },
    },
  },
}))

vi.mock('../../state/syncConfig', () => ({
  deviceState$: {
    lastAuthedUserId: {
      peek: vi.fn(() => null),
      set: vi.fn(),
    },
  },
}))

const mockResetEncryptionSetupState = vi.fn()
vi.mock('../../state/encryptionSetup', () => ({
  loadCurrentEncryptionMode: vi.fn(() => Promise.resolve(null)),
  resetEncryptionSetupState: (...args: unknown[]) => mockResetEncryptionSetupState(...args),
}))

vi.mock('../webKeyStore', () => ({
  hasWebTrustCapability: vi.fn(() => false),
  getStoredDeviceToken: vi.fn(() => Promise.resolve(null)),
  hashDeviceToken: vi.fn(() => Promise.resolve(null)),
  clearWebTrustData: vi.fn(() => Promise.resolve()),
}))

vi.mock('../userEncryption', () => ({
  deleteTrustedBrowserByHash: vi.fn(() => Promise.resolve({ error: null })),
}))

const mockClearStoredMasterKey = vi.fn((_userId: string) => Promise.resolve())
vi.mock('../encryptionKeyStore', () => ({
  clearStoredMasterKey: (userId: string) => mockClearStoredMasterKey(userId),
}))

const mockQueryClientClear = vi.fn()
vi.mock('../../state/queryClient', () => ({
  queryClient: {
    clear: (...args: unknown[]) => mockQueryClientClear(...args),
  },
  QUERY_PERSIST_KEY: 'rj-tq-cache',
}))

const mockQueryStorageRemoveItem = vi.fn((_key: string) => Promise.resolve())
vi.mock('../../state/queryStorage', () => ({
  queryStorage: {
    removeItem: (key: string) => mockQueryStorageRemoveItem(key),
  },
}))

const mockResetSyncCursors = vi.fn(() => Promise.resolve())
vi.mock('../../state/persistConfig', () => ({
  resetSyncCursors: () => mockResetSyncCursors(),
  persistPlugin: {},
  configurePersistence: vi.fn(),
}))

// Import after mocks
import { signOut, performSignOutCleanup, initAuthListener } from '../auth'

const expectFullCleanup = (userId: string) => {
  expect(mockClearStoredMasterKey).toHaveBeenCalledWith(userId)
  expect(mockQueryClientClear).toHaveBeenCalled()
  expect(mockQueryStorageRemoveItem).toHaveBeenCalledWith('rj-tq-cache')
  expect(mockResetSyncCursors).toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  currentUserId = 'user-1'
  authChangeCallback = null
})

describe('signOut() — device-local cleanup', () => {
  it('runs the full cleanup on successful sign-out', async () => {
    mockSignOutSupabase.mockResolvedValueOnce({ error: null })

    const result = await signOut()

    expect(result.error).toBeNull()
    expectFullCleanup('user-1')
  })

  it('runs the full cleanup even when supabase.auth.signOut() returns an error', async () => {
    mockSignOutSupabase.mockResolvedValueOnce({ error: { message: 'network down' } })

    const result = await signOut()

    expect(result.error).toBe('network down')
    expectFullCleanup('user-1')
  })

  it('runs the full cleanup even when supabase.auth.signOut() throws', async () => {
    mockSignOutSupabase.mockRejectedValueOnce(new Error('fetch failed'))

    const result = await signOut()

    expect(result.error).toBe('fetch failed')
    expectFullCleanup('user-1')
  })

  it('skips only the master-key step when no user is signed in', async () => {
    currentUserId = null
    mockSignOutSupabase.mockResolvedValueOnce({ error: null })

    await signOut()

    expect(mockClearStoredMasterKey).not.toHaveBeenCalled()
    expect(mockQueryClientClear).toHaveBeenCalled()
    expect(mockQueryStorageRemoveItem).toHaveBeenCalledWith('rj-tq-cache')
    expect(mockResetSyncCursors).toHaveBeenCalled()
  })
})

describe('performSignOutCleanup() — step isolation', () => {
  it('continues with cache + cursor cleanup when key deletion rejects', async () => {
    mockClearStoredMasterKey.mockRejectedValueOnce(new Error('keychain locked'))

    await expect(performSignOutCleanup('user-1')).resolves.toBeUndefined()

    expect(mockQueryClientClear).toHaveBeenCalled()
    expect(mockQueryStorageRemoveItem).toHaveBeenCalledWith('rj-tq-cache')
    expect(mockResetSyncCursors).toHaveBeenCalled()
  })

  it('continues with cursor cleanup when queryClient.clear() throws', async () => {
    mockQueryClientClear.mockImplementationOnce(() => {
      throw new Error('boom')
    })

    await expect(performSignOutCleanup('user-1')).resolves.toBeUndefined()

    expect(mockQueryStorageRemoveItem).toHaveBeenCalledWith('rj-tq-cache')
    expect(mockResetSyncCursors).toHaveBeenCalled()
  })

  it('never rejects when every step fails', async () => {
    mockClearStoredMasterKey.mockRejectedValueOnce(new Error('a'))
    mockQueryClientClear.mockImplementationOnce(() => {
      throw new Error('b')
    })
    mockQueryStorageRemoveItem.mockRejectedValueOnce(new Error('c'))
    mockResetSyncCursors.mockRejectedValueOnce(new Error('d'))

    await expect(performSignOutCleanup('user-1')).resolves.toBeUndefined()
  })
})

describe('auth listener — event-driven cleanup', () => {
  it('runs the full cleanup (with the pre-clear userId) on SIGNED_OUT', async () => {
    initAuthListener()
    expect(authChangeCallback).toBeTypeOf('function')

    authChangeCallback!('SIGNED_OUT', null)
    // Cleanup is fired as a floating promise — flush microtasks.
    await vi.waitFor(() => {
      expectFullCleanup('user-1')
    })
  })

  it('does NOT run any cleanup on TOKEN_REFRESHED (stay-signed-in path)', async () => {
    initAuthListener()

    authChangeCallback!('TOKEN_REFRESHED', {
      user: { id: 'user-1', email: 'a@b.c' },
    })
    // Give any (erroneous) floating cleanup a chance to run before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockClearStoredMasterKey).not.toHaveBeenCalled()
    expect(mockQueryClientClear).not.toHaveBeenCalled()
    expect(mockQueryStorageRemoveItem).not.toHaveBeenCalled()
    expect(mockResetSyncCursors).not.toHaveBeenCalled()
  })

  it('does NOT run cleanup on SIGNED_IN', async () => {
    initAuthListener()

    authChangeCallback!('SIGNED_IN', { user: { id: 'user-2', email: 'b@c.d' } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockClearStoredMasterKey).not.toHaveBeenCalled()
    expect(mockQueryClientClear).not.toHaveBeenCalled()
    expect(mockResetSyncCursors).not.toHaveBeenCalled()
  })
})
