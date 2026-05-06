/**
 * Story 3-5 — TDD red-phase unit tests for `state/collective/yourPosts.ts`.
 *
 * These tests MUST fail before Story 3-5 is implemented (the target module
 * does not exist yet) and pass after.
 *
 * Surface covered (AC #10, #11, #12, #13, #17):
 *   - `yourPostsKey` deep-equals ['collective', 'yourPosts'] (and is the
 *     literal-narrowed `as const` tuple).
 *   - `PAGE_SIZE === 20` (regression sentinel for the NFR31 100-row budget:
 *     PAGE_SIZE * maxPages = 20 * 5 = 100).
 *   - `fetchYourPostsPage(cursor)` calls `supabase.rpc('collective_your_posts_page', ...)`
 *     with `{ cursor, page_size: PAGE_SIZE + 1 }` (the look-ahead idiom).
 *   - Empty rows -> { items: [], nextCursor: null }.
 *   - 21 rows (PAGE_SIZE + 1 -- has more) -> items.slice(0, 20),
 *     nextCursor === rows[19].created_at.
 *   - Exactly 20 rows -> { items: rows, nextCursor: null } (last page).
 *   - PostgrestError-shaped error -> throws.
 *   - `useYourPosts()` hook config (queryKey, initialPageParam, getNextPageParam,
 *     maxPages, refetchInterval, staleTime) -- inspected via the v5
 *     `useInfiniteQuery` mock so we don't need a React renderer.
 *
 * Note: The hook's runtime behaviour under React (mounting, suspense, refetch)
 * is intentionally NOT covered here -- Story 3-2's queryClient.test.ts
 * precedent stops short of React rendering. Story 3-14 (YourPostsScreen UI)
 * is where rendering tests will land.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the supabase client at module-top so `fetchYourPostsPage`'s
// `await supabase.rpc(...)` call is intercepted. The relative path is
// computed from `state/collective/__tests__/` -> `utils/supabase`:
// ../ (out of __tests__) ../ (out of collective) ../ (out of state)
// utils/supabase.
vi.mock('../../../utils/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

// Mock @tanstack/react-query so we can assert the hook's config object
// without having to mount a React renderer / QueryClientProvider. The mock
// captures the options passed to `useInfiniteQuery` for inspection.
const useInfiniteQueryMock = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: (opts: unknown) => useInfiniteQueryMock(opts),
}))

beforeEach(() => {
  useInfiniteQueryMock.mockReset()
})

describe('Story 3-5 / yourPostsKey shape (AC #10)', () => {
  it('exports yourPostsKey deep-equal to ["collective", "yourPosts"]', async () => {
    const mod = await import('../yourPosts')
    expect(mod.yourPostsKey).toEqual(['collective', 'yourPosts'])
  })

  it('yourPostsKey is a 2-tuple (length === 2)', async () => {
    const mod = await import('../yourPosts')
    expect(mod.yourPostsKey).toHaveLength(2)
  })
})

describe('Story 3-5 / PAGE_SIZE constant (AC #11)', () => {
  it('exports PAGE_SIZE === 20 (NFR31 100-row budget regression sentinel)', async () => {
    const mod = await import('../yourPosts')
    expect(mod.PAGE_SIZE).toBe(20)
  })
})

describe('Story 3-5 / fetchYourPostsPage RPC call shape (AC #12)', () => {
  it('calls supabase.rpc with name "collective_your_posts_page" and { cursor: null, page_size: 21 } when invoked with cursor: null', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockResolvedValueOnce({ data: [], error: null })

    const { fetchYourPostsPage } = await import('../yourPosts')
    await fetchYourPostsPage(null)

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('collective_your_posts_page', {
      cursor: null,
      page_size: 21,
    })
  })

  it('forwards a non-null ISO cursor unchanged in the RPC args', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()
    rpc.mockResolvedValueOnce({ data: [], error: null })

    const { fetchYourPostsPage } = await import('../yourPosts')
    const cursor = '2026-05-01T12:00:00.000Z'
    await fetchYourPostsPage(cursor)

    expect(rpc).toHaveBeenCalledWith('collective_your_posts_page', {
      cursor,
      page_size: 21,
    })
  })

  it('returns { items: [], nextCursor: null } when RPC returns data: []', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()
    rpc.mockResolvedValueOnce({ data: [], error: null })

    const { fetchYourPostsPage } = await import('../yourPosts')
    const page = await fetchYourPostsPage(null)

    expect(page).toEqual({ items: [], nextCursor: null })
  })

  it('returns { items: [], nextCursor: null } when RPC returns data: null (defensive default)', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()
    rpc.mockResolvedValueOnce({ data: null, error: null })

    const { fetchYourPostsPage } = await import('../yourPosts')
    const page = await fetchYourPostsPage(null)

    expect(page).toEqual({ items: [], nextCursor: null })
  })

  it('truncates to PAGE_SIZE rows + sets nextCursor when RPC returns PAGE_SIZE+1 rows', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()

    // Seed 21 rows -- look-ahead pattern: drop the last and use row[19].created_at
    // (index 19 is the LAST row of the visible page, since rows are sliced
    // [0, 20) and the user's NEXT request should fetch posts strictly OLDER
    // than that boundary).
    const rows = Array.from({ length: 21 }, (_, i) => ({
      id: `id-${i}`,
      user_id: 'user-A',
      parent_post_id: null,
      body: `body-${i}`,
      created_at: `2026-05-01T00:00:${String(21 - i).padStart(2, '0')}.000Z`,
      is_removed: false,
      is_user_deleted: false,
      user_deleted_at: null,
      reaction_count: 0,
      descendant_count: 0,
      tenure_tier: null,
      mode: 'full',
    }))
    rpc.mockResolvedValueOnce({ data: rows, error: null })

    const { fetchYourPostsPage, PAGE_SIZE } = await import('../yourPosts')
    const page = await fetchYourPostsPage(null)

    expect(page.items).toHaveLength(PAGE_SIZE)
    expect(page.items[0].id).toBe('id-0')
    expect(page.items[PAGE_SIZE - 1].id).toBe(`id-${PAGE_SIZE - 1}`)
    expect(page.nextCursor).toBe(rows[PAGE_SIZE - 1].created_at)
  })

  it('returns { items: rows, nextCursor: null } when RPC returns exactly PAGE_SIZE rows (last page)', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()

    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `id-${i}`,
      user_id: 'user-A',
      parent_post_id: null,
      body: `body-${i}`,
      created_at: `2026-05-01T00:00:${String(20 - i).padStart(2, '0')}.000Z`,
      is_removed: false,
      is_user_deleted: false,
      user_deleted_at: null,
      reaction_count: 0,
      descendant_count: 0,
      tenure_tier: null,
      mode: 'full',
    }))
    rpc.mockResolvedValueOnce({ data: rows, error: null })

    const { fetchYourPostsPage } = await import('../yourPosts')
    const page = await fetchYourPostsPage(null)

    expect(page.items).toHaveLength(20)
    expect(page.nextCursor).toBeNull()
  })

  it('throws when RPC returns a PostgrestError-shaped error', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()
    const error = {
      message: 'authentication required',
      code: '42501',
      details: null,
      hint: null,
    }
    rpc.mockResolvedValueOnce({ data: null, error })

    const { fetchYourPostsPage } = await import('../yourPosts')
    await expect(fetchYourPostsPage(null)).rejects.toBeDefined()
  })

  it('returns mode === "full" passthrough on every item (RPC always returns full for own posts)', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()
    const rows = [
      {
        id: 'id-0',
        user_id: 'user-A',
        parent_post_id: null,
        body: 'b',
        created_at: '2026-05-01T00:00:00.000Z',
        is_removed: false,
        is_user_deleted: false,
        user_deleted_at: null,
        reaction_count: 0,
        descendant_count: 0,
        tenure_tier: null,
        mode: 'full',
      },
    ]
    rpc.mockResolvedValueOnce({ data: rows, error: null })

    const { fetchYourPostsPage } = await import('../yourPosts')
    const page = await fetchYourPostsPage(null)

    expect(page.items[0].mode).toBe('full')
  })
})

describe('Story 3-5 / useYourPosts() useInfiniteQuery config (AC #13)', () => {
  it('passes queryKey === yourPostsKey to useInfiniteQuery', async () => {
    const { useYourPosts, yourPostsKey } = await import('../yourPosts')
    useYourPosts()
    expect(useInfiniteQueryMock).toHaveBeenCalledTimes(1)
    const opts = useInfiniteQueryMock.mock.calls[0][0]
    expect(opts.queryKey).toEqual(yourPostsKey)
  })

  it('declares initialPageParam === null', async () => {
    const { useYourPosts } = await import('../yourPosts')
    useInfiniteQueryMock.mockReset()
    useYourPosts()
    const opts = useInfiniteQueryMock.mock.calls[0][0]
    expect(opts.initialPageParam).toBeNull()
  })

  it('getNextPageParam returns lastPage.nextCursor', async () => {
    const { useYourPosts } = await import('../yourPosts')
    useInfiniteQueryMock.mockReset()
    useYourPosts()
    const opts = useInfiniteQueryMock.mock.calls[0][0]
    expect(typeof opts.getNextPageParam).toBe('function')
    expect(opts.getNextPageParam({ items: [], nextCursor: 'abc' })).toBe('abc')
    expect(opts.getNextPageParam({ items: [], nextCursor: null })).toBeNull()
  })

  it('declares maxPages === 5 (NFR31: 5 * PAGE_SIZE = 100 in-memory cap)', async () => {
    const { useYourPosts } = await import('../yourPosts')
    useInfiniteQueryMock.mockReset()
    useYourPosts()
    const opts = useInfiniteQueryMock.mock.calls[0][0]
    expect(opts.maxPages).toBe(5)
  })

  it('declares refetchInterval === 30_000 and staleTime === 25_000 (calm-realtime cadence; staleTime < refetchInterval)', async () => {
    const { useYourPosts } = await import('../yourPosts')
    useInfiniteQueryMock.mockReset()
    useYourPosts()
    const opts = useInfiniteQueryMock.mock.calls[0][0]
    expect(opts.refetchInterval).toBe(30_000)
    expect(opts.staleTime).toBe(25_000)
    // Sanity: the calm-realtime invariant.
    expect(opts.staleTime).toBeLessThan(opts.refetchInterval as number)
  })

  it('refetchOnWindowFocus === true', async () => {
    const { useYourPosts } = await import('../yourPosts')
    useInfiniteQueryMock.mockReset()
    useYourPosts()
    const opts = useInfiniteQueryMock.mock.calls[0][0]
    expect(opts.refetchOnWindowFocus).toBe(true)
  })

  it('queryFn forwards pageParam to fetchYourPostsPage as cursor', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()
    rpc.mockResolvedValueOnce({ data: [], error: null })

    const { useYourPosts } = await import('../yourPosts')
    useInfiniteQueryMock.mockReset()
    useYourPosts()
    const opts = useInfiniteQueryMock.mock.calls[0][0]

    const cursor = '2026-05-01T12:00:00.000Z'
    await opts.queryFn({ pageParam: cursor })

    expect(rpc).toHaveBeenCalledWith('collective_your_posts_page', {
      cursor,
      page_size: 21,
    })
  })
})
