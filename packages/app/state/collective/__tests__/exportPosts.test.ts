/**
 * Red-phase tests for `state/collective/exportPosts.ts` — the cursor-paginated
 * read of the calling user's OWN Collective posts for data-portability export,
 * including moderator-removed and self-deleted rows (with body + title) that
 * the ordinary feed/`collective_your_posts_page` reads deliberately exclude.
 *
 * None of `../exportPosts` exists yet; every test below MUST fail
 * (module-resolution error) until the module is built, and pass afterward.
 *
 * Pinned contract (mirrors `state/collective/yourPosts.ts`'s look-ahead
 * cursor idiom, extended for a full-history, one-shot export loop):
 *   - PAGE_SIZE: number
 *   - CollectiveExportRow — { id, user_id, parent_post_id, title, body,
 *     created_at, is_removed, is_user_deleted, user_deleted_at,
 *     removed_reason, removed_at, reaction_count, descendant_count }
 *   - fetchExportPostsPage(cursor: string | null): Promise<{ items: CollectiveExportRow[]; nextCursor: string | null }>
 *     calls supabase.rpc('collective_export_page', { cursor, page_size: PAGE_SIZE + 1 })
 *   - fetchAllExportPosts(onProgress?: (count: number) => void, deps?: {
 *       fetchPage?: (cursor: string | null) => Promise<{ items: CollectiveExportRow[]; nextCursor: string | null }>
 *     }): Promise<CollectiveExportRow[]>
 *     loops from cursor = null until nextCursor === null, concatenating
 *     pages and calling onProgress(runningCount) after each page. Defaults
 *     to the real `fetchExportPostsPage` when `deps.fetchPage` is omitted,
 *     but the injected `deps.fetchPage` path must never touch supabase —
 *     that's what keeps `utils/exportCollectivePosts.ts`'s orchestrator
 *     supabase-free and unit-testable with fixtures.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the supabase client at module-top so `fetchExportPostsPage`'s
// `await supabase.rpc(...)` call is intercepted. Relative path computed from
// `state/collective/__tests__/` -> `utils/supabase`, mirroring yourPosts.test.ts.
vi.mock('../../../utils/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function makeExportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    user_id: 'user-A',
    parent_post_id: null,
    title: 'A post',
    body: 'body text',
    created_at: '2026-07-10T00:00:00.000Z',
    is_removed: false,
    is_user_deleted: false,
    user_deleted_at: null,
    removed_reason: null,
    removed_at: null,
    reaction_count: 0,
    descendant_count: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// PAGE_SIZE
// ---------------------------------------------------------------------------

describe('PAGE_SIZE', () => {
  it('is a positive integer', async () => {
    const mod = await import('../exportPosts')
    expect(Number.isInteger(mod.PAGE_SIZE)).toBe(true)
    expect(mod.PAGE_SIZE).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// fetchExportPostsPage — RPC call shape + look-ahead pagination
// ---------------------------------------------------------------------------

describe('fetchExportPostsPage', () => {
  it('calls supabase.rpc("collective_export_page", { cursor: null, cursor_id: null, page_size: PAGE_SIZE + 1 }) when invoked with a null cursor', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockResolvedValueOnce({ data: [], error: null })

    const { fetchExportPostsPage, PAGE_SIZE } = await import('../exportPosts')
    await fetchExportPostsPage(null)

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('collective_export_page', {
      cursor: null,
      cursor_id: null,
      page_size: PAGE_SIZE + 1,
    })
  })

  it('splits a non-null composite cursor into the RPC cursor / cursor_id args', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockResolvedValueOnce({ data: [], error: null })

    const { fetchExportPostsPage, PAGE_SIZE } = await import('../exportPosts')
    const cursor = { createdAt: '2026-05-01T12:00:00.000Z', id: 'post-boundary' }
    await fetchExportPostsPage(cursor)

    expect(rpc).toHaveBeenCalledWith('collective_export_page', {
      cursor: cursor.createdAt,
      cursor_id: cursor.id,
      page_size: PAGE_SIZE + 1,
    })
  })

  it('returns { items: [], nextCursor: null } when RPC returns data: []', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockResolvedValueOnce({ data: [], error: null })

    const { fetchExportPostsPage } = await import('../exportPosts')
    const page = await fetchExportPostsPage(null)

    expect(page).toEqual({ items: [], nextCursor: null })
  })

  it('returns { items: [], nextCursor: null } when RPC returns data: null (defensive default)', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockResolvedValueOnce({ data: null, error: null })

    const { fetchExportPostsPage } = await import('../exportPosts')
    const page = await fetchExportPostsPage(null)

    expect(page).toEqual({ items: [], nextCursor: null })
  })

  it('truncates to PAGE_SIZE rows and sets nextCursor from the last visible row when RPC returns PAGE_SIZE + 1 rows', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    const { PAGE_SIZE } = await import('../exportPosts')

    const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, i) =>
      makeExportRow({
        id: `id-${i}`,
        created_at: `2026-05-01T00:00:${String(PAGE_SIZE + 1 - i).padStart(2, '0')}.000Z`,
      })
    )
    rpc.mockResolvedValueOnce({ data: rows, error: null })

    const { fetchExportPostsPage } = await import('../exportPosts')
    const page = await fetchExportPostsPage(null)

    expect(page.items).toHaveLength(PAGE_SIZE)
    expect(page.items[0]!.id).toBe('id-0')
    expect(page.items[PAGE_SIZE - 1]!.id).toBe(`id-${PAGE_SIZE - 1}`)
    expect(page.nextCursor).toEqual({
      createdAt: rows[PAGE_SIZE - 1]!.created_at,
      id: rows[PAGE_SIZE - 1]!.id,
    })
  })

  it('returns { items: rows, nextCursor: null } when RPC returns exactly PAGE_SIZE rows (last page)', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    const { PAGE_SIZE } = await import('../exportPosts')

    const rows = Array.from({ length: PAGE_SIZE }, (_, i) =>
      makeExportRow({
        id: `id-${i}`,
        created_at: `2026-05-01T00:00:${String(PAGE_SIZE - i).padStart(2, '0')}.000Z`,
      })
    )
    rpc.mockResolvedValueOnce({ data: rows, error: null })

    const { fetchExportPostsPage } = await import('../exportPosts')
    const page = await fetchExportPostsPage(null)

    expect(page.items).toHaveLength(PAGE_SIZE)
    expect(page.nextCursor).toBeNull()
  })

  it('throws when RPC returns a PostgrestError-shaped error (e.g. unauthenticated 42501)', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    const error = { message: 'authentication required', code: '42501', details: null, hint: null }
    rpc.mockResolvedValueOnce({ data: null, error })

    const { fetchExportPostsPage } = await import('../exportPosts')
    await expect(fetchExportPostsPage(null)).rejects.toBeDefined()
  })

  it('passes through moderator-removed and self-deleted rows unchanged — including body and title (the export-specific RPC, unlike collective_your_posts_page, must not filter them out client-side)', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    const rows = [
      makeExportRow({
        id: 'removed-post',
        is_removed: true,
        removed_reason: 'spam',
        removed_at: '2026-07-01T00:00:00.000Z',
        body: 'original removed body',
        title: 'original removed title',
      }),
      makeExportRow({
        id: 'deleted-post',
        is_user_deleted: true,
        user_deleted_at: '2026-07-02T00:00:00.000Z',
        body: '[deleted]',
        title: '[deleted]',
      }),
    ]
    rpc.mockResolvedValueOnce({ data: rows, error: null })

    const { fetchExportPostsPage } = await import('../exportPosts')
    const page = await fetchExportPostsPage(null)

    expect(page.items).toHaveLength(2)
    expect(page.items[0]).toMatchObject({
      id: 'removed-post',
      is_removed: true,
      removed_reason: 'spam',
      body: 'original removed body',
      title: 'original removed title',
    })
    expect(page.items[1]).toMatchObject({
      id: 'deleted-post',
      is_user_deleted: true,
      user_deleted_at: '2026-07-02T00:00:00.000Z',
      body: '[deleted]',
    })
  })
})

// ---------------------------------------------------------------------------
// fetchAllExportPosts — one-shot full-history loop
// ---------------------------------------------------------------------------

describe('fetchAllExportPosts', () => {
  it('returns an empty array without calling onProgress when the fake page-fetcher has nothing to return', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [], nextCursor: null })
    const onProgress = vi.fn()

    const { fetchAllExportPosts } = await import('../exportPosts')
    const rows = await fetchAllExportPosts(onProgress, { fetchPage })

    expect(rows).toEqual([])
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage).toHaveBeenCalledWith(null)
  })

  it('resolves a single-page result and reports the running count exactly once', async () => {
    const rows = [makeExportRow({ id: 'a' }), makeExportRow({ id: 'b' })]
    const fetchPage = vi.fn().mockResolvedValue({ items: rows, nextCursor: null })
    const onProgress = vi.fn()

    const { fetchAllExportPosts } = await import('../exportPosts')
    const result = await fetchAllExportPosts(onProgress, { fetchPage })

    expect(result).toEqual(rows)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith(2)
  })

  it('loops across multiple pages until nextCursor is null, concatenating rows in order and reporting a monotonically increasing running count', async () => {
    const page1 = [makeExportRow({ id: 'a' }), makeExportRow({ id: 'b' })]
    const page2 = [makeExportRow({ id: 'c' })]
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: page1, nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: page2, nextCursor: null })
    const progressCalls: number[] = []
    const onProgress = (count: number) => progressCalls.push(count)

    const { fetchAllExportPosts } = await import('../exportPosts')
    const result = await fetchAllExportPosts(onProgress, { fetchPage })

    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage).toHaveBeenNthCalledWith(1, null)
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'cursor-1')
    expect(progressCalls).toEqual([2, 3])
  })

  it("does not cap the number of pages fetched (unlike the UI hook's maxPages budget) — covers every post across many pages", async () => {
    const totalPages = 8
    const fetchPage = vi.fn().mockImplementation(async (cursor: string | null) => {
      const pageIndex = cursor === null ? 0 : Number(cursor)
      const isLast = pageIndex === totalPages - 1
      return {
        items: [makeExportRow({ id: `page-${pageIndex}` })],
        nextCursor: isLast ? null : String(pageIndex + 1),
      }
    })

    const { fetchAllExportPosts } = await import('../exportPosts')
    const result = await fetchAllExportPosts(undefined, { fetchPage })

    expect(fetchPage).toHaveBeenCalledTimes(totalPages)
    expect(result).toHaveLength(totalPages)
  })

  it('never touches supabase.rpc when a fake page-fetcher is injected', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    const fetchPage = vi.fn().mockResolvedValue({ items: [], nextCursor: null })

    const { fetchAllExportPosts } = await import('../exportPosts')
    await fetchAllExportPosts(undefined, { fetchPage })

    expect(rpc).not.toHaveBeenCalled()
  })

  it('is safely callable with no arguments at all, and falls through to the real fetchExportPostsPage (supabase-backed) when no fetchPage is injected', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockResolvedValueOnce({ data: [], error: null })

    const { fetchAllExportPosts } = await import('../exportPosts')
    const result = await fetchAllExportPosts()

    expect(result).toEqual([])
    expect(rpc).toHaveBeenCalledWith('collective_export_page', expect.any(Object))
  })
})
