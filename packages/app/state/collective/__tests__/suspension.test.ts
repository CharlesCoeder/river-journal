/**
 * Story 3-8 — TDD red-phase unit tests for `state/collective/suspension.ts`.
 *
 * Red-phase contract: every test MUST fail until Story 3-8's Task 2 creates
 * `packages/app/state/collective/suspension.ts`.
 *
 * AC coverage (AC #16, #23, #27):
 *   t1 — calls supabase.rpc('is_active_suspension') and returns boolean (AC #16, #27-t1)
 *   t2 — when userId===null, hook is disabled and RPC is NOT called (AC #16, #27-t2)
 *   t3 — boundary rule (D7): suspension.ts does NOT contain @legendapp/state (AC #23, #27-t3)
 *   t4 — queryKey is ['collective', 'suspension', userId, 'post_react'] (AC #16)
 *   t5 — staleTime is 60_000 (AC #16)
 *   t6 — currentUser.ts exists and does NOT contain @legendapp/state (AC #23)
 *
 * Mock strategy: vi.mock for supabase (hoisted RPC mock); vi.mock for useQuery;
 * mirrors reactions.test.ts patterns.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// ─── Path constants ───────────────────────────────────────────────────────────
const COLLECTIVE_DIR = path.resolve(__dirname, '..')
const SUSPENSION_PATH = path.join(COLLECTIVE_DIR, 'suspension.ts')
const CURRENT_USER_PATH = path.join(COLLECTIVE_DIR, 'currentUser.ts')

// ─── Supabase mock — hoisted RPC mock ─────────────────────────────────────────
const { rpcMock } = vi.hoisted(() => {
  const rpcMock = vi.fn()
  return { rpcMock }
})

vi.mock('../../../utils/supabase', () => ({
  supabase: {
    rpc: rpcMock,
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: 'user-test-123' } } },
        error: null,
      }),
    },
  },
}))

// ─── useQuery mock — inspect hook config without React renderer ───────────────
const useQueryMock = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: unknown) => useQueryMock(opts),
}))

beforeEach(() => {
  rpcMock.mockReset()
  useQueryMock.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
// File existence check
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / suspension.ts existence', () => {
  it('suspension.ts exists at the expected path', () => {
    expect(
      existsSync(SUSPENSION_PATH),
      `suspension.ts must exist at ${SUSPENSION_PATH}`
    ).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t1 — calls supabase.rpc('is_active_suspension') and returns boolean
// AC #16, #27-t1
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t1 — useIsSuspended calls RPC correctly (AC #16)', () => {
  it('useQuery is called with a queryFn that invokes supabase.rpc("is_active_suspension")', async () => {
    useQueryMock.mockReturnValue({ data: false })

    const { useIsSuspended } = await import('../suspension')
    useIsSuspended('user-abc')

    expect(useQueryMock).toHaveBeenCalledTimes(1)
    const opts = useQueryMock.mock.calls[0]![0]
    expect(typeof opts.queryFn).toBe('function')

    // Invoke the queryFn and verify it calls supabase.rpc with correct args
    rpcMock.mockResolvedValueOnce({ data: true, error: null })
    const result = await opts.queryFn()
    expect(rpcMock).toHaveBeenCalledWith('is_active_suspension', {
      uid: 'user-abc',
      kind_param: 'post_react',
    })
    expect(result).toBe(true)
  })

  it('returns boolean false when RPC returns false', async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null })
    useQueryMock.mockReturnValue({ data: false })

    const { useIsSuspended } = await import('../suspension')
    const result = useIsSuspended('user-abc')
    expect(result).toBe(false)
  })

  it('returns boolean true when RPC returns true', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null })
    useQueryMock.mockReturnValue({ data: true })

    const { useIsSuspended } = await import('../suspension')
    const result = useIsSuspended('user-suspended')
    expect(result).toBe(true)
  })

  it('returns undefined when query is still loading', async () => {
    useQueryMock.mockReturnValue({ data: undefined })

    const { useIsSuspended } = await import('../suspension')
    const result = useIsSuspended('user-loading')
    expect(result).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t2 — when userId===null, hook is disabled; RPC NOT called
// AC #16, #27-t2
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t2 — disabled when userId===null (AC #16)', () => {
  it('passes enabled:false to useQuery when userId===null', async () => {
    useQueryMock.mockReturnValue({ data: undefined })

    const { useIsSuspended } = await import('../suspension')
    useIsSuspended(null)

    expect(useQueryMock).toHaveBeenCalledTimes(1)
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.enabled).toBe(false)
  })

  it('returns undefined when userId===null', async () => {
    useQueryMock.mockReturnValue({ data: undefined })

    const { useIsSuspended } = await import('../suspension')
    const result = useIsSuspended(null)
    expect(result).toBeUndefined()
  })

  it('does NOT invoke supabase.rpc when userId===null (queryFn not called when disabled)', async () => {
    // When enabled:false, TanStack Query never calls queryFn
    // We verify enabled:false is set, which is the guarantee
    useQueryMock.mockReturnValue({ data: undefined })

    const { useIsSuspended } = await import('../suspension')
    useIsSuspended(null)

    // queryFn should NOT have been called (hook is disabled)
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t3 — boundary rule (D7): suspension.ts does NOT contain @legendapp/state
// AC #23, #27-t3
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t3 — boundary rule D7 (AC #23)', () => {
  it('suspension.ts does NOT contain @legendapp/state import', () => {
    expect(existsSync(SUSPENSION_PATH)).toBe(true)
    const src = readFileSync(SUSPENSION_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state(?:\/[\w-]+(?:\/[\w-]+)?)?/)
  })

  it('suspension.ts does NOT contain use$() calls', () => {
    expect(existsSync(SUSPENSION_PATH)).toBe(true)
    const src = readFileSync(SUSPENSION_PATH, 'utf8')
    expect(src).not.toMatch(/use\$\(/)
  })

  it('suspension.ts does NOT import from app/state/store', () => {
    expect(existsSync(SUSPENSION_PATH)).toBe(true)
    const src = readFileSync(SUSPENSION_PATH, 'utf8')
    expect(src).not.toMatch(/from ['"]app\/state\/store['"]/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t4 — queryKey is correct
// AC #16
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t4 — useIsSuspended queryKey shape (AC #16)', () => {
  it('queryKey is ["collective", "suspension", userId, "post_react"]', async () => {
    useQueryMock.mockReturnValue({ data: undefined })

    const { useIsSuspended } = await import('../suspension')
    useQueryMock.mockReset()
    useIsSuspended('user-key-test')

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.queryKey).toEqual(['collective', 'suspension', 'user-key-test', 'post_react'])
  })

  it('queryKey includes null userId when passed null', async () => {
    useQueryMock.mockReturnValue({ data: undefined })

    const { useIsSuspended } = await import('../suspension')
    useQueryMock.mockReset()
    useIsSuspended(null)

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.queryKey).toEqual(['collective', 'suspension', null, 'post_react'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t5 — staleTime is 60_000
// AC #16
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t5 — useIsSuspended staleTime (AC #16)', () => {
  it('staleTime is 60_000 (60 seconds)', async () => {
    useQueryMock.mockReturnValue({ data: undefined })

    const { useIsSuspended } = await import('../suspension')
    useQueryMock.mockReset()
    useIsSuspended('user-stale')

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.staleTime).toBe(60_000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t6 — currentUser.ts exists and is D7-compliant
// AC #23
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t6 — currentUser.ts D7 compliance (AC #23)', () => {
  it('currentUser.ts exists at the expected path', () => {
    expect(
      existsSync(CURRENT_USER_PATH),
      `currentUser.ts must exist at ${CURRENT_USER_PATH}`
    ).toBe(true)
  })

  it('currentUser.ts does NOT contain @legendapp/state import', () => {
    expect(existsSync(CURRENT_USER_PATH)).toBe(true)
    const src = readFileSync(CURRENT_USER_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state(?:\/[\w-]+(?:\/[\w-]+)?)?/)
  })

  it('currentUser.ts does NOT import from app/state/store', () => {
    expect(existsSync(CURRENT_USER_PATH)).toBe(true)
    const src = readFileSync(CURRENT_USER_PATH, 'utf8')
    expect(src).not.toMatch(/from ['"]app\/state\/store['"]/)
  })

  it('currentUser.ts does NOT use use$() calls', () => {
    expect(existsSync(CURRENT_USER_PATH)).toBe(true)
    const src = readFileSync(CURRENT_USER_PATH, 'utf8')
    expect(src).not.toMatch(/use\$\(/)
  })

  it('currentUser.ts exports useCurrentUserId', async () => {
    const mod = await import('../currentUser')
    expect(typeof mod.useCurrentUserId).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// useIsSuspended hook — error handling
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / useIsSuspended error handling', () => {
  it('queryFn throws when supabase returns a PostgrestError', async () => {
    const pgError = { message: 'permission denied', code: '42501', details: null, hint: null }
    rpcMock.mockResolvedValueOnce({ data: null, error: pgError })
    useQueryMock.mockReturnValue({ data: undefined })

    const { useIsSuspended } = await import('../suspension')
    useQueryMock.mockReset()
    useIsSuspended('user-error')

    const opts = useQueryMock.mock.calls[0]![0]
    rpcMock.mockResolvedValueOnce({ data: null, error: pgError })

    await expect(opts.queryFn()).rejects.toBeDefined()
  })
})
