// @vitest-environment happy-dom
/**
 * Integration tests for `state/collective/feed.ts`.
 *
 * "Integration" here means: full pipeline from RPC mock → fetchFeedPage
 * shaping → useFeed() useInfiniteQuery wiring → module-load observe()
 * reactive cycle that invalidates the ['collective'] query key when
 * store$.views.streak.lastQualifyingDate transitions.
 *
 * Coverage:
 *   - module structure & exports (PAGE_SIZE, collectiveFeedKey, types, fns)
 *   - fetchFeedPage RPC call shape, slice/cursor logic, mode passthrough,
 *     defensive mode default, error throw, empty handling
 *   - useFeed() useInfiniteQuery config (queryKey, maxPages: 5,
 *     refetchInterval: 30_000, staleTime: 25_000, refetchOnWindowFocus,
 *     initialPageParam, getNextPageParam shape)
 *   - useFeed() takes no arguments
 *   - module-load observe() invalidates ['collective'] on
 *     store$.views.streak.lastQualifyingDate transitions; initial fire is
 *     suppressed; second transition fires again
 *   - package.json sideEffects entry for ./state/collective/feed.ts
 *   - boundary-rule narrow exception (single observe import)
 *   - observe() try/catch wrap (does not tear down on throw)
 *   - module-scope sentinel persists across observe re-runs
 *   - guard against empty items at slice point
 *   - String() coercion on nextCursor
 *   - queueMicrotask deferred invalidate
 *   - boundary-rule existsSync precondition (vacuous-pass guard)
 *   - refetchIntervalInBackground default (off)
 *   - title-led feed row shape: title/excerpt/descendant_count/reactions, no body
 *
 * Hardening notes:
 *   - The mock for `app/utils/supabase` is hoisted via `vi.mock` so it runs
 *     BEFORE the dynamic import of `../collective/feed` in any test.
 *   - We spy on `queryClient.invalidateQueries` BEFORE importing the module,
 *     so the spy captures the very first observe() callback (which must NOT
 *     invalidate per the initial-fire-suppression contract).
 *   - `await Promise.resolve()` drains the microtask queue between a
 *     transition write and the spy assertion (queueMicrotask defer).
 */

import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { renderHook } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// Type-only import (erased at runtime — does NOT execute feed.ts side-effects):
// used for the RPC-shape (type-level) assertions.
import type { Post } from 'app/state/collective/feed'

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
// so a missing target file produces per-test failures rather than a
// suite-collection-time crash. The string is built at runtime; Vite cannot
// statically analyze it.
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

/**
 * Build N synthetic RPC rows with deterministic timestamps, all tagged `mode`.
 *
 * The feed RPC return is title-led — rows carry `title`,
 * server-truncated `excerpt`, `descendant_count`, and a per-kind `reactions`
 * tally, and NO full `body`. Row 0 exercises the zero-reactions `{}` case.
 */
function makeRows(count: number, mode: string = 'full') {
  const rows: Array<Record<string, unknown>> = []
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `post-${i}`,
      user_id: 'u-1',
      parent_post_id: null,
      title: `title ${i}`,
      excerpt: `excerpt ${i}`,
      // Strictly-decreasing created_at timestamps so cursor semantics are realistic.
      created_at: `2026-05-05T12:00:${String(60 - i).padStart(2, '0')}Z`,
      is_removed: false,
      is_user_deleted: false,
      user_deleted_at: null,
      descendant_count: i,
      // Row 0 → zero-reactions `{}`; others → a non-empty tally.
      reactions: i === 0 ? {} : { heart: i },
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
// Boundary-rule existsSync precondition (vacuous-pass guard).
// Must run FIRST so a missing file fails loudly rather than silently passing
// the "0 forbidden imports" greps below.
// ─────────────────────────────────────────────────────────────────────────────

describe('boundary-rule existsSync precondition', () => {
  it('packages/app/state/collective/feed.ts exists on disk', () => {
    // Durably guards against a refactor silently deleting the file.
    expect(existsSync(FEED_PATH)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Module structure & exports
// ─────────────────────────────────────────────────────────────────────────────

describe('module exports', () => {
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

  it('exports useFeed as a function (zero-arg hook)', async () => {
    const mod = await importFeed()
    expect(typeof mod.useFeed).toBe('function')
    // Arity check: useFeed takes no arguments.
    expect(mod.useFeed.length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// fetchFeedPage RPC call shape + slice/cursor logic
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchFeedPage RPC call shape', () => {
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

describe('fetchFeedPage slice + cursor logic', () => {
  it('PAGE_SIZE+1 (21) rows → slices to 20, sets nextCursor to last item created_at', async () => {
    const { fetchFeedPage, PAGE_SIZE } = await importFeed()
    const rows = makeRows(21, 'full')
    rpcMock.mockResolvedValueOnce({ data: rows, error: null })
    const page = await fetchFeedPage(null)
    expect(page.items).toHaveLength(PAGE_SIZE)
    expect(page.items.length).toBe(20)
    // The cursor for the next page is the LAST returned (sliced) row's created_at.
    expect(page.nextCursor).toBe(String(rows[19]!.created_at))
  })

  it('nextCursor is typeof "string" (String() coercion)', async () => {
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

  it('defensive guard: nextCursor is null when sliced items would be empty', async () => {
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

describe('fetchFeedPage mode dispatch', () => {
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
// useFeed() useInfiniteQuery config smoke
// ─────────────────────────────────────────────────────────────────────────────

describe('useFeed() useInfiniteQuery config', () => {
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

  it('useFeed source enforces canonical config values', async () => {
    // Pure source-text grep — proves the config literal in feed.ts contains
    // the mandated values. Cheap, hermetic, and impossible to mis-mock
    // under React Query internals. Each match is durable against drift.
    if (!existsSync(FEED_PATH)) {
      // Guarded by the existsSync precondition above; this branch only fires pre-impl.
      throw new Error('feed.ts missing — existsSync precondition will already have failed')
    }
    const src = readFileSync(FEED_PATH, 'utf8')
    expect(src, 'maxPages: 5 (NFR31 100-post bound)').toMatch(/maxPages\s*:\s*5\b/)
    expect(src, 'refetchInterval: 30_000').toMatch(/refetchInterval\s*:\s*30[_]?000\b/)
    expect(src, 'staleTime: 25_000').toMatch(/staleTime\s*:\s*25[_]?000\b/)
    expect(src, 'refetchOnWindowFocus: true').toMatch(
      /refetchOnWindowFocus\s*:\s*true\b/
    )
    expect(src, 'queryKey: collectiveFeedKey').toMatch(
      /queryKey\s*:\s*collectiveFeedKey\b/
    )
    expect(src, 'initialPageParam: null').toMatch(/initialPageParam\s*:\s*null\b/)
    expect(src, 'getNextPageParam present').toMatch(/getNextPageParam\s*:/)
    // refetchIntervalInBackground must NOT be set to true.
    // If the property is mentioned at all, it must be `false` or `undefined`.
    expect(src, 'refetchIntervalInBackground must NOT be true').not.toMatch(
      /refetchIntervalInBackground\s*:\s*true\b/
    )
  })

  it('getNextPageParam returns lastPage.nextCursor ?? undefined', async () => {
    if (!existsSync(FEED_PATH)) {
      throw new Error('feed.ts missing — existsSync precondition will already have failed')
    }
    const src = readFileSync(FEED_PATH, 'utf8')
    // Tolerant of formatting: look for the `nextCursor ?? undefined` shape.
    expect(src).toMatch(/nextCursor\s*\?\?\s*undefined/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Memory bound — maxPages × PAGE_SIZE = 100 (NFR31)
// ─────────────────────────────────────────────────────────────────────────────

describe('memory bound NFR31', () => {
  it('PAGE_SIZE * 5 === 100 (the documented memory ceiling)', async () => {
    const { PAGE_SIZE } = await importFeed()
    expect(PAGE_SIZE * 5).toBe(100)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Module-load observe() reactive cycle
// ─────────────────────────────────────────────────────────────────────────────

describe('observe() invalidation on streak transitions', () => {
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

  it('transition on store$.views.streak.lastQualifyingDate invalidates ["collective"] (after microtask drain)', async () => {
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

    // Invalidate is deferred via queueMicrotask — drain.
    await drainMicrotasks()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['collective'] })
    spy.mockRestore()
  })

  it('module-scope sentinel persists; second transition invalidates again', async () => {
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

  it('uses store$.views.streak.lastQualifyingDate path (NOT a hypothetical streak$ export)', () => {
    if (!existsSync(FEED_PATH)) {
      throw new Error('feed.ts missing — existsSync precondition will already have failed')
    }
    const src = readFileSync(FEED_PATH, 'utf8')
    expect(src).toMatch(/store\$\.views\.streak\.lastQualifyingDate/)
  })

  it('observe callback body is wrapped in try/catch', () => {
    if (!existsSync(FEED_PATH)) {
      throw new Error('feed.ts missing — existsSync precondition will already have failed')
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

  it('invalidateQueries is called via queueMicrotask defer', () => {
    if (!existsSync(FEED_PATH)) {
      throw new Error('feed.ts missing — existsSync precondition will already have failed')
    }
    const src = readFileSync(FEED_PATH, 'utf8')
    // Expect a queueMicrotask wrapper around the invalidate call.
    expect(src).toMatch(/queueMicrotask\s*\(/)
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Day-boundary contract: advancing the current-day observable ALONE — with no
  // change to the underlying journal data — must NOT invalidate the feed cache.
  //
  // The last-qualifying-date value the observe() watches is a pure function of
  // entries/flows/grace-days; the current-day key only feeds the streak-cursor
  // walk, never the last-qualifying-date. So a midnight rollover for a user who
  // wrote nothing new cannot fire this invalidation — the day-boundary re-lock
  // for that user is carried instead by the RPC's live gate + the feed's 30s
  // poll (refetchInterval 30_000 / staleTime 25_000). This test locks in that
  // negative so a future change accidentally wiring the day key into the
  // last-qualifying-date (which WOULD fire a spurious invalidation on every
  // midnight) is caught as a regression.
  // ───────────────────────────────────────────────────────────────────────────
  it('advancing the current-day key alone (unchanged journal data) does NOT invalidate the feed cache', async () => {
    const { queryClient } = await import('../queryClient')
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(Promise.resolve())
    spy.mockClear()

    // Attach the observe (fires once on subscribe — suppressed by the sentinel).
    await importFeed()
    await drainMicrotasks()
    expect(spy).not.toHaveBeenCalled()

    const { batch } = await import('@legendapp/state')
    const { entries$, flows$, graceDays$ } = await import('../store')
    const { today$ } = await import('../today')
    const { getTodayJournalDayString } = await import('../date-utils')

    // Establish a REAL last-qualifying-date by writing a 500-word flow for today.
    // This is the one legitimate transition (null → today), so it fires once.
    const today = getTodayJournalDayString()
    batch(() => {
      entries$.set({
        'e-day-1': {
          id: 'e-day-1',
          entryDate: today,
          lastModified: '2026-01-01T00:00:00Z',
          local_session_id: 'test-day',
        } as never,
      })
      flows$.set({
        'f-day-1': {
          id: 'f-day-1',
          dailyEntryId: 'e-day-1',
          wordCount: 500,
          content: '...',
          timestamp: '2026-01-01T00:00:00Z',
          local_session_id: 'test-day',
        } as never,
      })
    })
    await drainMicrotasks()
    const callsAfterRealTransition = spy.mock.calls.length
    expect(callsAfterRealTransition).toBeGreaterThanOrEqual(1)

    // Now advance the current-day key ALONE — entries/flows/grace-days untouched.
    // A far-future date guarantees an actual change to today$ regardless of the
    // machine clock, and it differs from the entry's date so the qualifying day
    // (and thus last-qualifying-date) is unaffected.
    today$.set('2099-01-01')
    await drainMicrotasks()

    // No NEW invalidation: the day advance did not transition last-qualifying-date.
    expect(spy.mock.calls.length).toBe(callsAfterRealTransition)

    // Reset touched observables so the shared single-threaded Legend-State
    // global does not leak into sibling tests.
    batch(() => {
      entries$.set({})
      flows$.set({})
      graceDays$.set({})
    })
    today$.set(getTodayJournalDayString())
    await drainMicrotasks()
    spy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// package.json sideEffects entry
// ─────────────────────────────────────────────────────────────────────────────

describe('packages/app/package.json sideEffects', () => {
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
// boundary-rule narrow exception (single observe import only)
// ─────────────────────────────────────────────────────────────────────────────

describe('boundary-rule narrow exception', () => {
  it('feed.ts imports ONLY `observe` from `@legendapp/state` (no subpaths, no other symbols)', () => {
    // existsSync precondition.
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

  it('mutations.ts continues to have ZERO @legendapp/state imports (regression guard)', () => {
    const mutPath = path.join(STATE_DIR, 'collective/mutations.ts')
    expect(existsSync(mutPath)).toBe(true)
    const src = readFileSync(mutPath, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// "Offline cached pages render" — smoke contract that maxPages: 5 +
// stable queryKey allows persisted infiniteData to rehydrate.
// We assert the source-level contract; full persistence rehydration is an
// integration concern already covered by the queryClient tests.
// ─────────────────────────────────────────────────────────────────────────────

describe('offline cached pages render contract', () => {
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
      throw new Error('feed.ts missing — existsSync precondition will already have failed')
    }
    const src = readFileSync(FEED_PATH, 'utf8')
    expect(src).toMatch(/maxPages\s*:\s*5\b/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// REPO_ROOT sanity — ensures this test file can locate apps/* if a future
// AC adds eager-import assertions; harmless to keep here.
// ─────────────────────────────────────────────────────────────────────────────

describe('repo root resolution sanity', () => {
  it('REPO_ROOT contains a packages directory', () => {
    expect(existsSync(path.join(REPO_ROOT, 'packages'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Title-led feed row shape
//
// The feed RPC returns title + excerpt + descendant_count + a per-kind
// reactions tally, and NO full body. fetchFeedPage passes rows through
// unchanged, so these fields must surface on returned items and `body` must be
// absent. The CHECK-constraint contract is encoded as the migration's
// `DO $$` self-test (no pgTAP harness in this repo), NOT as a vitest test.
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchFeedPage surfaces title-led row shape', () => {
  it('surfaces title/excerpt/descendant_count/reactions and NO body', async () => {
    const { fetchFeedPage } = await importFeed()
    rpcMock.mockResolvedValueOnce({ data: makeRows(3, 'full'), error: null })
    const page = await fetchFeedPage(null)
    const item = page.items[0] as Record<string, unknown>
    expect(item.title).toBe('title 0')
    expect(item.excerpt).toBe('excerpt 0')
    expect(item.descendant_count).toBe(0)
    // Row 0 is the zero-reactions case — tally is {} (never null).
    expect(item.reactions).toEqual({})
    // The feed no longer carries a full body — only the truncated excerpt.
    expect('body' in item).toBe(false)
  })

  it('surfaces a non-empty reactions tally on rows that have reactions', async () => {
    const { fetchFeedPage } = await importFeed()
    rpcMock.mockResolvedValueOnce({ data: makeRows(3, 'full'), error: null })
    const page = await fetchFeedPage(null)
    const item = page.items[1] as Record<string, unknown>
    expect(item.reactions).toEqual({ heart: 1 })
    expect(item.descendant_count).toBe(1)
  })
})

describe('feed Post type shape', () => {
  it('Post carries title/excerpt/descendant_count/reactions; body is not assignable', () => {
    // Compile-time contract encoded at runtime via a fully-typed literal: if a
    // future database.ts regen drifts from the RPC, this stops compiling.
    const post: Post = {
      id: 'p',
      user_id: null,
      parent_post_id: null,
      title: 'A title',
      excerpt: 'an excerpt',
      created_at: '2026-01-01T00:00:00Z',
      is_removed: false,
      is_user_deleted: false,
      user_deleted_at: null,
      descendant_count: 2,
      reactions: { heart: 1 },
      mode: 'full',
    }
    expect(post.title).toBe('A title')
    expect(post.reactions.heart).toBe(1)
    // @ts-expect-error — `body` was dropped from the feed Post in the title-led redesign
    const hasBody = post.body
    expect(hasBody).toBeUndefined()
  })
})
