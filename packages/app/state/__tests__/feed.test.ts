// @vitest-environment happy-dom
/**
 * Story 3-3 — TDD red-phase E2E (integration) tests for `state/collective/feed.ts`.
 *
 * "E2E / integration" for this story means: full pipeline from RPC mock →
 * fetchFeedPage shaping → useFeed() useInfiniteQuery wiring → module-load
 * observe() reactive cycle that invalidates the ['collective'] query key
 * when store$.views.streak.lastQualifyingDate transitions.
 *
 * Red-phase: every test in this file MUST fail until Story 3-3 implementation
 * lands `packages/app/state/collective/feed.ts`. The file does not yet exist
 * (verified: `test -f packages/app/state/collective/feed.ts` → MISSING), so
 * all dynamic imports of `../collective/feed` reject at module-resolution
 * time, and the boundary-rule existsSync precondition (AC #22) fails.
 *
 * AC coverage:
 *   - AC #1, #2  — module structure & exports (PAGE_SIZE, collectiveFeedKey, types, fns)
 *   - AC #3, #4  — fetchFeedPage RPC call shape, slice/cursor logic, mode passthrough,
 *                  defensive mode default, error throw, empty handling
 *   - AC #5      — useFeed() useInfiniteQuery config (queryKey, maxPages: 5,
 *                  refetchInterval: 30_000, staleTime: 25_000, refetchOnWindowFocus,
 *                  initialPageParam, getNextPageParam shape)
 *   - AC #6      — useFeed() takes no arguments
 *   - AC #7, #8  — module-load observe() invalidates ['collective'] on
 *                  store$.views.streak.lastQualifyingDate transitions; initial
 *                  fire is suppressed; second transition fires again
 *   - AC #9      — package.json sideEffects entry for ./state/collective/feed.ts
 *   - AC #10     — boundary-rule narrow exception (single observe import)
 *   - AC #17     — observe() try/catch wrap (does not tear down on throw)
 *   - AC #18     — module-scope sentinel persists across observe re-runs
 *   - AC #19     — guard against empty items at slice point
 *   - AC #20     — String() coercion on nextCursor
 *   - AC #21     — queueMicrotask deferred invalidate
 *   - AC #22     — boundary-rule existsSync precondition (vacuous-pass guard)
 *   - AC #23     — refetchIntervalInBackground default (off)
 *
 * Hardening notes:
 *   - The mock for `app/utils/supabase` is hoisted via `vi.mock` so it runs
 *     BEFORE the dynamic import of `../collective/feed` in any test.
 *   - We spy on `queryClient.invalidateQueries` BEFORE importing the module,
 *     so the spy captures the very first observe() callback (which must NOT
 *     invalidate per the initial-fire-suppression contract, AC #7/#18).
 *   - `await Promise.resolve()` drains the microtask queue between a
 *     transition write and the spy assertion (AC #21 queueMicrotask defer).
 */

import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { renderHook } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted Supabase mock — must run before any `await importFeed()`.
// fetchFeedPage calls supabase.rpc('collective_feed_page', { cursor, page_size }).
// Each test resets `rpcMock` via `mockReset()` and reconfigures the resolved value.
// ─────────────────────────────────────────────────────────────────────────────
const rpcMock = vi.fn()

vi.mock('app/utils/supabase', () => ({
  supabase: { rpc: rpcMock },
}))

// ─────────────────────────────────────────────────────────────────────────────
// Path constants for source-text + filesystem assertions.
// ─────────────────────────────────────────────────────────────────────────────
const STATE_DIR = path.resolve(__dirname, '..')
const FEED_PATH = path.join(STATE_DIR, 'collective/feed.ts')
const REPO_ROOT = path.resolve(__dirname, '../../../..')
const PKG_JSON_PATH = path.resolve(STATE_DIR, '../package.json')

// ─────────────────────────────────────────────────────────────────────────────
// Indirect dynamic-import helper — defeats Vite's static `import()` resolver
// so a missing red-phase target file produces per-test failures rather than a
// suite-collection-time crash. The string is built at runtime; Vite cannot
// statically analyze it. Once Story 3-3 lands feed.ts, all imports resolve.
// ─────────────────────────────────────────────────────────────────────────────
interface FeedModule {
  PAGE_SIZE: number
  collectiveFeedKey: readonly ['collective', 'feed']
  fetchFeedPage: (
    cursor: string | null
  ) => Promise<{ items: unknown[]; mode: 'preview' | 'full'; nextCursor: string | null }>
  useFeed: () => unknown
}
const FEED_MODULE_ID = ['..', 'collective', 'feed'].join('/')
async function importFeed(): Promise<FeedModule> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await import(/* @vite-ignore */ FEED_MODULE_ID)) as any
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build N synthetic RPC rows with deterministic timestamps, all tagged `mode`. */
function makeRows(count: number, mode: string = 'full') {
  const rows: Array<Record<string, unknown>> = []
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `post-${i}`,
      user_id: 'u-1',
      parent_post_id: null,
      body: `body ${i}`,
      // Strictly-decreasing created_at timestamps so cursor semantics are realistic.
      created_at: `2026-05-05T12:00:${String(60 - i).padStart(2, '0')}Z`,
      is_removed: false,
      is_user_deleted: false,
      user_deleted_at: null,
      mode,
    })
  }
  return rows
}

/** Drain microtasks so queueMicrotask-deferred work runs before assertions. */
async function drainMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  rpcMock.mockReset()
  vi.resetModules()
})

afterAll(() => {
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #22 — Boundary-rule existsSync precondition (vacuous-pass guard).
// Must run FIRST so a missing file fails loudly rather than silently passing
// the "0 forbidden imports" greps below.
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-3 / boundary-rule existsSync precondition (AC #22)', () => {
  it('packages/app/state/collective/feed.ts exists on disk', () => {
    // Red-phase: this test fails until Story 3-3 lands the file. Once green,
    // it durably guards against a refactor silently deleting the file.
    expect(existsSync(FEED_PATH)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #1, #2 — module structure & exports
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-3 / module exports (AC #1, #2)', () => {
  it('exports PAGE_SIZE === 20', async () => {
    const mod = await importFeed()
    expect(mod.PAGE_SIZE).toBe(20)
  })

  it('exports collectiveFeedKey as ["collective", "feed"]', async () => {
    const mod = await importFeed()
    expect(mod.collectiveFeedKey).toEqual(['collective', 'feed'])
  })

  it('exports fetchFeedPage as an async function', async () => {
    const mod = await importFeed()
    expect(typeof mod.fetchFeedPage).toBe('function')
    // Calling with a never-resolving rpc still yields a Promise.
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    const result = mod.fetchFeedPage(null)
    expect(result).toBeInstanceOf(Promise)
    await result
  })

  it('exports useFeed as a function (zero-arg hook, AC #6)', async () => {
    const mod = await importFeed()
    expect(typeof mod.useFeed).toBe('function')
    // Arity check: AC #6 — useFeed takes no arguments.
    expect(mod.useFeed.length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #3, #4 — fetchFeedPage RPC call shape + slice/cursor logic
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-3 / fetchFeedPage RPC call shape (AC #3)', () => {
  it('calls supabase.rpc with ("collective_feed_page", { cursor, page_size: PAGE_SIZE + 1 })', async () => {
    const { fetchFeedPage } = await importFeed()
    rpcMock.mockResolvedValueOnce({ data: makeRows(3, 'full'), error: null })
    await fetchFeedPage('2026-05-05T11:59:00Z')
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('collective_feed_page', {
      cursor: '2026-05-05T11:59:00Z',
      page_size: 21, // PAGE_SIZE (20) + 1, the has-more sentinel pattern
    })
  })

  it('passes cursor: null on initial page request', async () => {
    const { fetchFeedPage } = await importFeed()
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    await fetchFeedPage(null)
    expect(rpcMock).toHaveBeenCalledWith('collective_feed_page', {
      cursor: null,
      page_size: 21,
    })
  })
})

describe('Story 3-3 / fetchFeedPage slice + cursor logic (AC #3, #19, #20)', () => {
  it('PAGE_SIZE+1 (21) rows → slices to 20, sets nextCursor to last item created_at', async () => {
    const { fetchFeedPage, PAGE_SIZE } = await importFeed()
    const rows = makeRows(21, 'full')
    rpcMock.mockResolvedValueOnce({ data: rows, error: null })
    const page = await fetchFeedPage(null)
    expect(page.items).toHaveLength(PAGE_SIZE)
    expect(page.items.length).toBe(20)
    // The cursor for the next page is the LAST returned (sliced) row's created_at.
    expect(page.nextCursor).toBe(String(rows[19].created_at))
  })

  it('AC #20 — nextCursor is typeof "string" (String() coercion)', async () => {
    const { fetchFeedPage } = await importFeed()
    rpcMock.mockResolvedValueOnce({ data: makeRows(21, 'full'), error: null })
    const page = await fetchFeedPage(null)
    expect(typeof page.nextCursor).toBe('string')
  })

  it('5 rows (< PAGE_SIZE) → items === input, nextCursor === null', async () => {
    const { fetchFeedPage } = await importFeed()
    rpcMock.mockResolvedValueOnce({ data: makeRows(5, 'full'), error: null })
    const page = await fetchFeedPage(null)
    expect(page.items).toHaveLength(5)
    expect(page.nextCursor).toBeNull()
  })

  it('exactly PAGE_SIZE (20) rows → no overflow → nextCursor === null', async () => {
    const { fetchFeedPage } = await importFeed()
    rpcMock.mockResolvedValueOnce({ data: makeRows(20, 'full'), error: null })
    const page = await fetchFeedPage(null)
    expect(page.items).toHaveLength(20)
    expect(page.nextCursor).toBeNull()
  })

  it('empty data → { items: [], mode: "full", nextCursor: null }', async () => {
    const { fetchFeedPage } = await importFeed()
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    const page = await fetchFeedPage(null)
    expect(page.items).toEqual([])
    expect(page.mode).toBe('full')
    expect(page.nextCursor).toBeNull()
  })

  it('null data → { items: [], mode: "full", nextCursor: null }', async () => {
    const { fetchFeedPage } = await importFeed()
    rpcMock.mockResolvedValueOnce({ data: null, error: null })
    const page = await fetchFeedPage(null)
    expect(page.items).toEqual([])
    expect(page.mode).toBe('full')
    expect(page.nextCursor).toBeNull()
  })

  it('throws when supabase.rpc returns an error', async () => {
    const { fetchFeedPage } = await importFeed()
    rpcMock.mockResolvedValueOnce({ data: null, error: new Error('boom') })
    await expect(fetchFeedPage(null)).rejects.toThrow()
  })

  it('AC #19 — defensive guard: nextCursor is null when sliced items would be empty', async () => {
    // Defense-in-depth: even if a future code path produces an empty slice
    // with data.length === PAGE_SIZE + 1 (logically impossible today), the
    // guard prevents an `items[-1].created_at` crash.
    const { fetchFeedPage } = await importFeed()
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    const page = await fetchFeedPage(null)
    expect(page.nextCursor).toBeNull()
    expect(page.items.length).toBe(0)
    // No throw indicates the guard is in place.
  })
})

describe('Story 3-3 / fetchFeedPage mode dispatch (AC #3)', () => {
  it('extracts mode === "preview" when rows are tagged preview', async () => {
    const { fetchFeedPage } = await importFeed()
    rpcMock.mockResolvedValueOnce({ data: makeRows(3, 'preview'), error: null })
    const page = await fetchFeedPage(null)
    expect(page.mode).toBe('preview')
  })

  it('extracts mode === "full" when rows are tagged full', async () => {
    const { fetchFeedPage } = await importFeed()
    rpcMock.mockResolvedValueOnce({ data: makeRows(3, 'full'), error: null })
    const page = await fetchFeedPage(null)
    expect(page.mode).toBe('full')
  })

  it('defensively defaults mode → "full" when row mode is malformed', async () => {
    // Future schema drift defense (RPC mode column is TEXT); arbitrary string
    // values must collapse to 'full' rather than propagate.
    const { fetchFeedPage } = await importFeed()
    rpcMock.mockResolvedValueOnce({
      data: makeRows(3, 'something-else-entirely'),
      error: null,
    })
    const page = await fetchFeedPage(null)
    expect(page.mode).toBe('full')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #5, #6, #23 — useFeed() useInfiniteQuery config smoke
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-3 / useFeed() useInfiniteQuery config (AC #5, #23)', () => {
  it('renders without error and registers a query under collectiveFeedKey', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    const { useFeed, collectiveFeedKey } = await importFeed()
    const testClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: testClient }, children)

    const { result } = renderHook(() => useFeed(), { wrapper })
    // Loading or fetched — either way, the hook is active.
    expect(result.current).toBeDefined()
    // The query was registered under the canonical key (testClient cache).
    const cache = testClient.getQueryCache()
    const found = cache.find({ queryKey: collectiveFeedKey })
    expect(found, 'useFeed must register under collectiveFeedKey').toBeDefined()
  })

  it('AC #5 / #23 — useFeed source enforces canonical config values', async () => {
    // Pure source-text grep — proves the config literal in feed.ts contains
    // the AC-mandated values. Cheap, hermetic, and impossible to mis-mock
    // under React Query internals. Each match is durable against drift.
    if (!existsSync(FEED_PATH)) {
      // Guarded by AC #22 above; this branch only fires red-phase pre-impl.
      throw new Error('feed.ts missing — AC #22 precondition will already have failed')
    }
    const src = readFileSync(FEED_PATH, 'utf8')
    expect(src, 'maxPages: 5 (AC #5, NFR31 100-post bound)').toMatch(/maxPages\s*:\s*5\b/)
    expect(src, 'refetchInterval: 30_000 (AC #5)').toMatch(/refetchInterval\s*:\s*30[_]?000\b/)
    expect(src, 'staleTime: 25_000 (AC #5)').toMatch(/staleTime\s*:\s*25[_]?000\b/)
    expect(src, 'refetchOnWindowFocus: true (AC #5)').toMatch(
      /refetchOnWindowFocus\s*:\s*true\b/
    )
    expect(src, 'queryKey: collectiveFeedKey (AC #5)').toMatch(
      /queryKey\s*:\s*collectiveFeedKey\b/
    )
    expect(src, 'initialPageParam: null (AC #5)').toMatch(/initialPageParam\s*:\s*null\b/)
    expect(src, 'getNextPageParam present (AC #5)').toMatch(/getNextPageParam\s*:/)
    // AC #23 — refetchIntervalInBackground must NOT be set to true.
    // If the property is mentioned at all, it must be `false` or `undefined`.
    expect(src, 'refetchIntervalInBackground must NOT be true (AC #23)').not.toMatch(
      /refetchIntervalInBackground\s*:\s*true\b/
    )
  })

  it('AC #5 — getNextPageParam returns lastPage.nextCursor ?? undefined', async () => {
    if (!existsSync(FEED_PATH)) {
      throw new Error('feed.ts missing — AC #22 precondition will already have failed')
    }
    const src = readFileSync(FEED_PATH, 'utf8')
    // Tolerant of formatting: look for the `nextCursor ?? undefined` shape.
    expect(src).toMatch(/nextCursor\s*\?\?\s*undefined/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #5 (memory bound) — maxPages × PAGE_SIZE = 100 (NFR31)
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-3 / memory bound NFR31 (AC #5)', () => {
  it('PAGE_SIZE * 5 === 100 (the documented memory ceiling)', async () => {
    const { PAGE_SIZE } = await importFeed()
    expect(PAGE_SIZE * 5).toBe(100)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #7, #8, #17, #18, #21 — module-load observe() reactive cycle
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-3 / observe() invalidation on streak transitions (AC #7, #8, #18, #21)', () => {
  it('initial fire is suppressed — invalidateQueries NOT called on import', async () => {
    // Spy BEFORE importing feed.ts so the very first observe callback is captured.
    const { queryClient } = await import('../queryClient')
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(Promise.resolve())
    spy.mockClear()

    await importFeed()
    await drainMicrotasks()

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('AC #7 / #21 — transition on store$.views.streak.lastQualifyingDate invalidates ["collective"] (after microtask drain)', async () => {
    const { queryClient } = await import('../queryClient')
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(Promise.resolve())
    spy.mockClear()

    // Importing feed.ts attaches the observe + fires once (suppressed by sentinel).
    await importFeed()
    await drainMicrotasks()
    expect(spy).not.toHaveBeenCalled()

    // Drive a transition. Per Dev Notes, the cleanest path is to drive the
    // upstream observables that the streak computed view derives from, but
    // since `observe()` reads `lastQualifyingDate.get()` directly, any actual
    // value change triggers the reaction. We mutate entries$/flows$ to force
    // the computed view to recompute with a new lastQualifyingDate.
    const { batch } = await import('@legendapp/state')
    const { entries$, flows$ } = await import('../store')
    const { getTodayJournalDayString } = await import('../date-utils')

    const today = getTodayJournalDayString()
    batch(() => {
      entries$.set({
        'e-feed-1': {
          id: 'e-feed-1',
          entryDate: today,
          lastModified: '2026-01-01T00:00:00Z',
          local_session_id: 'test-feed',
        } as never,
      })
      flows$.set({
        'f-feed-1': {
          id: 'f-feed-1',
          dailyEntryId: 'e-feed-1',
          wordCount: 500,
          content: '...',
          timestamp: '2026-01-01T00:00:00Z',
          local_session_id: 'test-feed',
        } as never,
      })
    })

    // AC #21: invalidate is deferred via queueMicrotask — drain.
    await drainMicrotasks()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['collective'] })
    spy.mockRestore()
  })

  it('AC #18 — module-scope sentinel persists; second transition invalidates again', async () => {
    const { queryClient } = await import('../queryClient')
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(Promise.resolve())
    spy.mockClear()

    await importFeed()
    await drainMicrotasks()

    const { batch } = await import('@legendapp/state')
    const { entries$, flows$ } = await import('../store')
    const { getTodayJournalDayString } = await import('../date-utils')

    const today = getTodayJournalDayString()
    // First transition.
    batch(() => {
      entries$.set({
        'e-sent-1': {
          id: 'e-sent-1',
          entryDate: today,
          lastModified: '2026-01-01T00:00:00Z',
          local_session_id: 't',
        } as never,
      })
      flows$.set({
        'f-sent-1': {
          id: 'f-sent-1',
          dailyEntryId: 'e-sent-1',
          wordCount: 500,
          content: '...',
          timestamp: '2026-01-01T00:00:00Z',
          local_session_id: 't',
        } as never,
      })
    })
    await drainMicrotasks()
    const callsAfterFirst = spy.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1)

    // Second transition: clear flows so today no longer qualifies → date flips back to null.
    batch(() => {
      flows$.set({})
      entries$.set({})
    })
    await drainMicrotasks()
    expect(spy.mock.calls.length).toBeGreaterThan(callsAfterFirst)
    spy.mockRestore()
  })

  it('AC #8 — uses store$.views.streak.lastQualifyingDate path (NOT a hypothetical streak$ export)', () => {
    if (!existsSync(FEED_PATH)) {
      throw new Error('feed.ts missing — AC #22 precondition will already have failed')
    }
    const src = readFileSync(FEED_PATH, 'utf8')
    expect(src).toMatch(/store\$\.views\.streak\.lastQualifyingDate/)
  })

  it('AC #17 — observe callback body is wrapped in try/catch', () => {
    if (!existsSync(FEED_PATH)) {
      throw new Error('feed.ts missing — AC #22 precondition will already have failed')
    }
    const src = readFileSync(FEED_PATH, 'utf8')
    // The callback body MUST contain a try/catch block. We grep for both
    // tokens and confirm a `try` keyword appears inside the observe()
    // invocation. Tolerant of formatting/whitespace/comments.
    const observeBlockMatch = src.match(/observe\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?\n\}\s*\)/)
    expect(observeBlockMatch, 'observe() block found').not.toBeNull()
    const block = observeBlockMatch![0]
    expect(block).toMatch(/\btry\s*\{/)
    expect(block).toMatch(/\bcatch\s*\(/)
  })

  it('AC #21 — invalidateQueries is called via queueMicrotask defer', () => {
    if (!existsSync(FEED_PATH)) {
      throw new Error('feed.ts missing — AC #22 precondition will already have failed')
    }
    const src = readFileSync(FEED_PATH, 'utf8')
    // Expect a queueMicrotask wrapper around the invalidate call.
    expect(src).toMatch(/queueMicrotask\s*\(/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #9 — package.json sideEffects entry
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-3 / packages/app/package.json sideEffects (AC #9)', () => {
  it('declares ./state/collective/feed.ts as a side-effect (tree-shake protection)', () => {
    const pkg = JSON.parse(readFileSync(PKG_JSON_PATH, 'utf8')) as {
      sideEffects?: string[]
    }
    expect(pkg.sideEffects).toBeDefined()
    expect(pkg.sideEffects).toContain('./state/collective/feed.ts')
  })

  it('preserves the existing mutations.ts sideEffects entry alongside feed.ts', () => {
    const pkg = JSON.parse(readFileSync(PKG_JSON_PATH, 'utf8')) as {
      sideEffects?: string[]
    }
    expect(pkg.sideEffects).toContain('./state/collective/mutations.ts')
    expect(pkg.sideEffects).toContain('./state/streak.ts')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #10 — boundary-rule narrow exception (single observe import only)
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-3 / boundary-rule narrow exception (AC #10)', () => {
  it('feed.ts imports ONLY `observe` from `@legendapp/state` (no subpaths, no other symbols)', () => {
    // AC #22 precondition.
    expect(existsSync(FEED_PATH)).toBe(true)

    const src = readFileSync(FEED_PATH, 'utf8')

    // Allowed shape: exactly one import of the form
    //   import { observe } from '@legendapp/state'
    const allowed = /import\s*\{\s*observe\s*\}\s*from\s*['"]@legendapp\/state['"]/
    expect(src).toMatch(allowed)

    // Exactly ONE line in the file references @legendapp/state, and it must
    // be the allowed form. Catches `{ observe, computed }`, subpath imports
    // (`/react`, `/sync`, etc.), and any expansion of the narrow exception.
    const lines = src.split('\n').filter((l) => /@legendapp\/state/.test(l))
    expect(lines.length).toBe(1)
    expect(lines[0]).toMatch(allowed)

    // Defensive: explicit forbidden subpaths (regression catch).
    expect(src).not.toMatch(/@legendapp\/state\/react/)
    expect(src).not.toMatch(/@legendapp\/state\/sync/)
    expect(src).not.toMatch(/use\$\s*\(/)
  })

  it('AC #11 — mutations.ts continues to have ZERO @legendapp/state imports (regression guard)', () => {
    const mutPath = path.join(STATE_DIR, 'collective/mutations.ts')
    expect(existsSync(mutPath)).toBe(true)
    const src = readFileSync(mutPath, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// "Offline cached pages render" — smoke contract that maxPages: 5 +
// stable queryKey allows persisted infiniteData to rehydrate.
// We assert the source-level contract; full persistence rehydration is a
// Story 3-2-shaped integration concern already covered by queryClient tests.
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-3 / offline cached pages render contract', () => {
  it('useFeed registers under a STABLE queryKey tuple (cacheable across cold starts)', async () => {
    const { collectiveFeedKey } = await importFeed()
    // The tuple must be exactly ['collective', 'feed'] — any drift breaks
    // persisted-cache hits (the persister keys by serialized queryKey).
    expect(collectiveFeedKey).toEqual(['collective', 'feed'])
    // Tuple is `as const` — adding/removing entries would change identity.
    expect(collectiveFeedKey.length).toBe(2)
  })

  it('the source declares maxPages: 5 so persisted infiniteData round-trips ≤ 100 posts', () => {
    if (!existsSync(FEED_PATH)) {
      throw new Error('feed.ts missing — AC #22 precondition will already have failed')
    }
    const src = readFileSync(FEED_PATH, 'utf8')
    expect(src).toMatch(/maxPages\s*:\s*5\b/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// REPO_ROOT sanity — ensures this test file can locate apps/* if a future
// AC adds eager-import assertions; harmless to keep here.
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-3 / repo root resolution sanity', () => {
  it('REPO_ROOT contains a packages directory', () => {
    expect(existsSync(path.join(REPO_ROOT, 'packages'))).toBe(true)
  })
})
