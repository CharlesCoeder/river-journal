/**
 * Red-phase unit tests for the new `state/collective/unreadReplies.ts` query
 * hook — the unread-Collective-replies count signal the web/desktop in-app
 * reminder card reads.
 *
 * Red-phase contract: every test MUST fail until `state/collective/unreadReplies.ts`
 * exists — the whole file fails at the top-level `import { useUnreadReplies }
 * from '../unreadReplies'` with a module-resolution error, per this repo's
 * established red-phase convention (see `moderationReceipts.test.ts`,
 * `suspension.test.ts`).
 *
 * Contract this file locks in for the implementation (D7-clean: TanStack
 * Query only, no Legend-State import — mirrors `moderationReceipts.ts` /
 * `suspension.ts`):
 *
 *   useUnreadReplies(userId: string | null, since: string | null)
 *     — queryKey: ['collective', 'unreadReplies', userId, since] as const
 *     — queryFn calls supabase.rpc('unread_replies_for_user', { since })
 *       and returns the raw numeric count (throws on a PostgrestError)
 *     — enabled: userId !== null && since !== null
 *     — staleTime: Infinity (once per app open, never a background refetch)
 *     — refetchOnWindowFocus: false
 *     — refetchOnMount: false
 *     — returns the raw `useQuery` result object (un-unwrapped), consistent
 *       with `useMyRemovedPosts` / `useMyActiveSuspension`'s own convention,
 *       so the gate reads `.data`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const COLLECTIVE_DIR = path.resolve(__dirname, '..')
const UNREAD_REPLIES_PATH = path.join(COLLECTIVE_DIR, 'unreadReplies.ts')

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('app/utils/supabase', () => ({
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

const useQueryMock = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: unknown) => useQueryMock(opts),
}))

beforeEach(() => {
  rpcMock.mockReset()
  useQueryMock.mockReset()
})

describe('useUnreadReplies — module surface', () => {
  it('state/collective/unreadReplies.ts exists', () => {
    expect(existsSync(UNREAD_REPLIES_PATH)).toBe(true)
  })

  it('exports useUnreadReplies as a named function', async () => {
    const mod = await import('../unreadReplies')
    expect(typeof mod.useUnreadReplies).toBe('function')
  })

  it('does NOT contain a @legendapp/state import (D7 boundary)', () => {
    expect(existsSync(UNREAD_REPLIES_PATH)).toBe(true)
    const src = readFileSync(UNREAD_REPLIES_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state(?:\/[\w-]+(?:\/[\w-]+)?)?/)
  })

  it('does NOT call use$()', () => {
    const src = readFileSync(UNREAD_REPLIES_PATH, 'utf8')
    expect(src).not.toMatch(/use\$\(/)
  })

  it('does NOT import from app/state/store', () => {
    const src = readFileSync(UNREAD_REPLIES_PATH, 'utf8')
    expect(src).not.toMatch(/from ['"]app\/state\/store['"]/)
  })
})

describe('useUnreadReplies — RPC query shape', () => {
  it('queryFn calls supabase.rpc("unread_replies_for_user", { since })', async () => {
    useQueryMock.mockReturnValue({ data: 0 })

    const { useUnreadReplies } = await import('../unreadReplies')
    useUnreadReplies('user-abc', '2026-07-01T00:00:00.000Z')

    expect(useQueryMock).toHaveBeenCalledTimes(1)
    const opts = useQueryMock.mock.calls[0]![0]
    expect(typeof opts.queryFn).toBe('function')

    rpcMock.mockResolvedValueOnce({ data: 3, error: null })
    const result = await opts.queryFn()

    expect(rpcMock).toHaveBeenCalledWith('unread_replies_for_user', {
      since: '2026-07-01T00:00:00.000Z',
    })
    expect(result).toBe(3)
  })

  it('queryKey is ["collective", "unreadReplies", userId, since]', async () => {
    useQueryMock.mockReturnValue({ data: 0 })

    const { useUnreadReplies } = await import('../unreadReplies')
    useQueryMock.mockReset()
    useUnreadReplies('user-key-test', '2026-07-05T00:00:00.000Z')

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.queryKey).toEqual([
      'collective',
      'unreadReplies',
      'user-key-test',
      '2026-07-05T00:00:00.000Z',
    ])
  })

  it('staleTime is Infinity (once per app open, never a background refetch)', async () => {
    useQueryMock.mockReturnValue({ data: 0 })

    const { useUnreadReplies } = await import('../unreadReplies')
    useQueryMock.mockReset()
    useUnreadReplies('user-abc', '2026-07-01T00:00:00.000Z')

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.staleTime).toBe(Number.POSITIVE_INFINITY)
  })

  it('refetchOnWindowFocus and refetchOnMount are both false', async () => {
    useQueryMock.mockReturnValue({ data: 0 })

    const { useUnreadReplies } = await import('../unreadReplies')
    useQueryMock.mockReset()
    useUnreadReplies('user-abc', '2026-07-01T00:00:00.000Z')

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.refetchOnWindowFocus).toBe(false)
    expect(opts.refetchOnMount).toBe(false)
  })

  it('is disabled (enabled:false) and does not call the RPC when userId is null', async () => {
    useQueryMock.mockReturnValue({ data: 0 })

    const { useUnreadReplies } = await import('../unreadReplies')
    useQueryMock.mockReset()
    useUnreadReplies(null, '2026-07-01T00:00:00.000Z')

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.enabled).toBe(false)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('is disabled (enabled:false) when since is null, even with a valid userId (mount-pinned since not yet captured)', async () => {
    useQueryMock.mockReturnValue({ data: 0 })

    const { useUnreadReplies } = await import('../unreadReplies')
    useQueryMock.mockReset()
    useUnreadReplies('user-abc', null)

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.enabled).toBe(false)
  })

  it('is enabled when both userId and since are non-null', async () => {
    useQueryMock.mockReturnValue({ data: 0 })

    const { useUnreadReplies } = await import('../unreadReplies')
    useQueryMock.mockReset()
    useUnreadReplies('user-abc', '2026-07-01T00:00:00.000Z')

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.enabled).toBe(true)
  })

  it('surfaces the raw useQuery result object so the caller reads .data', async () => {
    useQueryMock.mockReturnValue({ data: 5 })

    const { useUnreadReplies } = await import('../unreadReplies')
    const result = useUnreadReplies('user-abc', '2026-07-01T00:00:00.000Z')
    expect(result).toEqual({ data: 5 })
  })

  it('queryFn throws when the RPC returns a PostgrestError', async () => {
    useQueryMock.mockReturnValue({ data: undefined })

    const { useUnreadReplies } = await import('../unreadReplies')
    useQueryMock.mockReset()
    useUnreadReplies('user-error', '2026-07-01T00:00:00.000Z')

    const opts = useQueryMock.mock.calls[0]![0]
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'boom', code: '42501', details: null, hint: null },
    })
    await expect(opts.queryFn()).rejects.toBeDefined()
  })
})
