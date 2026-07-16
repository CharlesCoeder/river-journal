/**
 * Red-phase unit tests for `state/collective/auditLog.ts`.
 *
 * Red-phase contract: every test in this file MUST fail until the target
 * module (`app/state/collective/auditLog.ts`) exists -- the whole file fails
 * at the top-level `import('../auditLog')` with a module-resolution error,
 * mirroring this package's established red-phase convention (see
 * `moderation.test.ts` / `yourPosts.test.ts`).
 *
 * Surface covered:
 *   - `auditLogKey` deep-equals ['moderation', 'audit'] (an as-const tuple
 *     sharing the ['moderation'] prefix used by the queue/mutation keys).
 *   - `PAGE_SIZE === 20`.
 *   - `fetchAuditLogPage(cursor)`: a direct `moderation_actions` SELECT,
 *     newest-first, PAGE_SIZE+1 look-ahead, `.lt('created_at', cursor)`
 *     applied only when cursor is non-null; computes `nextCursor` from the
 *     look-ahead idiom; INCLUDING the boundary case where the sliced-off
 *     look-ahead row shares its timestamp with the last visible row (the
 *     tie-at-cursor hazard the implementation comment must call out).
 *   - `useAuditLog()`: a `useInfiniteQuery` wrapper (queryKey, pageParam
 *     wiring, maxPages, calm cadence).
 *   - `usePostAdminDetail(targetPostId, enabled)`: a `useQuery` wrapper
 *     around the admin single-post RPC, first-row unwrapped.
 *   - `useTargetModerationHistory({ targetPostId, targetUserId, enabled })`:
 *     a `useQuery` wrapper around a direct, target-keyed `moderation_actions`
 *     SELECT.
 *
 * Mock strategy mirrors `moderation.test.ts` / `yourPosts.test.ts`: mock the
 * supabase client module and mock `@tanstack/react-query`'s `useQuery` /
 * `useInfiniteQuery` so hook config can be asserted without mounting React.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the supabase client at module-top. Path is computed from
// `state/collective/__tests__/` -> `utils/supabase`.
vi.mock('../../../utils/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}))

// Mock @tanstack/react-query so hook config can be asserted without
// mounting a React renderer / QueryClientProvider.
const useQueryMock = vi.fn()
const useInfiniteQueryMock = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: unknown) => useQueryMock(opts),
  useInfiniteQuery: (opts: unknown) => useInfiniteQueryMock(opts),
}))

// ─── Chainable supabase.from(...) query-builder mock ───────────────────────
// Every filter/order/limit method returns the same chain object (so any
// call order the implementation chooses still resolves), and the chain
// itself is thenable so `await` on the end of the chain resolves to the
// configured result -- mirrors how the real PostgREST query builder behaves.
function makeQueryChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'order', 'limit', 'lt', 'eq']) {
    chain[method] = vi.fn(() => chain)
  }
  // biome-ignore lint/suspicious/noThenProperty: the mock must be awaitable to stand in for a thenable Supabase query builder
  ;(chain as unknown as { then: unknown }).then = (
    resolve: (v: typeof result) => unknown,
    reject: (e: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject)
  return chain
}

beforeEach(() => {
  useQueryMock.mockReset()
  useInfiniteQueryMock.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('auditLogKey / PAGE_SIZE shape', () => {
  it('exports auditLogKey deep-equal to ["moderation", "audit"]', async () => {
    const mod = await import('../auditLog')
    expect(mod.auditLogKey).toEqual(['moderation', 'audit'])
  })

  it('auditLogKey shares the ["moderation"] prefix (invalidation-ready)', async () => {
    const mod = await import('../auditLog')
    expect(mod.auditLogKey[0]).toBe('moderation')
  })

  it('exports PAGE_SIZE === 20', async () => {
    const mod = await import('../auditLog')
    expect(mod.PAGE_SIZE).toBe(20)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('fetchAuditLogPage() query shape', () => {
  it('selects from moderation_actions, orders created_at descending, and requests PAGE_SIZE + 1 rows', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const chain = makeQueryChain({ data: [], error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReset()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain)

    const { fetchAuditLogPage, PAGE_SIZE } = await import('../auditLog')
    await fetchAuditLogPage(null)

    expect(supabase.from).toHaveBeenCalledWith('moderation_actions')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(PAGE_SIZE + 1)
  })

  it('does NOT chain .lt() when cursor is null (first page)', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const chain = makeQueryChain({ data: [], error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReset()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain)

    const { fetchAuditLogPage } = await import('../auditLog')
    await fetchAuditLogPage(null)

    expect(chain.lt).not.toHaveBeenCalled()
  })

  it('chains .lt("created_at", cursor) when a non-null cursor is supplied', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const chain = makeQueryChain({ data: [], error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReset()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain)

    const { fetchAuditLogPage } = await import('../auditLog')
    const cursor = '2026-07-01T12:00:00.000Z'
    await fetchAuditLogPage(cursor)

    expect(chain.lt).toHaveBeenCalledWith('created_at', cursor)
  })

  it('returns { items: [], nextCursor: null } when the SELECT resolves with data: []', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const chain = makeQueryChain({ data: [], error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReset()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain)

    const { fetchAuditLogPage } = await import('../auditLog')
    const page = await fetchAuditLogPage(null)

    expect(page).toEqual({ items: [], nextCursor: null })
  })

  it('returns { items: [], nextCursor: null } when the SELECT resolves with data: null (defensive default)', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const chain = makeQueryChain({ data: null, error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReset()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain)

    const { fetchAuditLogPage } = await import('../auditLog')
    const page = await fetchAuditLogPage(null)

    expect(page).toEqual({ items: [], nextCursor: null })
  })

  function makeRow(i: number, createdAt: string) {
    return {
      id: `action-${i}`,
      action_type: 'add_note',
      actor_user_id: 'actor-abc12345',
      target_post_id: null,
      target_user_id: 'target-abc12345',
      reason: null,
      note: `note-${i}`,
      created_at: createdAt,
      metadata: null,
    }
  }

  it("slices to PAGE_SIZE items and sets nextCursor to the last VISIBLE row's created_at when PAGE_SIZE + 1 rows come back", async () => {
    const { supabase } = await import('../../../utils/supabase')
    // Newest-first: row 0 is newest, row 20 is oldest (the look-ahead row).
    const rows = Array.from({ length: 21 }, (_, i) =>
      makeRow(i, `2026-07-01T00:00:${String(59 - i).padStart(2, '0')}.000Z`)
    )
    const chain = makeQueryChain({ data: rows, error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReset()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain)

    const { fetchAuditLogPage, PAGE_SIZE } = await import('../auditLog')
    const page = await fetchAuditLogPage(null)

    expect(page.items).toHaveLength(PAGE_SIZE)
    expect(page.items[0]!.id).toBe('action-0')
    expect(page.items[PAGE_SIZE - 1]!.id).toBe(`action-${PAGE_SIZE - 1}`)
    expect(page.nextCursor).toBe(rows[PAGE_SIZE - 1]!.created_at)
  })

  it('returns { items: rows, nextCursor: null } when exactly PAGE_SIZE rows come back (last page)', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRow(i, `2026-07-01T00:00:${String(59 - i).padStart(2, '0')}.000Z`)
    )
    const chain = makeQueryChain({ data: rows, error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReset()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain)

    const { fetchAuditLogPage } = await import('../auditLog')
    const page = await fetchAuditLogPage(null)

    expect(page.items).toHaveLength(20)
    expect(page.nextCursor).toBeNull()
  })

  it("boundary hazard: when the sliced-off look-ahead row TIES the last visible row's created_at, nextCursor still equals that shared timestamp (documents the strictly-less-than tie-drop the implementation comments must warn about)", async () => {
    const { supabase } = await import('../../../utils/supabase')
    const tieAt = '2026-07-01T00:00:30.000Z'
    const rows = Array.from({ length: 21 }, (_, i) => {
      // Rows 19 and 20 (the last visible row and the look-ahead row) share
      // an identical created_at -- the tie-at-cursor boundary case.
      if (i === 19 || i === 20) return makeRow(i, tieAt)
      return makeRow(i, `2026-07-01T00:00:${String(59 - i).padStart(2, '0')}.000Z`)
    })
    const chain = makeQueryChain({ data: rows, error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReset()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain)

    const { fetchAuditLogPage, PAGE_SIZE } = await import('../auditLog')
    const page = await fetchAuditLogPage(null)

    // The tied look-ahead row (index 20, action-20) is sliced off as "has
    // more", and nextCursor is the last VISIBLE row's created_at -- which is
    // the same instant as the dropped row. A subsequent `.lt('created_at',
    // nextCursor)` fetch would therefore skip the tied row entirely (it is
    // neither on this page nor strictly-less-than the cursor on the next).
    expect(page.items).toHaveLength(PAGE_SIZE)
    expect(page.nextCursor).toBe(tieAt)
    expect(page.items[PAGE_SIZE - 1]!.created_at).toBe(tieAt)
  })

  it('throws when the SELECT resolves with a PostgrestError-shaped error', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const error = { message: 'not authorized', code: '42501', details: null, hint: null }
    const chain = makeQueryChain({ data: null, error })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReset()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain)

    const { fetchAuditLogPage } = await import('../auditLog')
    await expect(fetchAuditLogPage(null)).rejects.toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('useAuditLog() useInfiniteQuery config', () => {
  it('passes queryKey === auditLogKey', async () => {
    const { useAuditLog, auditLogKey } = await import('../auditLog')
    useAuditLog()
    expect(useInfiniteQueryMock).toHaveBeenCalledTimes(1)
    const opts = useInfiniteQueryMock.mock.calls[0]![0]
    expect(opts.queryKey).toEqual(auditLogKey)
  })

  it('declares initialPageParam === null', async () => {
    const { useAuditLog } = await import('../auditLog')
    useInfiniteQueryMock.mockReset()
    useAuditLog()
    const opts = useInfiniteQueryMock.mock.calls[0]![0]
    expect(opts.initialPageParam).toBeNull()
  })

  it('getNextPageParam returns lastPage.nextCursor', async () => {
    const { useAuditLog } = await import('../auditLog')
    useInfiniteQueryMock.mockReset()
    useAuditLog()
    const opts = useInfiniteQueryMock.mock.calls[0]![0]
    expect(typeof opts.getNextPageParam).toBe('function')
    expect(opts.getNextPageParam({ items: [], nextCursor: 'abc' })).toBe('abc')
    expect(opts.getNextPageParam({ items: [], nextCursor: null })).toBeNull()
  })

  it('declares maxPages === 5 (5 * PAGE_SIZE = 100-row in-memory cap)', async () => {
    const { useAuditLog } = await import('../auditLog')
    useInfiniteQueryMock.mockReset()
    useAuditLog()
    const opts = useInfiniteQueryMock.mock.calls[0]![0]
    expect(opts.maxPages).toBe(5)
  })

  it('declares refetchInterval === 30_000 and staleTime === 25_000 (calm cadence; staleTime < refetchInterval)', async () => {
    const { useAuditLog } = await import('../auditLog')
    useInfiniteQueryMock.mockReset()
    useAuditLog()
    const opts = useInfiniteQueryMock.mock.calls[0]![0]
    expect(opts.refetchInterval).toBe(30_000)
    expect(opts.staleTime).toBe(25_000)
    expect(opts.staleTime).toBeLessThan(opts.refetchInterval as number)
  })

  it('declares refetchOnWindowFocus === true', async () => {
    const { useAuditLog } = await import('../auditLog')
    useInfiniteQueryMock.mockReset()
    useAuditLog()
    const opts = useInfiniteQueryMock.mock.calls[0]![0]
    expect(opts.refetchOnWindowFocus).toBe(true)
  })

  it('queryFn forwards pageParam to fetchAuditLogPage as cursor', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const chain = makeQueryChain({ data: [], error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReset()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain)

    const { useAuditLog } = await import('../auditLog')
    useInfiniteQueryMock.mockReset()
    useAuditLog()
    const opts = useInfiniteQueryMock.mock.calls[0]![0]

    const cursor = '2026-07-01T12:00:00.000Z'
    await opts.queryFn({ pageParam: cursor })

    expect(chain.lt).toHaveBeenCalledWith('created_at', cursor)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('usePostAdminDetail() useQuery config', () => {
  it('keys the query ["moderation", "audit", "postDetail", targetPostId]', async () => {
    const { usePostAdminDetail } = await import('../auditLog')
    useQueryMock.mockReset()
    usePostAdminDetail('post-1', true)
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.queryKey).toEqual(['moderation', 'audit', 'postDetail', 'post-1'])
  })

  it('is enabled only when enabled=true AND targetPostId is non-null', async () => {
    const { usePostAdminDetail } = await import('../auditLog')

    useQueryMock.mockReset()
    usePostAdminDetail('post-1', true)
    expect(useQueryMock.mock.calls[0]![0].enabled).toBe(true)

    useQueryMock.mockReset()
    usePostAdminDetail(null, true)
    expect(useQueryMock.mock.calls[0]![0].enabled).toBe(false)

    useQueryMock.mockReset()
    usePostAdminDetail('post-1', false)
    expect(useQueryMock.mock.calls[0]![0].enabled).toBe(false)
  })

  it('queryFn calls supabase.rpc("collective_post_admin_detail", { target_post_id })', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()
    rpc.mockResolvedValueOnce({ data: [], error: null })

    const { usePostAdminDetail } = await import('../auditLog')
    useQueryMock.mockReset()
    usePostAdminDetail('post-1', true)
    const opts = useQueryMock.mock.calls[0]![0]
    await opts.queryFn()

    expect(rpc).toHaveBeenCalledWith('collective_post_admin_detail', { target_post_id: 'post-1' })
  })

  it('queryFn unwraps the first row of the RPC result', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()
    const row = { post_id: 'post-1', author_user_id: 'author-1', title: 't', body: 'b' }
    rpc.mockResolvedValueOnce({ data: [row], error: null })

    const { usePostAdminDetail } = await import('../auditLog')
    useQueryMock.mockReset()
    usePostAdminDetail('post-1', true)
    const opts = useQueryMock.mock.calls[0]![0]
    const result = await opts.queryFn()

    expect(result).toEqual(row)
  })

  it('queryFn resolves to null when the RPC returns zero rows (post no longer available)', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()
    rpc.mockResolvedValueOnce({ data: [], error: null })

    const { usePostAdminDetail } = await import('../auditLog')
    useQueryMock.mockReset()
    usePostAdminDetail('post-1', true)
    const opts = useQueryMock.mock.calls[0]![0]
    const result = await opts.queryFn()

    expect(result).toBeNull()
  })

  it('queryFn throws when the RPC resolves with a PostgrestError-shaped error', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()
    const error = { message: 'not authorized', code: '42501', details: null, hint: null }
    rpc.mockResolvedValueOnce({ data: null, error })

    const { usePostAdminDetail } = await import('../auditLog')
    useQueryMock.mockReset()
    usePostAdminDetail('post-1', true)
    const opts = useQueryMock.mock.calls[0]![0]

    await expect(opts.queryFn()).rejects.toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('useTargetModerationHistory() useQuery config', () => {
  it('keys the query ["moderation", "audit", "history", targetPostId] when targetPostId is set', async () => {
    const { useTargetModerationHistory } = await import('../auditLog')
    useQueryMock.mockReset()
    useTargetModerationHistory({ targetPostId: 'post-1', targetUserId: null, enabled: true })
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.queryKey).toEqual(['moderation', 'audit', 'history', 'post-1'])
  })

  it('keys the query ["moderation", "audit", "history", targetUserId] when only targetUserId is set (user-only row)', async () => {
    const { useTargetModerationHistory } = await import('../auditLog')
    useQueryMock.mockReset()
    useTargetModerationHistory({ targetPostId: null, targetUserId: 'user-1', enabled: true })
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.queryKey).toEqual(['moderation', 'audit', 'history', 'user-1'])
  })

  it('passes enabled through unchanged', async () => {
    const { useTargetModerationHistory } = await import('../auditLog')
    useQueryMock.mockReset()
    useTargetModerationHistory({ targetPostId: 'post-1', targetUserId: null, enabled: false })
    expect(useQueryMock.mock.calls[0]![0].enabled).toBe(false)
  })

  it('queryFn filters by target_post_id and orders created_at descending when targetPostId is set', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const chain = makeQueryChain({ data: [], error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReset()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain)

    const { useTargetModerationHistory } = await import('../auditLog')
    useQueryMock.mockReset()
    useTargetModerationHistory({ targetPostId: 'post-1', targetUserId: null, enabled: true })
    const opts = useQueryMock.mock.calls[0]![0]
    await opts.queryFn()

    expect(supabase.from).toHaveBeenCalledWith('moderation_actions')
    expect(chain.eq).toHaveBeenCalledWith('target_post_id', 'post-1')
    expect(chain.eq).not.toHaveBeenCalledWith('target_user_id', expect.anything())
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('queryFn filters by target_user_id (not target_post_id) for a user-only row', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const chain = makeQueryChain({ data: [], error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReset()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain)

    const { useTargetModerationHistory } = await import('../auditLog')
    useQueryMock.mockReset()
    useTargetModerationHistory({ targetPostId: null, targetUserId: 'user-1', enabled: true })
    const opts = useQueryMock.mock.calls[0]![0]
    await opts.queryFn()

    expect(chain.eq).toHaveBeenCalledWith('target_user_id', 'user-1')
    expect(chain.eq).not.toHaveBeenCalledWith('target_post_id', expect.anything())
  })

  it('queryFn returns [] on a null data payload (defensive default)', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const chain = makeQueryChain({ data: null, error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReset()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain)

    const { useTargetModerationHistory } = await import('../auditLog')
    useQueryMock.mockReset()
    useTargetModerationHistory({ targetPostId: 'post-1', targetUserId: null, enabled: true })
    const opts = useQueryMock.mock.calls[0]![0]
    const result = await opts.queryFn()

    expect(result).toEqual([])
  })

  it('queryFn throws when the SELECT resolves with a PostgrestError-shaped error', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const error = { message: 'not authorized', code: '42501', details: null, hint: null }
    const chain = makeQueryChain({ data: null, error })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReset()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain)

    const { useTargetModerationHistory } = await import('../auditLog')
    useQueryMock.mockReset()
    useTargetModerationHistory({ targetPostId: 'post-1', targetUserId: null, enabled: true })
    const opts = useQueryMock.mock.calls[0]![0]

    await expect(opts.queryFn()).rejects.toBeDefined()
  })
})
