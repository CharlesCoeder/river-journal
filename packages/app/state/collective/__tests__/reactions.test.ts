/**
 * Story 3-11 — TDD red-phase unit tests for `state/collective/reactions.ts`.
 *
 * Red-phase contract: every test in this file MUST fail until Story 3-11
 * creates `packages/app/state/collective/reactions.ts`.
 *
 * AC coverage (AC #5, #16, #18):
 *   - t1: fetchPostReactions returns correct { counts, userReactions } shape
 *         from a mixed reaction set (some by current user, some by others,
 *         one with user_id: null).
 *   - t2: Anonymized reactions (user_id IS NULL) count toward counts but
 *         NEVER appear in userReactions.
 *   - t3: Empty result yields all-zero counts and all-null userReactions.
 *   - t4: Supabase error re-throws for TanStack Query's retry contract.
 *   - t5: Boundary rule (D7) — reactions.ts source does NOT contain
 *         @legendapp/state import.
 *
 * Also covers:
 *   - collectiveReactionsKey shape
 *   - usePostReactions query config (queryKey, staleTime)
 *
 * Mock strategy: vi.hoisted() for Supabase chainable mock (mirrors feed.test.ts /
 * yourPosts.test.ts pattern). useQuery mocked for hook config inspection without
 * a React renderer.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// ─── Path constants ───────────────────────────────────────────────────────────
const COLLECTIVE_DIR = path.resolve(__dirname, '..')
const REACTIONS_PATH = path.join(COLLECTIVE_DIR, 'reactions.ts')

// ─── Supabase mock — hoisted so the factory runs before vi.mock() ─────────────
// The chainable pattern for SELECT queries:
//   supabase.from('collective_reactions').select('...').eq('post_id', postId)
// Each step returns a chainable object; the final .eq() returns a Promise.

const { selectMock, eqMock, fromMock } = vi.hoisted(() => {
  const eqMock = vi.fn()
  const selectMock = vi.fn()
  const fromMock = vi.fn()
  return { selectMock, eqMock, fromMock }
})

vi.mock('../../../utils/supabase', () => ({
  supabase: {
    from: fromMock,
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-current' } }, error: null }),
    },
  },
}))

// ─── Mock useQuery so we can inspect hook config without a React renderer ────
const useQueryMock = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: unknown) => useQueryMock(opts),
}))

// ─── Default mock chain setup ─────────────────────────────────────────────────
beforeEach(() => {
  eqMock.mockResolvedValue({ data: [], error: null })
  selectMock.mockReturnValue({ eq: eqMock })
  fromMock.mockReturnValue({ select: selectMock })
  useQueryMock.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
// collectiveReactionsKey shape
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-11 / collectiveReactionsKey shape (AC #5)', () => {
  it('exports collectiveReactionsKey as a function returning [collective, reactions, postId]', async () => {
    const mod = await import('../reactions')
    const key = mod.collectiveReactionsKey('post-abc')
    expect(key).toEqual(['collective', 'reactions', 'post-abc'])
  })

  it('collectiveReactionsKey with a different postId returns a unique tuple', async () => {
    const mod = await import('../reactions')
    expect(mod.collectiveReactionsKey('post-xyz')).toEqual(['collective', 'reactions', 'post-xyz'])
    expect(mod.collectiveReactionsKey('post-abc')).not.toEqual(mod.collectiveReactionsKey('post-xyz'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t1 — fetchPostReactions returns correct shape from a mixed reaction set
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-11 / t1 — fetchPostReactions with mixed reactions (AC #5, #18)', () => {
  it('aggregates counts for all reactions and userReactions only for current user', async () => {
    // Three reactions:
    //   - heart by current user (id: 'rxn-1')
    //   - heart by another user (id: 'rxn-2')  → heart count = 2
    //   - flame by another user (id: 'rxn-3')  → flame count = 1
    //   - sparkle with user_id: null (id: 'rxn-4') → sparkle count = 1, NOT in userReactions
    const mockData = [
      { id: 'rxn-1', user_id: 'user-current', kind: 'heart', post_id: 'post-1' },
      { id: 'rxn-2', user_id: 'user-other',   kind: 'heart', post_id: 'post-1' },
      { id: 'rxn-3', user_id: 'user-other',   kind: 'flame', post_id: 'post-1' },
      { id: 'rxn-4', user_id: null,            kind: 'sparkle', post_id: 'post-1' },
    ]
    eqMock.mockResolvedValueOnce({ data: mockData, error: null })
    selectMock.mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { fetchPostReactions } = await import('../reactions')
    const result = await fetchPostReactions('post-1', 'user-current')

    // counts include ALL rows (including anonymized)
    expect(result.counts.heart).toBe(2)
    expect(result.counts.flame).toBe(1)
    expect(result.counts.sparkle).toBe(1)
    expect(result.counts.leaf).toBe(0)
    expect(result.counts.wave).toBe(0)

    // userReactions: only current user's reactions; heart was reacted with 'rxn-1'
    expect(result.userReactions.heart).toBe('rxn-1')
    expect(result.userReactions.flame).toBeNull()
    expect(result.userReactions.sparkle).toBeNull()
    expect(result.userReactions.leaf).toBeNull()
    expect(result.userReactions.wave).toBeNull()
  })

  it('calls supabase.from("collective_reactions").select("id, user_id, kind").eq("post_id", postId)', async () => {
    eqMock.mockResolvedValueOnce({ data: [], error: null })
    selectMock.mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { fetchPostReactions } = await import('../reactions')
    await fetchPostReactions('post-123', 'user-current')

    expect(fromMock).toHaveBeenCalledWith('collective_reactions')
    expect(selectMock).toHaveBeenCalledWith('id, user_id, kind')
    expect(eqMock).toHaveBeenCalledWith('post_id', 'post-123')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t2 — Anonymized reactions (user_id IS NULL) counted but NOT in userReactions
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-11 / t2 — anonymized reactions excluded from userReactions (AC #5)', () => {
  it('anonymized reaction (user_id: null) increments counts but leaves userReactions null', async () => {
    const mockData = [
      { id: 'rxn-anon', user_id: null, kind: 'wave', post_id: 'post-2' },
    ]
    eqMock.mockResolvedValueOnce({ data: mockData, error: null })
    selectMock.mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { fetchPostReactions } = await import('../reactions')
    const result = await fetchPostReactions('post-2', 'user-current')

    expect(result.counts.wave).toBe(1)
    expect(result.userReactions.wave).toBeNull()
  })

  it('multiple anonymized reactions of same kind sum correctly in counts', async () => {
    const mockData = [
      { id: 'rxn-a1', user_id: null, kind: 'leaf', post_id: 'post-3' },
      { id: 'rxn-a2', user_id: null, kind: 'leaf', post_id: 'post-3' },
    ]
    eqMock.mockResolvedValueOnce({ data: mockData, error: null })
    selectMock.mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { fetchPostReactions } = await import('../reactions')
    const result = await fetchPostReactions('post-3', 'user-current')

    expect(result.counts.leaf).toBe(2)
    expect(result.userReactions.leaf).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t3 — Empty result yields all-zero counts and all-null userReactions
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-11 / t3 — empty result shape (AC #5)', () => {
  it('returns all-zero counts and all-null userReactions when data is []', async () => {
    eqMock.mockResolvedValueOnce({ data: [], error: null })
    selectMock.mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { fetchPostReactions } = await import('../reactions')
    const result = await fetchPostReactions('post-empty', 'user-current')

    expect(result.counts).toEqual({
      heart: 0,
      sparkle: 0,
      flame: 0,
      leaf: 0,
      wave: 0,
    })
    expect(result.userReactions).toEqual({
      heart: null,
      sparkle: null,
      flame: null,
      leaf: null,
      wave: null,
    })
  })

  it('returns all-zero counts when data is null (defensive default)', async () => {
    eqMock.mockResolvedValueOnce({ data: null, error: null })
    selectMock.mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { fetchPostReactions } = await import('../reactions')
    const result = await fetchPostReactions('post-null', 'user-current')

    expect(result.counts.heart).toBe(0)
    expect(result.userReactions.heart).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t4 — Supabase error re-throws for TanStack Query retry contract
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-11 / t4 — Supabase error re-throws (AC #5)', () => {
  it('throws when Supabase returns a PostgrestError-shaped error', async () => {
    const error = {
      message: 'permission denied',
      code: '42501',
      details: null,
      hint: null,
    }
    eqMock.mockResolvedValueOnce({ data: null, error })
    selectMock.mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { fetchPostReactions } = await import('../reactions')
    await expect(fetchPostReactions('post-err', 'user-current')).rejects.toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t5 — Boundary rule (D7): reactions.ts must NOT import @legendapp/state
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-11 / t5 — Boundary rule D7 (AC #16)', () => {
  it('reactions.ts exists on disk', () => {
    expect(existsSync(REACTIONS_PATH), 'reactions.ts must exist at ' + REACTIONS_PATH).toBe(true)
  })

  it('reactions.ts does NOT contain @legendapp/state import', () => {
    expect(existsSync(REACTIONS_PATH)).toBe(true)
    const src = readFileSync(REACTIONS_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state(?:\/[\w-]+(?:\/[\w-]+)?)?/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// usePostReactions hook config (AC #5)
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-11 / usePostReactions hook config (AC #5)', () => {
  it('passes queryKey === collectiveReactionsKey(postId) to useQuery', async () => {
    const { usePostReactions, collectiveReactionsKey } = await import('../reactions')
    usePostReactions('post-hook-test', 'user-current')
    expect(useQueryMock).toHaveBeenCalledTimes(1)
    const opts = useQueryMock.mock.calls[0][0]
    expect(opts.queryKey).toEqual(collectiveReactionsKey('post-hook-test'))
  })

  it('declares staleTime === 25_000', async () => {
    const { usePostReactions } = await import('../reactions')
    useQueryMock.mockReset()
    usePostReactions('post-stale', 'user-current')
    const opts = useQueryMock.mock.calls[0][0]
    expect(opts.staleTime).toBe(25_000)
  })

  it('queryFn calls fetchPostReactions', async () => {
    eqMock.mockResolvedValueOnce({ data: [], error: null })
    selectMock.mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { usePostReactions } = await import('../reactions')
    useQueryMock.mockReset()
    usePostReactions('post-fn', 'user-fn')

    const opts = useQueryMock.mock.calls[0][0]
    expect(typeof opts.queryFn).toBe('function')
    // Call the queryFn to verify it invokes the supabase chain
    await opts.queryFn()
    expect(fromMock).toHaveBeenCalledWith('collective_reactions')
  })
})
