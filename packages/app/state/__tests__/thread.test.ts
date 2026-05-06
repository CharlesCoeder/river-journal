// @vitest-environment happy-dom
/**
 * Story 3-4 — TDD red-phase integration tests for `state/collective/thread.ts`
 * (the `useThread(postId, { role })` hook + `fetchThreadPage` pure function).
 *
 * These tests MUST fail before Story 3-4 is implemented and pass after.
 *
 * Surface covered:
 *   - AC #1, #2: module exports (PAGE_SIZE, collectiveThreadKey, fetchThreadPage,
 *     useThread, ThreadPageResult, Post type re-export).
 *   - AC #3, #4: `fetchThreadPage` RPC call shape, hasMore detection, preview-mode
 *     unconditional `nextCursor: null`, preview-row client-side clamp to 3,
 *     empty-result default mode 'full', error path re-throw.
 *   - AC #5: useInfiniteQuery config (maxPages: 5, refetchInterval: 30_000,
 *     staleTime: 25_000, refetchOnWindowFocus: true, role-based gcTime).
 *   - AC #7: Preview gate (4 returned rows clamped to 3, nextCursor null).
 *   - AC #8: Streak-cross-500 invalidation flows transitively through
 *     ['collective'] prefix; thread.ts itself does NOT add an observe block.
 *   - AC #11: collectiveThreadKey shape `['collective', 'thread', postId]`.
 *   - AC #15: `Post` type structural parity with feed.ts (compile-time).
 *
 * Note: thread.ts MUST NOT import @legendapp/state — that grep regression is
 * covered by `boundary-rule.test.ts` (extended with 'collective/thread.ts'
 * by this story per AC #11). This file does NOT duplicate that grep.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'

// ─── Mock supabase BEFORE importing the SUT (thread.ts) ──────────────────────
// `thread.ts` imports `supabase` from 'app/utils/supabase' at module load.
// We replace the module with a stub whose `rpc` is a vitest mock fn.
vi.mock('app/utils/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

// SUT — import after the vi.mock call so the mock is active.
import {
  PAGE_SIZE,
  collectiveThreadKey,
  fetchThreadPage,
  useThread,
} from 'app/state/collective/thread'
import { supabase } from 'app/utils/supabase'

const rpcMock = supabase.rpc as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  rpcMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<Record<string, unknown>> & { id: string; created_at: string }) {
  return {
    id: overrides.id,
    user_id: 'user-x',
    parent_post_id: 'post-A',
    body: 'hello',
    created_at: overrides.created_at,
    is_removed: false,
    is_user_deleted: false,
    user_deleted_at: null,
    mode: 'full',
    ...overrides,
  }
}

function makeRows(n: number, mode: 'full' | 'preview' = 'full') {
  return Array.from({ length: n }, (_, i) =>
    makeRow({
      id: `reply-${i + 1}`,
      created_at: `2026-05-04T12:00:${String(i).padStart(2, '0')}Z`,
      mode,
    })
  )
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

// ─────────────────────────────────────────────────────────────────────────────
// AC #1 — module exports
// ─────────────────────────────────────────────────────────────────────────────
describe('Story 3-4 / module exports (AC #1)', () => {
  it('PAGE_SIZE === 20', () => {
    expect(PAGE_SIZE).toBe(20)
  })

  it('collectiveThreadKey(postId) returns the canonical tuple', () => {
    expect(collectiveThreadKey('post-A')).toEqual(['collective', 'thread', 'post-A'])
  })

  it('fetchThreadPage is an exported function', () => {
    expect(typeof fetchThreadPage).toBe('function')
  })

  it('useThread is an exported function', () => {
    expect(typeof useThread).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #3, #4 — fetchThreadPage RPC call shape & hasMore detection
// ─────────────────────────────────────────────────────────────────────────────
describe('Story 3-4 / fetchThreadPage RPC call shape (AC #3, #4)', () => {
  it('calls supabase.rpc("collective_thread_page", { post_id, cursor: null, page_size: 21 }) on first page', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    await fetchThreadPage('post-A', null)
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('collective_thread_page', {
      post_id: 'post-A',
      cursor: null,
      page_size: 21,
    })
  })

  it('passes a non-null cursor through verbatim', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    await fetchThreadPage('post-A', '2026-05-04T12:00:00Z')
    expect(rpcMock).toHaveBeenCalledWith('collective_thread_page', {
      post_id: 'post-A',
      cursor: '2026-05-04T12:00:00Z',
      page_size: 21,
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #3, #4, #12 — full-mode happy paths
// ─────────────────────────────────────────────────────────────────────────────
describe('Story 3-4 / fetchThreadPage full-mode happy paths (AC #3, #4, #12)', () => {
  it('21 rows → trims to 20 and surfaces nextCursor from items[19].created_at', async () => {
    const rows = makeRows(21, 'full')
    rpcMock.mockResolvedValueOnce({ data: rows, error: null })
    const result = await fetchThreadPage('post-A', null)
    expect(result.items).toHaveLength(20)
    expect(result.mode).toBe('full')
    expect(result.nextCursor).toBe(rows[19].created_at)
    // The 21st row must NOT appear in items.
    expect(result.items.find((p) => p.id === 'reply-21')).toBeUndefined()
  })

  it('5 rows (last page) → returns 5 items with nextCursor: null', async () => {
    const rows = makeRows(5, 'full')
    rpcMock.mockResolvedValueOnce({ data: rows, error: null })
    const result = await fetchThreadPage('post-A', null)
    expect(result.items).toHaveLength(5)
    expect(result.mode).toBe('full')
    expect(result.nextCursor).toBeNull()
  })

  it('exactly 20 rows → no over-trim, nextCursor: null', async () => {
    const rows = makeRows(20, 'full')
    rpcMock.mockResolvedValueOnce({ data: rows, error: null })
    const result = await fetchThreadPage('post-A', null)
    expect(result.items).toHaveLength(20)
    expect(result.nextCursor).toBeNull()
  })

  it('empty result → items: [], mode: "full", nextCursor: null', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    const result = await fetchThreadPage('post-A', null)
    expect(result.items).toEqual([])
    expect(result.mode).toBe('full')
    expect(result.nextCursor).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #3, #7, #12 — preview gate (canonical regression)
// ─────────────────────────────────────────────────────────────────────────────
describe('Story 3-4 / fetchThreadPage preview gate (AC #3, #7, #12)', () => {
  it('preview-mode + 4 rows → clamps items to 3 AND nextCursor unconditionally null', async () => {
    const rows = makeRows(4, 'preview')
    rpcMock.mockResolvedValueOnce({ data: rows, error: null })
    const result = await fetchThreadPage('post-A', null)
    expect(result.mode).toBe('preview')
    // The canonical "preview-cannot-be-bypassed-by-pagination" assertion.
    expect(result.nextCursor).toBeNull()
    // Defense-in-depth client-side clamp: server returned 4, client trims to 3.
    expect(result.items).toHaveLength(3)
  })

  it('preview-mode + 3 rows → 3 items, nextCursor null', async () => {
    const rows = makeRows(3, 'preview')
    rpcMock.mockResolvedValueOnce({ data: rows, error: null })
    const result = await fetchThreadPage('post-A', null)
    expect(result.mode).toBe('preview')
    expect(result.nextCursor).toBeNull()
    expect(result.items).toHaveLength(3)
  })

  it('preview-mode + 1 row → 1 item, nextCursor null', async () => {
    const rows = makeRows(1, 'preview')
    rpcMock.mockResolvedValueOnce({ data: rows, error: null })
    const result = await fetchThreadPage('post-A', null)
    expect(result.mode).toBe('preview')
    expect(result.nextCursor).toBeNull()
    expect(result.items).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #3 — error path
// ─────────────────────────────────────────────────────────────────────────────
describe('Story 3-4 / fetchThreadPage error path (AC #3)', () => {
  it('rejects with an Error carrying the supabase error message', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'authentication required' },
    })
    await expect(fetchThreadPage('post-A', null)).rejects.toThrow(/authentication required/)
  })

  it('rejects with the supabase error message even on generic failure', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'rpc network failure' },
    })
    await expect(fetchThreadPage('post-A', null)).rejects.toThrow(/rpc network failure/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #5 — useThread hook config (queryKey, infinite query, role-based gcTime)
// ─────────────────────────────────────────────────────────────────────────────
describe('Story 3-4 / useThread hook config (AC #5)', () => {
  it('queryKey shape on first fetch is ["collective", "thread", postId]', async () => {
    const rows = makeRows(2, 'full')
    rpcMock.mockResolvedValue({ data: rows, error: null })
    const qc = makeQueryClient()
    const { result } = renderHook(() => useThread('post-A', { role: 'root' }), {
      wrapper: wrapper(qc),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    const cached = qc.getQueryData(['collective', 'thread', 'post-A'])
    expect(cached).toBeDefined()
  })

  it('expansion role → resolved gcTime === 300_000 (5 min)', async () => {
    const rows = makeRows(2, 'full')
    rpcMock.mockResolvedValue({ data: rows, error: null })
    const qc = makeQueryClient()
    const { result } = renderHook(() => useThread('post-B', { role: 'expansion' }), {
      wrapper: wrapper(qc),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    const query = qc.getQueryCache().find({ queryKey: collectiveThreadKey('post-B') })
    expect(query).toBeDefined()
    // AC #5: expansion role MUST resolve to 5 min cache time.
    // The resolved value can be on the query itself or via observer options.
    const observerGcTime = (query as any)?.observers?.[0]?.options?.gcTime
    const directGcTime = (query as any)?.gcTime
    const resolved = observerGcTime ?? directGcTime
    expect(resolved).toBe(300_000)
  })

  it('root role → resolved gcTime !== 300_000 (inherits global default)', async () => {
    const rows = makeRows(2, 'full')
    rpcMock.mockResolvedValue({ data: rows, error: null })
    const qc = makeQueryClient()
    const { result } = renderHook(() => useThread('post-C', { role: 'root' }), {
      wrapper: wrapper(qc),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    const query = qc.getQueryCache().find({ queryKey: collectiveThreadKey('post-C') })
    expect(query).toBeDefined()
    const observerGcTime = (query as any)?.observers?.[0]?.options?.gcTime
    const directGcTime = (query as any)?.gcTime
    const resolved = observerGcTime ?? directGcTime
    // Root role must NOT be the 5-min hardcoded expansion value.
    expect(resolved).not.toBe(300_000)
  })

  it('refetchInterval === 30_000 on the resolved options', async () => {
    const rows = makeRows(2, 'full')
    rpcMock.mockResolvedValue({ data: rows, error: null })
    const qc = makeQueryClient()
    const { result } = renderHook(() => useThread('post-RI', { role: 'root' }), {
      wrapper: wrapper(qc),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const query = qc.getQueryCache().find({ queryKey: collectiveThreadKey('post-RI') })
    const opts = (query as any)?.observers?.[0]?.options
    expect(opts?.refetchInterval).toBe(30_000)
  })

  it('staleTime === 25_000 on the resolved options', async () => {
    const rows = makeRows(2, 'full')
    rpcMock.mockResolvedValue({ data: rows, error: null })
    const qc = makeQueryClient()
    const { result } = renderHook(() => useThread('post-ST', { role: 'root' }), {
      wrapper: wrapper(qc),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const query = qc.getQueryCache().find({ queryKey: collectiveThreadKey('post-ST') })
    const opts = (query as any)?.observers?.[0]?.options
    expect(opts?.staleTime).toBe(25_000)
  })

  it('refetchOnWindowFocus === true on the resolved options', async () => {
    const rows = makeRows(2, 'full')
    rpcMock.mockResolvedValue({ data: rows, error: null })
    const qc = makeQueryClient()
    const { result } = renderHook(() => useThread('post-WF', { role: 'root' }), {
      wrapper: wrapper(qc),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const query = qc.getQueryCache().find({ queryKey: collectiveThreadKey('post-WF') })
    const opts = (query as any)?.observers?.[0]?.options
    expect(opts?.refetchOnWindowFocus).toBe(true)
  })

  it('maxPages === 5 on the resolved options (NFR31 memory bound)', async () => {
    const rows = makeRows(2, 'full')
    rpcMock.mockResolvedValue({ data: rows, error: null })
    const qc = makeQueryClient()
    const { result } = renderHook(() => useThread('post-MP', { role: 'root' }), {
      wrapper: wrapper(qc),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const query = qc.getQueryCache().find({ queryKey: collectiveThreadKey('post-MP') })
    const opts = (query as any)?.observers?.[0]?.options
    expect(opts?.maxPages).toBe(5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #5 — getNextPageParam wiring (preview-mode → no further pages)
// ─────────────────────────────────────────────────────────────────────────────
describe('Story 3-4 / useThread pagination semantics (AC #5, #7)', () => {
  it('preview-mode response → hasNextPage === false (gate is unbypassable)', async () => {
    const rows = makeRows(4, 'preview')
    rpcMock.mockResolvedValue({ data: rows, error: null })
    const qc = makeQueryClient()
    const { result } = renderHook(() => useThread('post-PV', { role: 'root' }), {
      wrapper: wrapper(qc),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.hasNextPage).toBe(false)
  })

  it('full-mode last page (5 rows) → hasNextPage === false', async () => {
    const rows = makeRows(5, 'full')
    rpcMock.mockResolvedValue({ data: rows, error: null })
    const qc = makeQueryClient()
    const { result } = renderHook(() => useThread('post-LP', { role: 'root' }), {
      wrapper: wrapper(qc),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.hasNextPage).toBe(false)
  })

  it('full-mode 21 rows → hasNextPage === true', async () => {
    const rows = makeRows(21, 'full')
    rpcMock.mockResolvedValue({ data: rows, error: null })
    const qc = makeQueryClient()
    const { result } = renderHook(() => useThread('post-HM', { role: 'root' }), {
      wrapper: wrapper(qc),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.hasNextPage).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #8 — streak-cross-500 invalidation flows transitively via ['collective']
// ─────────────────────────────────────────────────────────────────────────────
describe('Story 3-4 / cache invalidation transitivity (AC #8)', () => {
  it('invalidateQueries({ queryKey: ["collective"] }) marks the seeded thread query stale', async () => {
    const rows = makeRows(2, 'full')
    rpcMock.mockResolvedValue({ data: rows, error: null })
    const qc = makeQueryClient()
    const { result } = renderHook(() => useThread('post-D', { role: 'root' }), {
      wrapper: wrapper(qc),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // Pre-invalidation: state is 'success' and not stale (staleTime is 25_000).
    const stateBefore = qc.getQueryState(collectiveThreadKey('post-D'))
    expect(stateBefore?.isInvalidated).toBe(false)

    await qc.invalidateQueries({ queryKey: ['collective'] })

    const stateAfter = qc.getQueryState(collectiveThreadKey('post-D'))
    // After invalidation, the query is marked invalidated (TanStack Query API).
    expect(stateAfter?.isInvalidated).toBe(true)
  })

  it('thread.ts source does NOT contain an observe() call (Legend-State exception lives in feed.ts only)', () => {
    // AC #8: the streak-cross-500 invalidation observe block lives in feed.ts,
    // NOT in thread.ts. This grep is a defensive regression — even though the
    // boundary-rule grep (AC #11) catches @legendapp/state imports, this
    // catches a more subtle "tried to import observe() from a different
    // legend subpath" mistake.
    const src = readFileSync(
      path.resolve(__dirname, '../collective/thread.ts'),
      'utf8'
    )
    // observe() with parens — distinguish from harmless words like 'observed'.
    // The grep specifically looks for a top-level observe(...) invocation
    // pattern. (The boundary grep already ensures no import exists; this is
    // a belt-and-suspenders check that even if a future edit imports observe
    // from a non-legend source, it is not invoked from this file.)
    expect(src).not.toMatch(/\bobserve\s*\(/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #15 — Post type structural parity with feed.ts (when both files exist)
// ─────────────────────────────────────────────────────────────────────────────
describe('Story 3-4 / Post type structural parity with feed.ts (AC #15)', () => {
  it('if feed.ts exists and exports Post, thread.ts and feed.ts share the canonical type', async () => {
    const feedPath = path.resolve(__dirname, '../collective/feed.ts')
    if (!existsSync(feedPath)) {
      // Story 3-3 has not landed yet; this story owns the canonical Post
      // declaration. The runtime check is satisfied trivially.
      expect(true).toBe(true)
      return
    }
    const feedMod = (await import('app/state/collective/feed')) as Record<string, unknown>
    const threadMod = (await import('app/state/collective/thread')) as Record<string, unknown>
    // Both modules must be loadable; the actual structural parity is enforced
    // at compile-time (tsc --noEmit) via the shared type import. Runtime here
    // just asserts neither module throws on import.
    expect(feedMod).toBeDefined()
    expect(threadMod).toBeDefined()
  })
})
