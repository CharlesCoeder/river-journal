/**
 * TDD red-phase unit tests for `state/collective/blocks.ts`.
 *
 * Red-phase contract: every test in this file MUST fail until the module is
 * created — either at import resolution (the module does not exist) or at
 * the specific behavioral assertion once a stub exists.
 *
 * Surface covered:
 *   - `blockedUsersKey` / `blockedUsersKeyForUser(userId)` query-key shape.
 *   - `useBlockUser()` mutation: direct PostgREST insert with explicit
 *     `blocker_user_id`; constraint-scoped `23505` idempotency swallow (never
 *     code-only); an FK `23503` on the SAME insert must throw, never be
 *     mistaken for the duplicate-block swallow; `onSettled` invalidates the
 *     `['collective']` prefix; `onMutate` is a no-op returning null.
 *   - `useUnblockUser()` mutation: DELETE by row `id`; a zero-row delete is a
 *     silent no-op (no throw); `onSettled` invalidates `['collective']`.
 *   - `setMutationDefaults` registration for both mutations at module load,
 *     `gcTime` === 24h.
 *   - `useBlockedUsers(userId)`: query key, `enabled` only for a string
 *     userId, ordered `created_at` descending, no polling.
 *   - Boundary rule (D7): the module does not import `@legendapp/state`.
 *
 * Mock strategy: `app/utils/supabase` is a hoisted chainable mock (mirrors
 * `mutations.test.ts` / `reactions.test.ts`). `@tanstack/react-query` is
 * partially mocked — `useQuery` is replaced with a spy so `useBlockedUsers`
 * can be invoked directly without a React renderer, while every other export
 * (crucially `QueryClient`) passes through untouched so the real
 * `app/state/queryClient` singleton keeps working for the
 * `setMutationDefaults` assertions.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// ─── Path constants ───────────────────────────────────────────────────────────
const COLLECTIVE_DIR = path.resolve(__dirname, '..')
const BLOCKS_PATH = path.join(COLLECTIVE_DIR, 'blocks.ts')

// ─── Supabase mock — hoisted before SUT import ───────────────────────────────
const { insertMock, deleteMock, deleteEqMock, selectMock, selectEqMock, orderMock, fromMock } =
  vi.hoisted(() => {
    const insertMock = vi.fn()
    const deleteEqMock = vi.fn()
    const deleteMock = vi.fn(() => ({ eq: deleteEqMock }))
    const orderMock = vi.fn()
    const selectEqMock = vi.fn(() => ({ order: orderMock }))
    const selectMock = vi.fn(() => ({ eq: selectEqMock }))
    const fromMock = vi.fn(() => ({ insert: insertMock, delete: deleteMock, select: selectMock }))
    return { insertMock, deleteMock, deleteEqMock, selectMock, selectEqMock, orderMock, fromMock }
  })

vi.mock('app/utils/supabase', () => ({
  supabase: { from: fromMock },
}))

// ─── Partial @tanstack/react-query mock — useQuery spied, everything else real ─
const useQueryMock = vi.fn()
vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: (opts: unknown) => useQueryMock(opts),
  }
})

// ─── SUT import — after mocks are hoisted ────────────────────────────────────
// Importing blocks.ts triggers setMutationDefaults at module load, registering
// the collective.block / collective.unblock defaults on the shared queryClient
// singleton before tests run. This import is the red-phase failure point until
// state/collective/blocks.ts exists.
import 'app/state/collective/blocks'
import { queryClient } from 'app/state/queryClient'
import {
  blockedUsersKey,
  blockedUsersKeyForUser,
  useBlockUser,
  useUnblockUser,
  useBlockedUsers,
} from 'app/state/collective/blocks'

// TanStack Query v5.100: mutation lifecycle callbacks take a trailing
// MutationFunctionContext. Tests invoke the registered defaults manually, so
// supply a minimal context. The registered impls ignore it.
const MUTATION_FN_CONTEXT = { client: queryClient, meta: undefined }

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

beforeEach(() => {
  insertMock.mockResolvedValue({ data: [], error: null })
  deleteEqMock.mockResolvedValue({ error: null })
  orderMock.mockResolvedValue({ data: [], error: null })
  useQueryMock.mockReset()
  queryClient.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// Query-key shape
// ─────────────────────────────────────────────────────────────────────────────

describe('blockedUsersKey / blockedUsersKeyForUser shape', () => {
  it('blockedUsersKey deep-equals ["collective", "blockedUsers"]', () => {
    expect(blockedUsersKey).toEqual(['collective', 'blockedUsers'])
  })

  it('blockedUsersKeyForUser extends the prefix with the user id', () => {
    expect(blockedUsersKeyForUser('user-A')).toEqual(['collective', 'blockedUsers', 'user-A'])
  })

  it('stays under the blockedUsersKey prefix so ["collective"] invalidations still match', () => {
    const scoped = blockedUsersKeyForUser('user-A')
    expect(scoped.slice(0, blockedUsersKey.length)).toEqual([...blockedUsersKey])
  })

  it('produces distinct keys for distinct users', () => {
    expect(blockedUsersKeyForUser('user-A')).not.toEqual(blockedUsersKeyForUser('user-B'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// setMutationDefaults registration at module load
// ─────────────────────────────────────────────────────────────────────────────

describe('setMutationDefaults registration (module-load discipline)', () => {
  it('registers defaults under mutationKey ["collective", "block"]', () => {
    const defaults = queryClient.getMutationDefaults(['collective', 'block'])
    expect(defaults).toBeDefined()
    expect(typeof defaults?.mutationFn).toBe('function')
  })

  it('registers defaults under mutationKey ["collective", "unblock"]', () => {
    const defaults = queryClient.getMutationDefaults(['collective', 'unblock'])
    expect(defaults).toBeDefined()
    expect(typeof defaults?.mutationFn).toBe('function')
  })

  it('block defaults declare gcTime === 24h', () => {
    const defaults = queryClient.getMutationDefaults(['collective', 'block'])
    expect(defaults?.gcTime).toBe(TWENTY_FOUR_HOURS_MS)
  })

  it('unblock defaults declare gcTime === 24h', () => {
    const defaults = queryClient.getMutationDefaults(['collective', 'unblock'])
    expect(defaults?.gcTime).toBe(TWENTY_FOUR_HOURS_MS)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// useBlockUser — mutationFn: direct PostgREST insert
// ─────────────────────────────────────────────────────────────────────────────

describe('useBlockUser mutationFn — direct PostgREST insert', () => {
  it('inserts the exact { blocker_user_id, blocked_user_id } payload', async () => {
    const blockDefaults = queryClient.getMutationDefaults(['collective', 'block'])
    expect(blockDefaults).toBeDefined()

    await (blockDefaults!.mutationFn as (vars: unknown) => Promise<unknown>)({
      blocker_user_id: 'blocker-1',
      blocked_user_id: 'blocked-1',
    })

    expect(fromMock).toHaveBeenCalledWith('user_blocks')
    expect(insertMock).toHaveBeenCalledWith({
      blocker_user_id: 'blocker-1',
      blocked_user_id: 'blocked-1',
    })
  })

  it('does NOT throw when the insert resolves with no error', async () => {
    const blockDefaults = queryClient.getMutationDefaults(['collective', 'block'])
    insertMock.mockResolvedValueOnce({ data: [], error: null })

    await expect(
      (blockDefaults!.mutationFn as (vars: unknown) => Promise<unknown>)({
        blocker_user_id: 'blocker-2',
        blocked_user_id: 'blocked-2',
      })
    ).resolves.not.toThrow()
  })
})

describe('useBlockUser mutationFn — 23505 idempotency swallow is constraint-scoped', () => {
  it('swallows a 23505 error on constraint user_blocks_blocker_blocked_key (offline-replay duplicate)', async () => {
    const blockDefaults = queryClient.getMutationDefaults(['collective', 'block'])
    insertMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23505',
        constraint: 'user_blocks_blocker_blocked_key',
        message: 'duplicate key',
      },
    })

    await expect(
      (blockDefaults!.mutationFn as (vars: unknown) => Promise<unknown>)({
        blocker_user_id: 'blocker-3',
        blocked_user_id: 'blocked-3',
      })
    ).resolves.not.toThrow()
  })

  it('throws on a 23505 error on a DIFFERENT constraint (code-only match would be a bug)', async () => {
    const blockDefaults = queryClient.getMutationDefaults(['collective', 'block'])
    insertMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23505',
        constraint: 'some_other_unique_constraint',
        message: 'duplicate key',
      },
    })

    await expect(
      (blockDefaults!.mutationFn as (vars: unknown) => Promise<unknown>)({
        blocker_user_id: 'blocker-4',
        blocked_user_id: 'blocked-4',
      })
    ).rejects.toBeDefined()
  })

  it('throws on a 23503 FK violation (deleted author / offline-replay against a now-gone author) — NEVER mistaken for the duplicate swallow', async () => {
    const blockDefaults = queryClient.getMutationDefaults(['collective', 'block'])
    insertMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23503',
        constraint: 'user_blocks_blocked_user_id_fkey',
        message: 'foreign key violation',
      },
    })

    await expect(
      (blockDefaults!.mutationFn as (vars: unknown) => Promise<unknown>)({
        blocker_user_id: 'blocker-5',
        blocked_user_id: 'deleted-author',
      })
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('throws on any other unrelated error (e.g. 42501 RLS denial)', async () => {
    const blockDefaults = queryClient.getMutationDefaults(['collective', 'block'])
    insertMock.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'row-level security violation' },
    })

    await expect(
      (blockDefaults!.mutationFn as (vars: unknown) => Promise<unknown>)({
        blocker_user_id: 'blocker-6',
        blocked_user_id: 'blocked-6',
      })
    ).rejects.toMatchObject({ code: '42501' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// useBlockUser — onMutate / onSettled contract
// ─────────────────────────────────────────────────────────────────────────────

describe('useBlockUser onMutate — no-optimistic contract', () => {
  it('onMutate is a no-op that resolves to null', async () => {
    const blockDefaults = queryClient.getMutationDefaults(['collective', 'block'])
    expect(blockDefaults?.onMutate).toBeDefined()

    const result = await (
      blockDefaults!.onMutate as (vars: unknown, ctx: unknown) => Promise<unknown>
    )({ blocker_user_id: 'b1', blocked_user_id: 'b2' }, MUTATION_FN_CONTEXT)

    expect(result).toBeNull()
  })

  it('onMutate does NOT touch any cached query data (no cache mutated for the block/unblock path)', async () => {
    const blockDefaults = queryClient.getMutationDefaults(['collective', 'block'])
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData')

    await (blockDefaults!.onMutate as (vars: unknown, ctx: unknown) => Promise<unknown>)(
      { blocker_user_id: 'b1', blocked_user_id: 'b2' },
      MUTATION_FN_CONTEXT
    )

    expect(setQueryDataSpy).not.toHaveBeenCalled()
  })
})

describe('useBlockUser onSettled — invalidates the ["collective"] prefix', () => {
  it('calls invalidateQueries with queryKey: ["collective"]', async () => {
    const blockDefaults = queryClient.getMutationDefaults(['collective', 'block'])
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await (blockDefaults!.onSettled as (...args: unknown[]) => Promise<unknown>)(
      undefined,
      null,
      { blocker_user_id: 'b1', blocked_user_id: 'b2' },
      null,
      MUTATION_FN_CONTEXT
    )

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['collective'] })
    )
    invalidateSpy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// useUnblockUser — mutationFn: DELETE by row id
// ─────────────────────────────────────────────────────────────────────────────

describe('useUnblockUser mutationFn — DELETE by row id', () => {
  it('deletes the row matching vars.id', async () => {
    const unblockDefaults = queryClient.getMutationDefaults(['collective', 'unblock'])
    expect(unblockDefaults).toBeDefined()

    await (unblockDefaults!.mutationFn as (vars: unknown) => Promise<unknown>)({ id: 'row-1' })

    expect(fromMock).toHaveBeenCalledWith('user_blocks')
    expect(deleteEqMock).toHaveBeenCalledWith('id', 'row-1')
  })

  it('a zero-row-match delete resolves cleanly (silent no-op, offline-replay idempotency)', async () => {
    const unblockDefaults = queryClient.getMutationDefaults(['collective', 'unblock'])
    deleteEqMock.mockResolvedValueOnce({ error: null })

    await expect(
      (unblockDefaults!.mutationFn as (vars: unknown) => Promise<unknown>)({
        id: 'row-already-gone',
      })
    ).resolves.not.toThrow()
  })

  it('throws when the delete returns an error', async () => {
    const unblockDefaults = queryClient.getMutationDefaults(['collective', 'unblock'])
    deleteEqMock.mockResolvedValueOnce({ error: { code: '42501', message: 'denied' } })

    await expect(
      (unblockDefaults!.mutationFn as (vars: unknown) => Promise<unknown>)({ id: 'row-2' })
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('useUnblockUser onMutate / onSettled', () => {
  it('onMutate is a no-op that resolves to null', async () => {
    const unblockDefaults = queryClient.getMutationDefaults(['collective', 'unblock'])
    const result = await (
      unblockDefaults!.onMutate as (vars: unknown, ctx: unknown) => Promise<unknown>
    )({ id: 'row-3' }, MUTATION_FN_CONTEXT)

    expect(result).toBeNull()
  })

  it('onSettled invalidates the ["collective"] prefix', async () => {
    const unblockDefaults = queryClient.getMutationDefaults(['collective', 'unblock'])
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await (unblockDefaults!.onSettled as (...args: unknown[]) => Promise<unknown>)(
      undefined,
      null,
      { id: 'row-3' },
      null,
      MUTATION_FN_CONTEXT
    )

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['collective'] })
    )
    invalidateSpy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Thin consumer hooks — no inline mutationFn (footgun #1)
// ─────────────────────────────────────────────────────────────────────────────

describe('Consumer hooks are thin (no inline mutationFn — replay footgun)', () => {
  it('useBlockUser and useUnblockUser are exported functions', () => {
    expect(typeof useBlockUser).toBe('function')
    expect(typeof useUnblockUser).toBe('function')
  })

  it('blocks.ts declares mutationFn exactly twice in source (module-load registration only — no inline fn in the hooks)', () => {
    expect(existsSync(BLOCKS_PATH)).toBe(true)
    const src = readFileSync(BLOCKS_PATH, 'utf8')
    const matches = src.match(/mutationFn\s*:/g) ?? []
    expect(matches.length).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// useBlockedUsers — query config
// ─────────────────────────────────────────────────────────────────────────────

describe('useBlockedUsers — enabled gating', () => {
  it('is disabled when userId is undefined (session still resolving)', () => {
    useBlockedUsers(undefined)
    expect(useQueryMock).toHaveBeenCalledTimes(1)
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.enabled).toBe(false)
  })

  it('is disabled when userId is null (signed out)', () => {
    useBlockedUsers(null)
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.enabled).toBe(false)
  })

  it('is enabled when userId is a string', () => {
    useBlockedUsers('user-abc')
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.enabled).toBe(true)
  })
})

describe('useBlockedUsers — query key', () => {
  it('passes queryKey === blockedUsersKeyForUser(userId) for a string userId', () => {
    useBlockedUsers('user-xyz')
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.queryKey).toEqual(blockedUsersKeyForUser('user-xyz'))
  })
})

describe('useBlockedUsers — queryFn: own list, ordered created_at DESC', () => {
  it('queryFn calls supabase.from("user_blocks").select("*").eq("blocker_user_id", userId).order("created_at", { ascending: false })', async () => {
    orderMock.mockResolvedValueOnce({ data: [], error: null })

    useBlockedUsers('user-order-test')
    const opts = useQueryMock.mock.calls[0]![0]
    expect(typeof opts.queryFn).toBe('function')

    await opts.queryFn()

    expect(fromMock).toHaveBeenCalledWith('user_blocks')
    expect(selectMock).toHaveBeenCalledWith('*')
    expect(selectEqMock).toHaveBeenCalledWith('blocker_user_id', 'user-order-test')
    expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('queryFn throws on a Supabase error', async () => {
    orderMock.mockResolvedValueOnce({ data: null, error: { code: '500', message: 'boom' } })

    useBlockedUsers('user-error-test')
    const opts = useQueryMock.mock.calls[0]![0]

    await expect(opts.queryFn()).rejects.toBeDefined()
  })
})

describe('useBlockedUsers — no polling (not a feed)', () => {
  it('does not declare a refetchInterval', () => {
    useBlockedUsers('user-no-poll')
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.refetchInterval).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Boundary rule (D7) — no Legend-State import
// ─────────────────────────────────────────────────────────────────────────────

describe('Boundary rule (D7) — blocks.ts imports TanStack Query + supabase only', () => {
  it('blocks.ts exists on disk', () => {
    expect(existsSync(BLOCKS_PATH)).toBe(true)
  })

  it('blocks.ts does NOT contain an @legendapp/state import', () => {
    expect(existsSync(BLOCKS_PATH)).toBe(true)
    const src = readFileSync(BLOCKS_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('blocks.ts does NOT import use$ (Legend-State react bindings)', () => {
    expect(existsSync(BLOCKS_PATH)).toBe(true)
    const src = readFileSync(BLOCKS_PATH, 'utf8')
    expect(src).not.toMatch(/\buse\$\(/)
  })
})
