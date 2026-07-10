/**
 * `recordAgeAttestation()` — one-time 13+ attestation write.
 *
 * Mirrors the idempotent best-effort `users` UPDATE pattern in
 * `state/timezoneSync.ts` (see Dev Notes), but writes `age_attested_at`
 * instead of `timezone`. Covers:
 *   - issues `update({ age_attested_at }).eq('id', userId).is('age_attested_at', null)`
 *   - resolves `userId` from `store$.session.userId.peek()` when no arg is given
 *   - no-ops (never calls supabase) when no userId is available at all
 *   - swallows a Supabase error response (never throws, never blocks)
 *   - swallows a thrown/rejected client call (never throws, never blocks)
 *
 * Mock style follows `utils/__tests__/auth-google.test.ts` /
 * `auth-signout.test.ts` — the Supabase client is mocked with a chainable
 * `from().update().eq().is()` spy, `store$` is mocked with a controllable
 * `session.userId.peek()`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockIs = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ error: null as { message: string } | null })
)
const mockEq = vi.fn((..._args: unknown[]) => ({ is: mockIs }))
const mockUpdate = vi.fn((..._args: unknown[]) => ({ eq: mockEq }))
const mockFrom = vi.fn((..._args: unknown[]) => ({ update: mockUpdate }))

vi.mock('../supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(() => Promise.resolve({ error: null })),
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

// Import after mocks
import { recordAgeAttestation } from '../auth'

beforeEach(() => {
  vi.clearAllMocks()
  currentUserId = 'user-1'
  mockIs.mockResolvedValue({ error: null })
})

describe('recordAgeAttestation() — write shape', () => {
  it('issues update({ age_attested_at }) scoped to the userId and null-guarded', async () => {
    await recordAgeAttestation('user-42')

    expect(mockFrom).toHaveBeenCalledWith('users')
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ age_attested_at: expect.any(String) })
    )
    expect(mockEq).toHaveBeenCalledWith('id', 'user-42')
    expect(mockIs).toHaveBeenCalledWith('age_attested_at', null)
  })

  it('writes an ISO timestamp string', async () => {
    await recordAgeAttestation('user-42')
    const [{ age_attested_at }] = mockUpdate.mock.calls[0] as unknown as [
      { age_attested_at: string },
    ]
    expect(() => new Date(age_attested_at).toISOString()).not.toThrow()
  })
})

describe('recordAgeAttestation() — userId resolution', () => {
  it('resolves userId from store$.session.userId.peek() when no arg is given', async () => {
    currentUserId = 'user-from-store'
    await recordAgeAttestation()
    expect(mockEq).toHaveBeenCalledWith('id', 'user-from-store')
  })

  it('prefers an explicit userId argument over the store value', async () => {
    currentUserId = 'user-from-store'
    await recordAgeAttestation('explicit-user')
    expect(mockEq).toHaveBeenCalledWith('id', 'explicit-user')
  })

  it('no-ops (never calls supabase) when no userId is available anywhere', async () => {
    currentUserId = null
    await recordAgeAttestation()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('no-ops when called with an empty-string userId and no store fallback', async () => {
    currentUserId = null
    await recordAgeAttestation('')
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('recordAgeAttestation() — best-effort error handling (never blocks auth)', () => {
  it('swallows a Supabase error response without throwing', async () => {
    mockIs.mockResolvedValueOnce({ error: { message: 'network down' } })
    await expect(recordAgeAttestation('user-1')).resolves.toBeUndefined()
  })

  it('swallows a rejected/thrown client call without throwing', async () => {
    mockIs.mockRejectedValueOnce(new Error('fetch failed'))
    await expect(recordAgeAttestation('user-1')).resolves.toBeUndefined()
  })
})
