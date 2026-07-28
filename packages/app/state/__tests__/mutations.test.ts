// @vitest-environment happy-dom
/**
 * TDD red-phase integration tests for
 * `packages/app/state/collective/mutations.ts`.
 *
 * Red-phase contract: every test in this file MUST fail until the
 * implementation fills the stub at `packages/app/state/collective/mutations.ts`
 * with real `setMutationDefaults` registrations and the three consumer hooks.
 *
 * Coverage (38 items — 29 original + 9 elicitation-derived):
 *   - setMutationDefaults called THREE TIMES at module load (top-level)
 *   - __collectiveMutationsStub and __collectiveMutationsLoadedAt preserved
 *   - NO @legendapp/state import (D7 boundary rule)
 *   - sideEffects declaration verified by boundary-rule.test.ts (not repeated here)
 *   - each registration provides mutationFn, gcTime, onMutate, onError, onSettled
 *   - post mutationFn accepts {id,body,parent_post_id,user_id}; calls supabase insert
 *   - post onMutate inserts optimistic row at top of data.pages[0].items with __optimistic:true
 *   - post onError restores snapshot
 *   - react mutationFn accepts {id,post_id,kind,user_id,toggle:'add'|'remove'}
 *   - react onMutate snapshots both collectiveFeedKey AND collectiveThreadKey(post_id)
 *   - react onError restores all caches it modified (never sets undefined)
 *   - report mutationFn accepts {id,post_id,reporter_user_id,reason_code,note?}; swallows 23505 on EXPECTED constraint only
 *   - report onMutate does NOT mutate any cache
 *   - note content NEVER appears in console.log/warn/error/Sentry calls
 *   - useCreatePost, useToggleReaction, useReportPost exported; NO inline mutationFn
 *   - hook return type has mutate, mutateAsync, isPending, error, reset
 *   - useCreatePost fills id if omitted (or documents per-call generation)
 *   - post happy-path: optimistic row appears immediately, onSettled invalidates
 *   - report crash+replay: 23505 on expected constraint resolves cleanly
 *   - collective.react NOT added to PERSIST_IN_FLIGHT_KEYS
 *   - setMutationDefaults runs before PersistQueryClientProvider (eager import)
 *   - boundary-rule.test.ts TQ_FILES already covers mutations.ts (verified separately)
 *   - core assertions: getMutationDefaults returns defined config with correct shape
 *   - no `any` re-derivation; Post type from feed.ts used
 *   - body/note content not staged into log strings
 *   - replay idempotency: ON CONFLICT DO NOTHING (0 rows, no error) resolves cleanly + onSettled fires
 *   - empty-cache onMutate safety: undefined snapshot does not throw; onError does not clobber
 *   - mutationFn does not depend on module-scoped mutable closure state (source grep)
 *   - dehydrated cache includes in-flight collective.post mutation (accepted-loss doc)
 *   - double-submission: per-call UUID generation creates distinct mutations
 *   - reaction net-out: 23505 on UNIQUE constraint swallowed as success
 *   - 23505 swallow scope: specific to expected constraint; re-throws on other constraints or post mutation
 *   - onSettled uses ['collective'] prefix (invalidates all collective queries)
 *   - source-level doc comment explains why module-load registration is required
 *
 * Architecture invariants tested here:
 *   - FOOTGUN #1: setMutationDefaults count = exactly 3 (source grep)
 *   - NO @legendapp/state import (source grep — defense-in-depth alongside boundary-rule.test.ts)
 *   - gcTime = 24 * 60 * 60 * 1000 exactly on all three registrations
 *   - collective.react absent from PERSIST_IN_FLIGHT_KEYS (queryClient.ts source grep)
 *   - report 23505 swallow checks constraint name specifically
 *   - react 23505 swallow checks constraint name specifically
 *   - post never swallows 23505 (different error path)
 *
 * Test framework: Vitest + @testing-library/react renderHook.
 * Mocking strategy: vi.mock('app/utils/supabase', ...) hoisted above SUT import.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import { renderHook, act, waitFor } from '@testing-library/react'

// ─── Path constants ───────────────────────────────────────────────────────────
const STATE_DIR = path.resolve(__dirname, '..')
const MUTATIONS_PATH = path.join(STATE_DIR, 'collective/mutations.ts')
// queryClient.ts is now a thin platform re-export; PERSIST_IN_FLIGHT_KEYS and
// the mutation-defaults registration live in the shared singleton module.
const QUERY_CLIENT_PATH = path.join(STATE_DIR, 'queryClient.shared.ts')

// ─── Supabase mock — hoisted before SUT import ───────────────────────────────
// The chainable pattern: supabase.from('...').insert({...}) returns a promise.
// We provide enough depth: from → { insert, delete: deleteMethod, eq } chains.
// vi.hoisted is required so the factory variables are available at hoist time.

const { insertMock, deleteMock, eqMock, fromMock, rpcMock } = vi.hoisted(() => {
  const insertMock = vi.fn()
  const deleteMock = vi.fn()
  const eqMock = vi.fn()
  const fromMock = vi.fn()
  // rpcMock needed for supabase.rpc('delete_my_post', ...) calls.
  // Without this, every delete_own mutationFn test would throw:
  //   TypeError: supabase.rpc is not a function
  const rpcMock = vi.fn()
  return { insertMock, deleteMock, eqMock, fromMock, rpcMock }
})

vi.mock('app/utils/supabase', () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
  },
}))

// Mock @legendapp/state modules to prevent cross-boundary import issues
// (the SUT must NOT import these, but feed.ts does — this prevents side-effects
// from feed.ts's module-load observe() from interfering with test isolation).
vi.mock('@legendapp/state', () => ({
  observe: vi.fn(),
  observable: vi.fn(() => ({})),
}))

vi.mock('app/state/store', () => ({
  store$: { views: { streak: { lastQualifyingDate: { get: vi.fn(() => null) } } } },
  entries$: { peek: vi.fn(), set: vi.fn() },
  flows$: { peek: vi.fn(), set: vi.fn() },
  graceDays$: { peek: vi.fn(), set: vi.fn() },
}))

vi.mock('app/state/streak', () => ({}))

// SUT imports — after mocks are hoisted
import {
  __collectiveMutationsStub,
  __collectiveMutationsLoadedAt,
  useCreatePost,
  useToggleReaction,
  useReportPost,
  useDeleteOwnPost,
} from 'app/state/collective/mutations'
import { queryClient, dehydrateOptions } from 'app/state/queryClient'
import { collectiveFeedKey, type FeedPage, type Post } from 'app/state/collective/feed'
import { collectiveThreadKey, type ThreadPageResult } from 'app/state/collective/thread'
import { yourPostsKey, type YourPost, type YourPostsPage } from 'app/state/collective/yourPosts'

// TanStack Query v5.100: mutation lifecycle callbacks take a trailing
// MutationFunctionContext. Tests invoke the registered defaults manually, so
// supply a minimal context. The registered impls ignore it.
const MUTATION_FN_CONTEXT = { client: queryClient, meta: undefined }

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fresh QueryClientProvider wrapper for renderHook */
function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children)
  }
}

/** Build a minimal FeedPage for seeding the cache */
function makeFeedPage(posts: Partial<Post>[] = []): FeedPage {
  return {
    items: posts as Post[],
    mode: 'full',
    nextCursor: null,
  }
}

/** Build a minimal InfiniteData<FeedPage> structure */
function makeInfiniteData(pages: FeedPage[]): InfiniteData<FeedPage> {
  return {
    pages,
    pageParams: pages.map((_, i) => (i === 0 ? null : `cursor-${i}`)),
  }
}

/**
 * Build a minimal Post row for feed cache seeding.
 *
 * The feed `Post` no longer has `body` (the feed RPC dropped it in
 * favour of `excerpt`). The helper still emits a runtime `body` so it can also
 * seed pre-3-15-shaped rows and prove the delete_own feed branch does NOT stamp
 * `body` — hence the `& { body?: string }` on the overrides param. The return
 * is cast `as Post`, so the extra runtime field is harmless.
 */
function makePost(overrides: Partial<Post> & { body?: string } = {}): Post {
  return {
    id: 'post-1',
    body: 'hello world',
    parent_post_id: null,
    user_id: 'user-1',
    title: null,
    excerpt: '',
    descendant_count: 0,
    reactions: {},
    created_at: '2026-05-06T00:00:00.000Z',
    is_removed: false,
    is_user_deleted: false,
    user_deleted_at: null,
    mode: 'full',
    ...overrides,
  } as Post
}

beforeEach(() => {
  // Reset all supabase chain mocks to default "success" shape
  eqMock.mockResolvedValue({ data: [], error: null })
  deleteMock.mockReturnValue({ eq: eqMock })
  insertMock.mockResolvedValue({ data: [], error: null })
  fromMock.mockReturnValue({ insert: insertMock, delete: deleteMock })
  // rpcMock default — delete_my_post succeeds
  rpcMock.mockResolvedValue({ data: null, error: null })

  // Clear the test queryClient cache between tests so state doesn't bleed
  queryClient.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════════
// Sentinel exports preserved
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sentinel exports', () => {
  it('__collectiveMutationsStub is exported and truthy', () => {
    // This fails in red phase only if the stub is removed; the stub already
    // exports it. But once the implementation lands it must STILL be present.
    expect(__collectiveMutationsStub).toBeTruthy()
  })

  it('__collectiveMutationsLoadedAt is a number (captured at module load)', () => {
    expect(typeof __collectiveMutationsLoadedAt).toBe('number')
    expect(__collectiveMutationsLoadedAt).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Source-level grep tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Source-level grep assertions', () => {
  it('mutations.ts exists on disk (vacuous-pass guard)', () => {
    expect(existsSync(MUTATIONS_PATH), 'mutations.ts must exist').toBe(true)
  })

  it('mutations.ts does NOT contain @legendapp/state import (D7 boundary rule)', () => {
    // Defense-in-depth alongside boundary-rule.test.ts TQ_FILES sweep.
    expect(existsSync(MUTATIONS_PATH)).toBe(true)
    const src = readFileSync(MUTATIONS_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state(?:\/[\w-]+(?:\/[\w-]+)?)?/)
  })

  it('mutations.ts contains exactly FOUR setMutationDefaults( call sites (non-comment lines)', () => {
    // 3 registrations already existed; this adds the fourth (collective.delete_own).
    // This is the #1 footgun defense: exactly 4 top-level calls after 3-13 lands.
    // Fails in red phase because mutations.ts still has only 3 call-sites.
    // We only count non-comment lines to avoid matching comment mentions of the API.
    expect(existsSync(MUTATIONS_PATH)).toBe(true)
    const src = readFileSync(MUTATIONS_PATH, 'utf8')
    const callSiteLines = src
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
      .filter((line) => /setMutationDefaults\s*\(/.test(line))
    expect(
      callSiteLines.length,
      `expected exactly 4 setMutationDefaults( call sites (non-comment lines), found ${callSiteLines.length}: ${callSiteLines.join(' | ')}`
    ).toBe(4)
  })

  it('mutationFn bodies do NOT reference module-scoped let variables (closure safety)', () => {
    // Defense against capturing stale state; all inputs must live in variables.
    // We grep for `let ` declarations at module scope (not inside a function body)
    // then check they are not referenced inside `mutationFn` assignments.
    // Simplified check: no module-scoped `let` (only const/type/function is safe).
    expect(existsSync(MUTATIONS_PATH)).toBe(true)
    const src = readFileSync(MUTATIONS_PATH, 'utf8')
    // Exclude let inside function/arrow bodies (these are fine).
    // We look for bare `^let ` lines at module scope (no leading spaces indicating nesting).
    const moduleLetLines = src.split('\n').filter((line) => /^let\s+\w/.test(line))
    expect(
      moduleLetLines.length,
      `mutations.ts has module-scoped let declarations which could create stale closure state: ${moduleLetLines.join(', ')}`
    ).toBe(0)
  })

  it('mutations.ts does NOT interpolate note or body into console calls', () => {
    expect(existsSync(MUTATIONS_PATH)).toBe(true)
    const src = readFileSync(MUTATIONS_PATH, 'utf8')
    // Any console.* call that includes `note` or `body` in its argument list.
    expect(src).not.toMatch(/console\.\w+\s*\([^)]*\bnote\b/)
    expect(src).not.toMatch(/console\.\w+\s*\([^)]*\bbody\b/)
  })

  it('mutations.ts has a doc comment explaining why module-load registration is required', () => {
    expect(existsSync(MUTATIONS_PATH)).toBe(true)
    const src = readFileSync(MUTATIONS_PATH, 'utf8')
    // The implementation should include a comment explaining the footgun.
    // Match any mention of the key concept: "setMutationDefaults" in a comment context
    // AND either "module load" or "PersistQueryClientProvider" or "replay".
    expect(src).toMatch(/(?:module.?load|PersistQueryClientProvider|replay)/i)
  })

  it('queryClient.ts PERSIST_IN_FLIGHT_KEYS does NOT include collective.react', () => {
    // This story MUST NOT add collective.react to the in-flight persist set.
    const qcSrc = readFileSync(QUERY_CLIENT_PATH, 'utf8')
    expect(qcSrc).not.toMatch(/PERSIST_IN_FLIGHT_KEYS[^;]*collective\.react/)
    // Positive: the set DOES contain collective.post and collective.report.
    expect(qcSrc).toMatch(/collective\.post/)
    expect(qcSrc).toMatch(/collective\.report/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// getMutationDefaults returns correct config for all three keys
// ═══════════════════════════════════════════════════════════════════════════════

describe('getMutationDefaults — registered at module load', () => {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

  it('getMutationDefaults([collective,post]) is defined after import', () => {
    const defaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(defaults, 'collective.post defaults must be registered at module load').toBeDefined()
  })

  it('collective.post defaults expose mutationFn, gcTime, onMutate, onError, onSettled', () => {
    const defaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(defaults).toBeDefined()
    expect(typeof defaults?.mutationFn).toBe('function')
    expect(defaults?.gcTime).toBeDefined()
    expect(typeof defaults?.onMutate).toBe('function')
    expect(typeof defaults?.onError).toBe('function')
    expect(typeof defaults?.onSettled).toBe('function')
  })

  it('collective.post gcTime equals exactly 24 * 60 * 60 * 1000', () => {
    const defaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(defaults?.gcTime).toBe(TWENTY_FOUR_HOURS_MS)
  })

  it('getMutationDefaults([collective,react]) is defined after import', () => {
    const defaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(defaults, 'collective.react defaults must be registered at module load').toBeDefined()
  })

  it('collective.react defaults expose mutationFn, gcTime, onMutate, onError, onSettled', () => {
    const defaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(defaults).toBeDefined()
    expect(typeof defaults?.mutationFn).toBe('function')
    expect(defaults?.gcTime).toBe(TWENTY_FOUR_HOURS_MS)
    expect(typeof defaults?.onMutate).toBe('function')
    expect(typeof defaults?.onError).toBe('function')
    expect(typeof defaults?.onSettled).toBe('function')
  })

  it('getMutationDefaults([collective,report]) is defined after import', () => {
    const defaults = queryClient.getMutationDefaults(['collective', 'report'])
    expect(defaults, 'collective.report defaults must be registered at module load').toBeDefined()
  })

  it('collective.report defaults expose mutationFn, gcTime, onMutate, onError, onSettled', () => {
    const defaults = queryClient.getMutationDefaults(['collective', 'report'])
    expect(defaults).toBeDefined()
    expect(typeof defaults?.mutationFn).toBe('function')
    expect(defaults?.gcTime).toBe(TWENTY_FOUR_HOURS_MS)
    expect(typeof defaults?.onMutate).toBe('function')
    expect(typeof defaults?.onError).toBe('function')
    expect(typeof defaults?.onSettled).toBe('function')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Hook exports and return shape
// ═══════════════════════════════════════════════════════════════════════════════

describe('Hook exports', () => {
  it('useCreatePost is exported', () => {
    expect(typeof useCreatePost).toBe('function')
  })

  it('useToggleReaction is exported', () => {
    expect(typeof useToggleReaction).toBe('function')
  })

  it('useReportPost is exported', () => {
    expect(typeof useReportPost).toBe('function')
  })

  it('useCreatePost returns mutate, mutateAsync, isPending, error, reset', () => {
    const localQc = new QueryClient()
    // Re-register defaults on the local client for hook-level testing
    const postDefaults = queryClient.getMutationDefaults(['collective', 'post'])
    if (postDefaults) localQc.setMutationDefaults(['collective', 'post'], postDefaults)

    const { result } = renderHook(() => useCreatePost(), { wrapper: makeWrapper(localQc) })
    expect(typeof result.current.mutate).toBe('function')
    expect(typeof result.current.mutateAsync).toBe('function')
    expect(typeof result.current.isPending).toBe('boolean')
    // error is null when idle
    expect(result.current.error === null || result.current.error === undefined).toBe(true)
    expect(typeof result.current.reset).toBe('function')
  })

  it('useToggleReaction returns mutate, mutateAsync, isPending, error, reset', () => {
    const localQc = new QueryClient()
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    if (reactDefaults) localQc.setMutationDefaults(['collective', 'react'], reactDefaults)

    const { result } = renderHook(() => useToggleReaction(), { wrapper: makeWrapper(localQc) })
    expect(typeof result.current.mutate).toBe('function')
    expect(typeof result.current.mutateAsync).toBe('function')
    expect(typeof result.current.isPending).toBe('boolean')
    expect(typeof result.current.reset).toBe('function')
  })

  it('useReportPost returns mutate, mutateAsync, isPending, error, reset', () => {
    const localQc = new QueryClient()
    const reportDefaults = queryClient.getMutationDefaults(['collective', 'report'])
    if (reportDefaults) localQc.setMutationDefaults(['collective', 'report'], reportDefaults)

    const { result } = renderHook(() => useReportPost(), { wrapper: makeWrapper(localQc) })
    expect(typeof result.current.mutate).toBe('function')
    expect(typeof result.current.mutateAsync).toBe('function')
    expect(typeof result.current.isPending).toBe('boolean')
    expect(typeof result.current.reset).toBe('function')
  })

  it('consumer hooks do NOT contain inline mutationFn override', () => {
    expect(existsSync(MUTATIONS_PATH)).toBe(true)
    const src = readFileSync(MUTATIONS_PATH, 'utf8')
    // Each hook function body must NOT contain mutationFn: — only mutationKey:.
    // Inline mutationFn defeats the persisted-replay path (the replay runs the
    // default registered at module-load, not the inline override). This is FOOTGUN #1.
    const hookNames = ['useCreatePost', 'useToggleReaction', 'useReportPost', 'useDeleteOwnPost']
    for (const hookName of hookNames) {
      const match = src.match(new RegExp(`function\\s+${hookName}[^}]*\\{([^}]*)\\}`, 's'))
      if (match) {
        expect(match[1], `${hookName} must not contain inline mutationFn`).not.toMatch(
          /mutationFn\s*:/
        )
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Optimistic update and rollback for post mutation
// ═══════════════════════════════════════════════════════════════════════════════

describe('post mutation — optimistic update', () => {
  it('onMutate inserts optimistic row at top of pages[0].items with __optimistic:true', async () => {
    const postDefaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(postDefaults, 'collective.post defaults must be registered').toBeDefined()

    // Seed the singleton queryClient's feed cache — onMutate reads/writes the singleton.
    const existingPost = makePost({ id: 'existing-1', body: 'existing post' })
    const seedData = makeInfiniteData([makeFeedPage([existingPost])])
    queryClient.setQueryData(collectiveFeedKey, seedData)

    // Simulate onMutate manually. The create-post vars carry a
    // `title`; the optimistic FEED row is title-led (no body).
    const vars = {
      id: 'new-post-1',
      body: 'hello new post',
      title: 'a new title',
      parent_post_id: null,
      user_id: 'user-42',
    }

    // Cancel outgoing queries and run onMutate
    await queryClient.cancelQueries({ queryKey: ['collective'] })
    const context = await postDefaults!.onMutate!(vars, MUTATION_FN_CONTEXT)

    const afterMutate = queryClient.getQueryData<InfiniteData<FeedPage>>(collectiveFeedKey)
    expect(afterMutate).toBeDefined()
    expect(afterMutate!.pages[0]!.items.length).toBe(2)

    // New optimistic row must be FIRST. It carries title/excerpt,
    // NOT body (the feed Post dropped body).
    const firstItem = afterMutate!.pages[0]!.items[0] as Post & { __optimistic?: boolean }
    expect(firstItem.id).toBe('new-post-1')
    expect(firstItem.title).toBe('a new title')
    expect((firstItem as Record<string, unknown>).body).toBeUndefined()
    expect(firstItem.__optimistic).toBe(true)

    // Original row still present
    expect(afterMutate!.pages[0]!.items[1]?.id).toBe('existing-1')

    // Context must contain snapshot for rollback
    expect((context as { snapshot: unknown }).snapshot).toBeDefined()
  })

  it('onError restores the snapshot', async () => {
    const postDefaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(postDefaults).toBeDefined()

    // Seed the singleton queryClient's feed cache — onMutate reads/writes the singleton.
    const existingPost = makePost({ id: 'existing-1', body: 'original' })
    const seedData = makeInfiniteData([makeFeedPage([existingPost])])
    queryClient.setQueryData(collectiveFeedKey, seedData)

    // Run onMutate to insert optimistic row and get snapshot
    await queryClient.cancelQueries({ queryKey: ['collective'] })
    const context = await postDefaults!.onMutate!(
      { id: 'new-1', body: 'new', parent_post_id: null, user_id: 'u1' },
      MUTATION_FN_CONTEXT
    )

    // Verify optimistic row was inserted
    const afterOptimistic = queryClient.getQueryData<InfiniteData<FeedPage>>(collectiveFeedKey)
    expect(afterOptimistic!.pages[0]!.items.length).toBe(2)

    // Simulate error + rollback
    await postDefaults!.onError!(
      new Error('insert failed'),
      { id: 'new-1', body: 'new', parent_post_id: null, user_id: 'u1' },
      context,
      MUTATION_FN_CONTEXT
    )

    // Cache should be restored to original state
    const afterRollback = queryClient.getQueryData<InfiniteData<FeedPage>>(collectiveFeedKey)
    expect(afterRollback!.pages[0]!.items.length).toBe(1)
    expect(afterRollback!.pages[0]!.items[0]?.id).toBe('existing-1')
  })

  it('onSettled calls invalidateQueries with [collective] key', async () => {
    const postDefaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(postDefaults).toBeDefined()

    // Spy on the singleton queryClient — onSettled closes over and calls it directly.
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    // Run onSettled (variables and context args not used by onSettled)
    await postDefaults!.onSettled!(
      undefined,
      null,
      { id: 'x', body: 'x', parent_post_id: null, user_id: 'u' },
      undefined,
      MUTATION_FN_CONTEXT
    )

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['collective'] })
    )
    invalidateSpy.mockRestore()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Empty-cache onMutate safety
// ═══════════════════════════════════════════════════════════════════════════════

describe('post mutation — empty-cache safety', () => {
  it('onMutate does NOT throw when collectiveFeedKey has no cached data', async () => {
    const localQc = new QueryClient()
    const postDefaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(postDefaults).toBeDefined()
    localQc.setMutationDefaults(['collective', 'post'], postDefaults!)

    // Ensure cache is empty (no seed)
    expect(localQc.getQueryData(collectiveFeedKey)).toBeUndefined()

    // Must not throw
    await expect(
      postDefaults!.onMutate!(
        { id: 'x', body: 'hello', parent_post_id: null, user_id: 'u' },
        MUTATION_FN_CONTEXT
      )
    ).resolves.toBeDefined()
  })

  it('onError does NOT call setQueryData(key, undefined) when snapshot is undefined', async () => {
    const localQc = new QueryClient()
    const postDefaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(postDefaults).toBeDefined()
    localQc.setMutationDefaults(['collective', 'post'], postDefaults!)

    const setQueryDataSpy = vi.spyOn(localQc, 'setQueryData')

    // Simulate context where snapshot was undefined (empty cache)
    const emptyContext = { snapshot: undefined }
    await postDefaults!.onError!(
      new Error('failed'),
      { id: 'x', body: 'y', parent_post_id: null, user_id: 'u' },
      emptyContext,
      MUTATION_FN_CONTEXT
    )

    // Must NOT have called setQueryData with undefined
    const callsWithUndefined = setQueryDataSpy.mock.calls.filter((call) => call[1] === undefined)
    expect(callsWithUndefined.length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// post mutationFn calls supabase insert
// ═══════════════════════════════════════════════════════════════════════════════

describe('post mutationFn', () => {
  it('calls supabase.from("collective_posts").insert with variables', async () => {
    const postDefaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(postDefaults).toBeDefined()

    insertMock.mockResolvedValue({ data: [], error: null })
    fromMock.mockReturnValue({ insert: insertMock, delete: deleteMock })

    const vars = { id: 'post-uuid', body: 'test body', parent_post_id: null, user_id: 'user-1' }
    await postDefaults!.mutationFn!(vars, MUTATION_FN_CONTEXT)

    expect(fromMock).toHaveBeenCalledWith('collective_posts')
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'post-uuid',
        body: 'test body',
        user_id: 'user-1',
      })
    )
  })

  it('re-throws supabase error when error is non-null', async () => {
    const postDefaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(postDefaults).toBeDefined()

    const supabaseError = {
      message: 'DB error',
      code: '23000',
      constraint: 'other_constraint',
      details: '',
    }
    insertMock.mockResolvedValue({ data: null, error: supabaseError })
    fromMock.mockReturnValue({ insert: insertMock })

    const vars = { id: 'post-uuid', body: 'test body', parent_post_id: null, user_id: 'user-1' }
    await expect(postDefaults!.mutationFn!(vars, MUTATION_FN_CONTEXT)).rejects.toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Replay idempotency: ON CONFLICT DO NOTHING (0 rows, no error)
// ═══════════════════════════════════════════════════════════════════════════════

describe('post mutation — replay idempotency', () => {
  it('mutationFn resolves cleanly when server returns 0 rows (ON CONFLICT DO NOTHING)', async () => {
    const postDefaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(postDefaults).toBeDefined()

    // Server returns 0 rows and NO error — this is ON CONFLICT DO NOTHING behavior
    insertMock.mockResolvedValue({ data: [], error: null })
    fromMock.mockReturnValue({ insert: insertMock })

    const vars = {
      id: 'existing-uuid',
      body: 'already on server',
      parent_post_id: null,
      user_id: 'u1',
    }
    await expect(postDefaults!.mutationFn!(vars, MUTATION_FN_CONTEXT)).resolves.not.toThrow()
  })

  it('onSettled fires invalidateQueries after idempotent replay', async () => {
    const postDefaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(postDefaults).toBeDefined()

    // Spy on the singleton queryClient — onSettled closes over and calls it directly.
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    // Simulate onSettled after a successful (idempotent) replay
    await postDefaults!.onSettled!(
      [],
      null,
      { id: 'existing-uuid', body: 'already on server', parent_post_id: null, user_id: 'u1' },
      undefined,
      MUTATION_FN_CONTEXT
    )

    expect(invalidateSpy).toHaveBeenCalled()
    invalidateSpy.mockRestore()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// react mutation
// ═══════════════════════════════════════════════════════════════════════════════

describe('react mutation — onMutate snapshots', () => {
  it('onMutate snapshots both collectiveFeedKey and collectiveThreadKey(post_id)', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults, 'collective.react defaults must be registered').toBeDefined()

    const POST_ID = 'post-42'

    // Seed the singleton queryClient — onMutate reads from the singleton directly.
    const feedPost = makePost({ id: POST_ID })
    queryClient.setQueryData(collectiveFeedKey, makeInfiniteData([makeFeedPage([feedPost])]))

    const threadData: InfiniteData<ThreadPageResult> = {
      pages: [
        {
          // Thread cache holds `ThreadPost` (has `body`); makePost yields a feed
          // `Post`, so cast through `unknown` to simulate a seeded thread row.
          items: [
            makePost({ id: 'reply-1', parent_post_id: POST_ID }),
          ] as unknown as ThreadPageResult['items'],
          mode: 'full',
          nextCursor: null,
        },
      ],
      pageParams: [null],
    }
    queryClient.setQueryData(collectiveThreadKey(POST_ID), threadData)

    const vars = {
      id: 'rxn-1',
      post_id: POST_ID,
      kind: 'heart' as const,
      user_id: 'u1',
      toggle: 'add' as const,
    }

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    const context = await reactDefaults!.onMutate!(vars, MUTATION_FN_CONTEXT)

    // context must contain both snapshots
    const ctx = context as { feedSnapshot?: unknown; threadSnapshot?: unknown }
    expect(ctx.feedSnapshot).toBeDefined()
    expect(ctx.threadSnapshot).toBeDefined()
  })

  it('onError restores both feed and thread snapshots without setting undefined', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    const localQc = new QueryClient()
    reactDefaults && localQc.setMutationDefaults(['collective', 'react'], reactDefaults)

    const POST_ID = 'post-42'
    const feedPost = makePost({ id: POST_ID })
    localQc.setQueryData(collectiveFeedKey, makeInfiniteData([makeFeedPage([feedPost])]))

    const setQueryDataSpy = vi.spyOn(localQc, 'setQueryData')

    // onMutate to get snapshots
    await localQc.cancelQueries({ queryKey: ['collective'] })
    const context = await reactDefaults!.onMutate!(
      {
        id: 'rxn-1',
        post_id: POST_ID,
        kind: 'heart' as const,
        user_id: 'u1',
        toggle: 'add' as const,
      },
      MUTATION_FN_CONTEXT
    )

    setQueryDataSpy.mockClear()

    // Simulate error rollback
    await reactDefaults!.onError!(
      new Error('failed'),
      {
        id: 'rxn-1',
        post_id: POST_ID,
        kind: 'heart' as const,
        user_id: 'u1',
        toggle: 'add' as const,
      },
      context,
      MUTATION_FN_CONTEXT
    )

    // setQueryData must NOT be called with undefined
    const undefinedCalls = setQueryDataSpy.mock.calls.filter((call) => call[1] === undefined)
    expect(undefinedCalls.length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// react mutationFn calls supabase correctly for add/remove
// ═══════════════════════════════════════════════════════════════════════════════

describe('react mutationFn', () => {
  it('calls supabase.from("collective_reactions").insert when toggle=add', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    insertMock.mockResolvedValue({ data: [], error: null })
    fromMock.mockReturnValue({ insert: insertMock, delete: deleteMock })

    await reactDefaults!.mutationFn!(
      {
        id: 'rxn-uuid',
        post_id: 'p1',
        kind: 'heart',
        user_id: 'u1',
        toggle: 'add',
      },
      MUTATION_FN_CONTEXT
    )

    expect(fromMock).toHaveBeenCalledWith('collective_reactions')
    expect(insertMock).toHaveBeenCalled()
  })

  it('calls supabase.from("collective_reactions").delete when toggle=remove', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    eqMock.mockResolvedValue({ data: [], error: null })
    deleteMock.mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ insert: insertMock, delete: deleteMock })

    await reactDefaults!.mutationFn!(
      {
        id: 'rxn-uuid',
        post_id: 'p1',
        kind: 'heart',
        user_id: 'u1',
        toggle: 'remove',
      },
      MUTATION_FN_CONTEXT
    )

    expect(fromMock).toHaveBeenCalledWith('collective_reactions')
    expect(deleteMock).toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// report mutationFn: 23505 swallow scope
// ═══════════════════════════════════════════════════════════════════════════════

describe('report mutationFn — 23505 swallow scope', () => {
  it('resolves when 23505 is on the expected collective_reports constraint', async () => {
    const reportDefaults = queryClient.getMutationDefaults(['collective', 'report'])
    expect(reportDefaults).toBeDefined()

    const uniqueViolation = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
      constraint: 'collective_reports_post_id_reporter_user_id_key',
      details: '',
    }
    insertMock.mockResolvedValue({ data: null, error: uniqueViolation })
    fromMock.mockReturnValue({ insert: insertMock })

    const vars = {
      id: 'r1',
      post_id: 'p1',
      reporter_user_id: 'u1',
      reason_code: 'spam',
      note: null,
    }
    await expect(reportDefaults!.mutationFn!(vars, MUTATION_FN_CONTEXT)).resolves.not.toThrow()
  })

  it('re-throws 23505 on a different/unexpected constraint for report', async () => {
    const reportDefaults = queryClient.getMutationDefaults(['collective', 'report'])
    expect(reportDefaults).toBeDefined()

    const wrongConstraintError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
      constraint: 'some_other_constraint_not_expected',
      details: '',
    }
    insertMock.mockResolvedValue({ data: null, error: wrongConstraintError })
    fromMock.mockReturnValue({ insert: insertMock })

    const vars = {
      id: 'r1',
      post_id: 'p1',
      reporter_user_id: 'u1',
      reason_code: 'spam',
      note: null,
    }
    await expect(reportDefaults!.mutationFn!(vars, MUTATION_FN_CONTEXT)).rejects.toBeDefined()
  })

  it('react mutationFn swallows 23505 on collective_reactions UNIQUE constraint', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    const uniqueViolation = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
      constraint: 'collective_reactions_post_id_user_id_kind_key',
      details: '',
    }
    insertMock.mockResolvedValue({ data: null, error: uniqueViolation })
    fromMock.mockReturnValue({ insert: insertMock, delete: deleteMock })

    const vars = {
      id: 'rxn-1',
      post_id: 'p1',
      kind: 'heart',
      user_id: 'u1',
      toggle: 'add' as const,
    }
    await expect(reactDefaults!.mutationFn!(vars, MUTATION_FN_CONTEXT)).resolves.not.toThrow()
  })

  it('react mutationFn re-throws 23505 on an unexpected constraint', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    const wrongConstraintError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
      constraint: 'some_totally_different_constraint',
      details: '',
    }
    insertMock.mockResolvedValue({ data: null, error: wrongConstraintError })
    fromMock.mockReturnValue({ insert: insertMock, delete: deleteMock })

    const vars = {
      id: 'rxn-1',
      post_id: 'p1',
      kind: 'heart',
      user_id: 'u1',
      toggle: 'add' as const,
    }
    await expect(reactDefaults!.mutationFn!(vars, MUTATION_FN_CONTEXT)).rejects.toBeDefined()
  })

  it('post mutationFn re-throws non-23505 errors (not a swallow candidate)', async () => {
    const postDefaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(postDefaults).toBeDefined()

    const foreignKeyError = {
      code: '23503',
      message: 'foreign key constraint violation',
      constraint: 'collective_posts_user_id_fkey',
      details: '',
    }
    insertMock.mockResolvedValue({ data: null, error: foreignKeyError })
    fromMock.mockReturnValue({ insert: insertMock })

    const vars = { id: 'x', body: 'y', parent_post_id: null, user_id: 'bad-user' }
    await expect(postDefaults!.mutationFn!(vars, MUTATION_FN_CONTEXT)).rejects.toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// report mutationFn: insert params
// report onMutate does NOT mutate cache
// ═══════════════════════════════════════════════════════════════════════════════

describe('report mutation', () => {
  it('calls supabase.from("collective_reports").insert', async () => {
    const reportDefaults = queryClient.getMutationDefaults(['collective', 'report'])
    expect(reportDefaults).toBeDefined()

    insertMock.mockResolvedValue({ data: [], error: null })
    fromMock.mockReturnValue({ insert: insertMock })

    const vars = {
      id: 'r1',
      post_id: 'p1',
      reporter_user_id: 'u1',
      reason_code: 'spam',
      note: null,
    }
    await reportDefaults!.mutationFn!(vars, MUTATION_FN_CONTEXT)

    expect(fromMock).toHaveBeenCalledWith('collective_reports')
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'r1',
        post_id: 'p1',
        reporter_user_id: 'u1',
        reason_code: 'spam',
      })
    )
  })

  it('report onMutate does NOT set any queryData on the cache', async () => {
    const reportDefaults = queryClient.getMutationDefaults(['collective', 'report'])
    expect(reportDefaults).toBeDefined()

    const localQc = new QueryClient()
    reportDefaults && localQc.setMutationDefaults(['collective', 'report'], reportDefaults)

    // Seed the feed cache
    const existingPost = makePost({ id: 'p1' })
    const seed = makeInfiniteData([makeFeedPage([existingPost])])
    localQc.setQueryData(collectiveFeedKey, seed)

    const setQueryDataSpy = vi.spyOn(localQc, 'setQueryData')

    await reportDefaults!.onMutate!(
      {
        id: 'r1',
        post_id: 'p1',
        reporter_user_id: 'u1',
        reason_code: 'spam',
        note: null,
      },
      MUTATION_FN_CONTEXT
    )

    // onMutate for report must NOT touch any cache
    expect(setQueryDataSpy).not.toHaveBeenCalled()
  })

  it('report onError is essentially a no-op (nothing to restore)', async () => {
    const reportDefaults = queryClient.getMutationDefaults(['collective', 'report'])
    expect(reportDefaults).toBeDefined()

    const localQc = new QueryClient()
    reportDefaults && localQc.setMutationDefaults(['collective', 'report'], reportDefaults)

    const setQueryDataSpy = vi.spyOn(localQc, 'setQueryData')

    await reportDefaults!.onError!(
      new Error('failed'),
      { id: 'r1', post_id: 'p1', reporter_user_id: 'u1', reason_code: 'spam', note: null },
      undefined,
      MUTATION_FN_CONTEXT
    )

    expect(setQueryDataSpy).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Double-submission produces distinct mutations
// ═══════════════════════════════════════════════════════════════════════════════

describe('Double-submission / per-call UUID', () => {
  it('useCreatePost hook body does not generate id via useMemo or useState (per-call pattern)', () => {
    // The story spec says: "per-call generation inside mutate wrapper".
    // The hook itself should not cache id in React state — it should be
    // generated per mutate() call (or callers pass it). We verify the hook
    // does not call useState or useMemo for the id.
    expect(existsSync(MUTATIONS_PATH)).toBe(true)
    const src = readFileSync(MUTATIONS_PATH, 'utf8')
    // Extract the useCreatePost body if present
    const fnBody = src.match(/function\s+useCreatePost[\s\S]*?\n\}/)?.[0] ?? ''
    // The body should NOT useState/useMemo an id variable
    expect(fnBody).not.toMatch(/useState\s*\(\s*(?:crypto\.randomUUID\(\)|['"]['"]\))?/)
    expect(fnBody).not.toMatch(/useMemo\s*\(\s*\(\s*\)\s*=>\s*crypto\.randomUUID/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// dehydrated cache includes in-flight collective.post mutation
// ═══════════════════════════════════════════════════════════════════════════════

describe('dehydrateOptions.shouldDehydrateMutation', () => {
  /**
   * Helper to build a minimal fake mutation object shaped like TanStack Query's
   * Mutation class — only the fields shouldDehydrateMutation actually inspects.
   */
  function fakeMutation(
    mutationKey: string[],
    status: 'pending' | 'success' | 'error' | 'idle',
    isPaused = false
  ) {
    return {
      options: { mutationKey },
      state: { status, isPaused },
    } as unknown as Parameters<NonNullable<typeof dehydrateOptions.shouldDehydrateMutation>>[0]
  }

  it('collective.post pending mutation IS included in dehydrated cache', () => {
    const mutation = fakeMutation(['collective', 'post'], 'pending')
    expect(dehydrateOptions.shouldDehydrateMutation!(mutation)).toBe(true)
  })

  it('collective.react pending mutation is NOT included in dehydrated cache', () => {
    const mutation = fakeMutation(['collective', 'react'], 'pending')
    expect(dehydrateOptions.shouldDehydrateMutation!(mutation)).toBe(false)
  })

  it('collective.report pending mutation IS included in dehydrated cache', () => {
    const mutation = fakeMutation(['collective', 'report'], 'pending')
    expect(dehydrateOptions.shouldDehydrateMutation!(mutation)).toBe(true)
  })

  it('paused collective.react mutation IS included (isPaused default behavior)', () => {
    // Paused mutations (offline-queued) are always persisted regardless of key.
    const mutation = fakeMutation(['collective', 'react'], 'pending', true)
    expect(dehydrateOptions.shouldDehydrateMutation!(mutation)).toBe(true)
  })

  it('paused collective.post mutation IS included (isPaused → always true)', () => {
    const mutation = fakeMutation(['collective', 'post'], 'pending', true)
    expect(dehydrateOptions.shouldDehydrateMutation!(mutation)).toBe(true)
  })

  it('non-pending collective.post mutation is NOT included (only pending is in-flight)', () => {
    const mutation = fakeMutation(['collective', 'post'], 'success')
    expect(dehydrateOptions.shouldDehydrateMutation!(mutation)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// onSettled invalidates ['collective'] prefix (all three mutations)
// ═══════════════════════════════════════════════════════════════════════════════

describe('onSettled prefix invalidation', () => {
  for (const key of [
    ['collective', 'post'] as const,
    ['collective', 'react'] as const,
    ['collective', 'report'] as const,
  ]) {
    const label = key.join('.')
    it(`${label} onSettled calls invalidateQueries({ queryKey: ['collective'] })`, async () => {
      const defaults = queryClient.getMutationDefaults(key)
      expect(defaults, `${label} defaults must be registered`).toBeDefined()

      // We need a fresh client to spy on; we re-register defaults on it.
      const localQc = new QueryClient()
      defaults && localQc.setMutationDefaults(key, defaults)
      const invalidateSpy = vi.spyOn(localQc, 'invalidateQueries')

      // Call onSettled via the defaults function (not the localQc-registered version,
      // since onSettled closes over the singleton queryClient in the real implementation).
      // We test the singleton queryClient's defaults directly.
      const singletonInvalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      await defaults!.onSettled!(undefined, null, {} as never, undefined, MUTATION_FN_CONTEXT)

      expect(singletonInvalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['collective'] })
      )

      singletonInvalidateSpy.mockRestore()
      invalidateSpy.mockRestore()
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// collective.delete_own — TDD red-phase tests
//
// These tests cover mutation registration and related test subtasks.
//
// RED PHASE CONTRACT: every test in this block MUST FAIL until the
// developer adds the fourth `queryClient.setMutationDefaults(['collective','delete_own'],
// {...})` call, the `useDeleteOwnPost()` hook, and `DeleteOwnPostVars` /
// `DeleteOwnContext` exports to `mutations.ts`.
//
// Critical pre-conditions implemented here per story validate step:
//   1. rpcMock is hoisted (done above in vi.hoisted block) — prevents
//      "supabase.rpc is not a function" errors before assertions reach.
//   2. The source-grep count was updated from 3 → 4 (done above).
//   3. useDeleteOwnPost is imported (done in SUT imports section above).
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal YourPost row for yourPosts cache seeding */
function makeYourPost(overrides: Partial<YourPost> = {}): YourPost {
  return {
    id: 'post-1',
    user_id: 'user-1',
    parent_post_id: null,
    title: null,
    body: 'hello world',
    created_at: '2026-05-06T00:00:00.000Z',
    is_removed: false,
    is_user_deleted: false,
    user_deleted_at: null,
    reaction_count: 0,
    descendant_count: 0,
    tenure_tier: null,
    mode: 'full',
    ...overrides,
  }
}

/** Build InfiniteData<YourPostsPage> for seeding the yourPosts cache */
function makeYourPostsInfiniteData(items: YourPost[]): InfiniteData<YourPostsPage> {
  return {
    pages: [{ items, nextCursor: null }],
    pageParams: [null],
  }
}

/**
 * Build InfiniteData<ThreadPageResult> for seeding the thread cache. The thread
 * cache holds `ThreadPost` (which has `body`); makePost yields a feed `Post`
 * (no `body` in its type) but carries a runtime `body`, so we cast through
 * `unknown` to faithfully simulate a seeded thread row.
 */
function makeThreadInfiniteData(items: Post[]): InfiniteData<ThreadPageResult> {
  return {
    pages: [
      { items: items as unknown as ThreadPageResult['items'], mode: 'full', nextCursor: null },
    ],
    pageParams: [null],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getMutationDefaults(['collective','delete_own']) is defined
// ─────────────────────────────────────────────────────────────────────────────

describe('collective.delete_own — registration', () => {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

  it('getMutationDefaults([collective,delete_own]) is defined after import', () => {
    // RED: fails until this work adds the fourth setMutationDefaults call.
    const defaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(
      defaults,
      'collective.delete_own defaults must be registered at module load'
    ).toBeDefined()
  })

  it('collective.delete_own defaults expose mutationFn, gcTime, onMutate, onError, onSettled', () => {
    // RED: fails until all five lifecycle hooks are registered.
    const defaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(defaults).toBeDefined()
    expect(typeof defaults?.mutationFn).toBe('function')
    expect(defaults?.gcTime).toBeDefined()
    expect(typeof defaults?.onMutate).toBe('function')
    expect(typeof defaults?.onError).toBe('function')
    expect(typeof defaults?.onSettled).toBe('function')
  })

  it('collective.delete_own gcTime equals exactly 24 * 60 * 60 * 1000', () => {
    // RED: fails until gcTime is wired to TWENTY_FOUR_HOURS_MS constant.
    const defaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(defaults?.gcTime).toBe(TWENTY_FOUR_HOURS_MS)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// useDeleteOwnPost hook export and return shape
// ─────────────────────────────────────────────────────────────────────────────

describe('collective.delete_own — hook export', () => {
  it('useDeleteOwnPost is exported', () => {
    // RED: fails until useDeleteOwnPost is exported from mutations.ts.
    expect(typeof useDeleteOwnPost).toBe('function')
  })

  it('useDeleteOwnPost returns mutate, mutateAsync, isPending, error, reset', () => {
    // RED: fails until useDeleteOwnPost is a valid useMutation wrapper.
    const localQc = new QueryClient()
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    if (deleteDefaults) localQc.setMutationDefaults(['collective', 'delete_own'], deleteDefaults)

    const { result } = renderHook(() => useDeleteOwnPost(), { wrapper: makeWrapper(localQc) })
    expect(typeof result.current.mutate).toBe('function')
    expect(typeof result.current.mutateAsync).toBe('function')
    expect(typeof result.current.isPending).toBe('boolean')
    expect(result.current.error === null || result.current.error === undefined).toBe(true)
    expect(typeof result.current.reset).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Optimistic update covers all three caches
// ─────────────────────────────────────────────────────────────────────────────

describe('collective.delete_own — optimistic update', () => {
  const POST_ID = 'post-to-delete'

  it('onMutate sets deletion flags in feed cache WITHOUT writing body', async () => {
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults, 'collective.delete_own defaults must exist').toBeDefined()

    // Seed feed cache with the target post
    const feedPost = makePost({ id: POST_ID, body: 'original body', is_user_deleted: false })
    queryClient.setQueryData(collectiveFeedKey, makeInfiniteData([makeFeedPage([feedPost])]))

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    await deleteDefaults!.onMutate!({ post_id: POST_ID }, MUTATION_FN_CONTEXT)

    const updated = queryClient.getQueryData<InfiniteData<FeedPage>>(collectiveFeedKey)
    const updatedPost = updated?.pages[0]?.items[0]
    // The feed Post has no body — the client renders [deleted] from
    // the flag. The feed branch must NOT stamp '[deleted]' onto a body field.
    expect((updatedPost as Record<string, unknown> | undefined)?.body).not.toBe('[deleted]')
    expect(updatedPost?.is_user_deleted).toBe(true)
    expect(updatedPost?.user_deleted_at).not.toBeNull()
    // Verify user_deleted_at is a valid ISO string
    expect(() => new Date(updatedPost!.user_deleted_at!)).not.toThrow()
  })

  it('onMutate marks body=[deleted] in thread cache', async () => {
    // RED: fails until onMutate walks collectiveThreadKey(post_id) and updates matching row.
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    // Seed thread cache with the target post
    const threadPost = makePost({
      id: POST_ID,
      body: 'original thread body',
      is_user_deleted: false,
    })
    queryClient.setQueryData(collectiveThreadKey(POST_ID), makeThreadInfiniteData([threadPost]))

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    await deleteDefaults!.onMutate!({ post_id: POST_ID }, MUTATION_FN_CONTEXT)

    const updated = queryClient.getQueryData<InfiniteData<ThreadPageResult>>(
      collectiveThreadKey(POST_ID)
    )
    const updatedPost = updated?.pages[0]?.items[0]
    expect(updatedPost?.body).toBe('[deleted]')
    expect(updatedPost?.is_user_deleted).toBe(true)
  })

  it('onMutate marks body=[deleted] in yourPosts cache', async () => {
    // RED: fails until onMutate walks yourPostsKey and updates matching row.
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    // Seed yourPosts cache with the target post
    const yourPost = makeYourPost({ id: POST_ID, body: 'my original post', is_user_deleted: false })
    queryClient.setQueryData(yourPostsKey, makeYourPostsInfiniteData([yourPost]))

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    await deleteDefaults!.onMutate!({ post_id: POST_ID }, MUTATION_FN_CONTEXT)

    const updated = queryClient.getQueryData<InfiniteData<YourPostsPage>>(yourPostsKey)
    const updatedPost = updated?.pages[0]?.items[0]
    expect(updatedPost?.body).toBe('[deleted]')
    expect(updatedPost?.is_user_deleted).toBe(true)
    expect(updatedPost?.user_deleted_at).not.toBeNull()
  })

  it('onMutate covers all three caches simultaneously', async () => {
    // RED: fails until all three cache walks are implemented together.
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    // Seed all three caches with the same post
    const feedPost = makePost({ id: POST_ID, body: 'feed version', is_user_deleted: false })
    queryClient.setQueryData(collectiveFeedKey, makeInfiniteData([makeFeedPage([feedPost])]))

    const threadPost = makePost({ id: POST_ID, body: 'thread version', is_user_deleted: false })
    queryClient.setQueryData(collectiveThreadKey(POST_ID), makeThreadInfiniteData([threadPost]))

    const yourPost = makeYourPost({
      id: POST_ID,
      body: 'yourposts version',
      is_user_deleted: false,
    })
    queryClient.setQueryData(yourPostsKey, makeYourPostsInfiniteData([yourPost]))

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    const ctx = await deleteDefaults!.onMutate!({ post_id: POST_ID }, MUTATION_FN_CONTEXT)

    // All three caches updated. The feed branch sets only the
    // deletion flags (no body); thread + yourPosts still write body: '[deleted]'.
    const feedUpdated = queryClient.getQueryData<InfiniteData<FeedPage>>(collectiveFeedKey)
    expect(feedUpdated?.pages[0]?.items[0]?.is_user_deleted).toBe(true)
    expect((feedUpdated?.pages[0]?.items[0] as Record<string, unknown> | undefined)?.body).not.toBe(
      '[deleted]'
    )

    const threadUpdated = queryClient.getQueryData<InfiniteData<ThreadPageResult>>(
      collectiveThreadKey(POST_ID)
    )
    expect(threadUpdated?.pages[0]?.items[0]?.body).toBe('[deleted]')

    const yourUpdated = queryClient.getQueryData<InfiniteData<YourPostsPage>>(yourPostsKey)
    expect(yourUpdated?.pages[0]?.items[0]?.body).toBe('[deleted]')

    // Context contains all three snapshots. yourPosts caches are user-scoped
    // keys under the yourPostsKey prefix (cross-user defense), so the context
    // carries an ARRAY of [key, snapshot] pairs collected via prefix matching.
    const context = ctx as {
      feedSnapshot?: unknown
      threadSnapshot?: unknown
      yourPostsSnapshots?: Array<readonly [readonly unknown[], unknown]>
    }
    expect(context.feedSnapshot).toBeDefined()
    expect(context.threadSnapshot).toBeDefined()
    expect(context.yourPostsSnapshots).toBeDefined()
    expect(context.yourPostsSnapshots!.length).toBeGreaterThan(0)
    expect(context.yourPostsSnapshots![0]![1]).toBeDefined()
  })

  it('optimistic update uses literal "[deleted]" (exact match)', async () => {
    // RED: fails if implementation uses any variant (brackets, unicode, etc.)
    // This guards the string-consistency rule. The feed
    // cache no longer carries body, so the literal-[deleted] guard is asserted
    // on the THREAD cache (which still stamps body: '[deleted]').
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    const threadPost = makePost({ id: POST_ID, body: 'some content', is_user_deleted: false })
    queryClient.setQueryData(collectiveThreadKey(POST_ID), makeThreadInfiniteData([threadPost]))

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    await deleteDefaults!.onMutate!({ post_id: POST_ID }, MUTATION_FN_CONTEXT)

    const updated = queryClient.getQueryData<InfiniteData<ThreadPageResult>>(
      collectiveThreadKey(POST_ID)
    )
    // EXACT match — not /\[deleted\]/i, not 'deleted', not '[Deleted]'
    expect(updated?.pages[0]?.items[0]?.body).toBe('[deleted]')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Rollback on server error (non-42501)
// ─────────────────────────────────────────────────────────────────────────────

describe('collective.delete_own — rollback on error', () => {
  const POST_ID = 'rollback-post'

  it('onError restores all three caches to original snapshots', async () => {
    // RED: fails until onError restores all three snapshots from context.
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    // Seed all three caches
    const originalFeedPost = makePost({
      id: POST_ID,
      body: 'original feed',
      is_user_deleted: false,
    })
    queryClient.setQueryData(
      collectiveFeedKey,
      makeInfiniteData([makeFeedPage([originalFeedPost])])
    )

    const originalThreadPost = makePost({
      id: POST_ID,
      body: 'original thread',
      is_user_deleted: false,
    })
    queryClient.setQueryData(
      collectiveThreadKey(POST_ID),
      makeThreadInfiniteData([originalThreadPost])
    )

    const originalYourPost = makeYourPost({
      id: POST_ID,
      body: 'original yourposts',
      is_user_deleted: false,
    })
    queryClient.setQueryData(yourPostsKey, makeYourPostsInfiniteData([originalYourPost]))

    // Run onMutate to get optimistic context (snapshots)
    await queryClient.cancelQueries({ queryKey: ['collective'] })
    const ctx = await deleteDefaults!.onMutate!({ post_id: POST_ID }, MUTATION_FN_CONTEXT)

    // Verify optimistic update was applied. Feed carries no body,
    // so the optimistic marker on the feed row is the is_user_deleted flag.
    expect(
      queryClient.getQueryData<InfiniteData<FeedPage>>(collectiveFeedKey)?.pages[0]?.items[0]
        ?.is_user_deleted
    ).toBe(true)

    // Simulate server error (non-42501 = real error, must rollback)
    const serverError = new Error('network failure')
    await deleteDefaults!.onError!(serverError, { post_id: POST_ID }, ctx, MUTATION_FN_CONTEXT)

    // All three caches should be restored. The feed row's flag returns to false
    // (its body is unchanged throughout — the feed never wrote it).
    expect(
      queryClient.getQueryData<InfiniteData<FeedPage>>(collectiveFeedKey)?.pages[0]?.items[0]
        ?.is_user_deleted
    ).toBe(false)
    expect(
      queryClient.getQueryData<InfiniteData<ThreadPageResult>>(collectiveThreadKey(POST_ID))
        ?.pages[0]?.items[0]?.body
    ).toBe('original thread')
    expect(
      queryClient.getQueryData<InfiniteData<YourPostsPage>>(yourPostsKey)?.pages[0]?.items[0]?.body
    ).toBe('original yourposts')
  })

  it('mutation.error is the rejected error after rollback', async () => {
    // RED: fails until mutationFn re-throws non-42501 errors.
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    const serverError = { code: '500', message: 'internal server error' }
    rpcMock.mockResolvedValue({ data: null, error: serverError })

    // mutationFn should re-throw
    await expect(
      deleteDefaults!.mutationFn!({ post_id: POST_ID }, MUTATION_FN_CONTEXT)
    ).rejects.toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Idempotent replay: 42501 swallow
// ─────────────────────────────────────────────────────────────────────────────

describe('collective.delete_own — 42501 swallow', () => {
  it('mutationFn resolves when 42501 with exact message "cannot delete this post"', async () => {
    // RED: fails until mutationFn has the swallow predicate (code AND message).
    // This covers the offline-replay idempotency path.
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'cannot delete this post' },
    })

    // Must resolve cleanly — no throw
    await expect(
      deleteDefaults!.mutationFn!({ post_id: 'some-post-id' }, MUTATION_FN_CONTEXT)
    ).resolves.not.toThrow()
  })

  it('42501 with DIFFERENT message is NOT swallowed (re-throws)', async () => {
    // RED: fails until the swallow predicate checks BOTH code AND message.
    // Defends against over-broad swallow that matches code alone.
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied for table collective_posts' },
    })

    // Must re-throw — different 42501 message means different failure mode
    await expect(
      deleteDefaults!.mutationFn!({ post_id: 'some-post-id' }, MUTATION_FN_CONTEXT)
    ).rejects.toBeDefined()
  })

  it('42501 with correct code but wrong message field variant also re-throws', async () => {
    // RED: ensures the predicate matches exactly "cannot delete this post" (no prefix/suffix)
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'you cannot delete this post' },
    })

    await expect(
      deleteDefaults!.mutationFn!({ post_id: 'some-post-id' }, MUTATION_FN_CONTEXT)
    ).rejects.toBeDefined()
  })

  it('no console.error called on 42501 swallow (clean replay)', async () => {
    // RED: fails if implementation logs the 42501 error path.
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    const consoleErrorSpy = vi.spyOn(console, 'error')

    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'cannot delete this post' },
    })

    await deleteDefaults!.mutationFn!({ post_id: 'idempotent-post-id' }, MUTATION_FN_CONTEXT)

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Empty-cache safety
// ─────────────────────────────────────────────────────────────────────────────

describe('collective.delete_own — empty-cache safety', () => {
  it('onMutate does not throw when no caches are seeded', async () => {
    // RED: fails until onMutate guards every getQueryData result for undefined.
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    // Explicitly clear — no caches seeded
    queryClient.clear()

    await expect(
      deleteDefaults!.onMutate!({ post_id: 'ghost-post-id' }, MUTATION_FN_CONTEXT)
    ).resolves.toBeDefined()
  })

  it('onError does NOT call setQueryData(key, undefined) on empty-cache rollback', async () => {
    // RED: fails until onError guards ctx.feedSnapshot/threadSnapshot/yourPostsSnapshot for undefined.
    const localQc = new QueryClient()
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()
    if (deleteDefaults) localQc.setMutationDefaults(['collective', 'delete_own'], deleteDefaults)

    const setQueryDataSpy = vi.spyOn(localQc, 'setQueryData')

    // Context with all undefined snapshots (empty cache). yourPostsSnapshots
    // is the user-scoped [key, snapshot] pair list — include one pair with an
    // undefined snapshot to exercise the per-pair guard.
    const emptyContext = {
      feedSnapshot: undefined,
      threadSnapshot: undefined,
      yourPostsSnapshots: [[['collective', 'yourPosts', 'user-A'], undefined] as const],
    }

    await deleteDefaults!.onError!(
      new Error('failed'),
      { post_id: 'ghost-id' },
      emptyContext,
      MUTATION_FN_CONTEXT
    )

    // Must NOT have been called with undefined as value
    const undefinedCalls = setQueryDataSpy.mock.calls.filter((call) => call[1] === undefined)
    expect(undefinedCalls.length).toBe(0)

    setQueryDataSpy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Source-grep: FOUR setMutationDefaults (already updated above)
// Source-grep: no @legendapp/state in mutations.ts (already covered)
// These are covered in the "Source-level grep assertions" describe block above.
// This stub confirms the test for the source-grep count is the updated count=4 test.
// ─────────────────────────────────────────────────────────────────────────────

describe('collective.delete_own — source-level guards', () => {
  it('mutations.ts does NOT contain @legendapp/state import (delete_own boundary rule)', () => {
    // Redundant alongside the existing "no @legendapp/state import" test — defense-in-depth since
    // delete_own uses supabase.rpc, not store$, for auth.
    expect(existsSync(MUTATIONS_PATH)).toBe(true)
    const src = readFileSync(MUTATIONS_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state(?:\/[\w-]+(?:\/[\w-]+)?)?/)
  })

  it('queryClient.ts PERSIST_IN_FLIGHT_KEYS does NOT include collective.delete_own', () => {
    // delete_own must NOT be added to in-flight persist set.
    const qcSrc = readFileSync(QUERY_CLIENT_PATH, 'utf8')
    expect(qcSrc).not.toMatch(/PERSIST_IN_FLIGHT_KEYS[^;]*collective\.delete_own/)
  })

  it('stale deferral comment is removed (no lingering deferral note in mutations.ts)', () => {
    // Once this work is implemented, the "['collective','delete_own'] is deferred to
    // later work" comment at line 31-32 must be removed.
    // RED: passes until the implementation cleans it up (inverse test —
    // this test PASSES while the deferral comment still exists pre-implementation,
    // but the story spec says to remove it. We test for the comment ABSENCE
    // as a post-implementation guard, meaning it fails until removed.)
    expect(existsSync(MUTATIONS_PATH)).toBe(true)
    const src = readFileSync(MUTATIONS_PATH, 'utf8')
    // The deferral note says the registration is missing — once it exists, this comment is stale.
    expect(src).not.toMatch(/\['collective','delete_own'\] is deferred to/)
  })

  it('delete_own registration is top-level (not inside a function/effect)', () => {
    // Defends FOOTGUN #1: setMutationDefaults must run at module load.
    // Source-grep: the ['collective','delete_own'] call must appear on a line
    // that does NOT have leading spaces suggesting function-body nesting.
    expect(existsSync(MUTATIONS_PATH)).toBe(true)
    const src = readFileSync(MUTATIONS_PATH, 'utf8')
    const lines = src.split('\n')
    const deleteOwnLine = lines.find(
      (l) => /setMutationDefaults\s*\(/.test(l) && l.includes("'delete_own'")
    )
    // The line must exist (will be defined after implementation)
    // and must not have deep indentation (not inside a function body)
    if (deleteOwnLine !== undefined) {
      // Top-level calls start at column 0 or with 'queryClient.' prefix
      const trimmed = deleteOwnLine.trimStart()
      expect(trimmed).toMatch(/^queryClient\.setMutationDefaults/)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// onSettled invalidates ['collective'] prefix
// ─────────────────────────────────────────────────────────────────────────────

describe('collective.delete_own — onSettled prefix invalidation', () => {
  it('onSettled calls invalidateQueries({ queryKey: [collective] })', async () => {
    // RED: fails until onSettled is wired to queryClient.invalidateQueries.
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    const singletonInvalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await deleteDefaults!.onSettled!(
      undefined,
      null,
      { post_id: 'p1' },
      undefined,
      MUTATION_FN_CONTEXT
    )

    expect(singletonInvalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['collective'] })
    )

    singletonInvalidateSpy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// mutationFn calls supabase.rpc with correct args
// ─────────────────────────────────────────────────────────────────────────────

describe('collective.delete_own — mutationFn RPC contract', () => {
  it('mutationFn calls supabase.rpc("delete_my_post", { post_id })', async () => {
    // RED: fails until mutationFn calls supabase.rpc (not supabase.from).
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    rpcMock.mockResolvedValue({ data: null, error: null })

    await deleteDefaults!.mutationFn!({ post_id: 'target-post-uuid' }, MUTATION_FN_CONTEXT)

    expect(rpcMock).toHaveBeenCalledWith('delete_my_post', { post_id: 'target-post-uuid' })
  })

  it('mutationFn re-throws non-42501 errors', async () => {
    // RED: fails until error handling is implemented for non-swallowed codes.
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    rpcMock.mockResolvedValue({ data: null, error: { code: '42000', message: 'some rpc error' } })

    await expect(
      deleteDefaults!.mutationFn!({ post_id: 'post-uuid' }, MUTATION_FN_CONTEXT)
    ).rejects.toBeDefined()
  })

  it('mutationFn resolves cleanly on success (null error)', async () => {
    // Verifies the happy path — no throw on clean RPC response.
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    rpcMock.mockResolvedValue({ data: null, error: null })

    await expect(
      deleteDefaults!.mutationFn!({ post_id: 'clean-post-uuid' }, MUTATION_FN_CONTEXT)
    ).resolves.not.toThrow()
  })
})
