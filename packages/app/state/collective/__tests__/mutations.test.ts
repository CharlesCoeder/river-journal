// @vitest-environment happy-dom
/**
 * Story 3-11 — TDD red-phase tests for the `useToggleReaction.onMutate` extension
 * that resolves the AC #10 deferral from Story 3-7.
 *
 * Red-phase contract: every test MUST fail until Story 3-11's Task 3 extends
 * `useToggleReaction.onMutate` in `packages/app/state/collective/mutations.ts`
 * to apply the optimistic toggle on the new ['collective','reactions',postId] cache,
 * and updates `ReactMutationContext` to include `reactionsSnapshot`.
 *
 * NOTE: This is a NEW file. It does NOT replace or collide with
 * `packages/app/state/__tests__/mutations.test.ts` (Story 3-7's 54-test suite).
 * This file lives at `packages/app/state/collective/__tests__/mutations.test.ts`.
 *
 * AC coverage (AC #8, #17):
 *   - t-new1: onMutate for toggle:'add' snapshots ['collective','reactions',postId]
 *             cache, increments count[kind] by 1, sets userReactions[kind] to vars.id.
 *   - t-new2: onMutate for toggle:'remove' snapshots cache, decrements count[kind]
 *             (clamp ≥ 0), clears userReactions[kind] to null.
 *   - t-new3: onError restores reactionsSnapshot AND prior feed/thread snapshots;
 *             never calls setQueryData with undefined (AC #31 from Story 3-7).
 *   - t-new4: onSettled invalidates ['collective'] prefix (existing behavior preserved).
 *
 * Mocking strategy: vi.hoisted() for supabase mocks; mirrors the Story 3-7
 * mutations.test.ts pattern.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient, type InfiniteData } from '@tanstack/react-query'

// ─── Supabase mock — hoisted before SUT import ───────────────────────────────
const { insertMock, deleteMock, eqMock, fromMock } = vi.hoisted(() => {
  const insertMock = vi.fn()
  const deleteMock = vi.fn()
  const eqMock = vi.fn()
  const fromMock = vi.fn()
  return { insertMock, deleteMock, eqMock, fromMock }
})

vi.mock('app/utils/supabase', () => ({
  supabase: {
    from: fromMock,
  },
}))

// ─── Mock Legend-State and store (feed.ts side-effects) ─────────────────────
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

// ─── SUT imports — after mocks are hoisted ───────────────────────────────────
// Importing mutations.ts triggers setMutationDefaults at module load, registering
// the collective.react defaults on the shared queryClient singleton before tests run.
import 'app/state/collective/mutations'
import { queryClient } from 'app/state/queryClient'
import { collectiveFeedKey, type FeedPage, type Post } from 'app/state/collective/feed'
import { collectiveThreadKey, type ThreadPageResult } from 'app/state/collective/thread'
import { yourPostsKey, type YourPost, type YourPostsPage } from 'app/state/collective/yourPosts'

// ─── Types for the new reactions cache shape ─────────────────────────────────
// These imports will fail until Story 3-11 creates state/collective/reactions.ts
// and state/collective/types.ts. That's the expected red-phase failure signal.
import { collectiveReactionsKey } from 'app/state/collective/reactions'
import type { ReactionKind } from 'app/state/collective/types'

// TanStack Query v5.100: mutation lifecycle callbacks take a trailing
// MutationFunctionContext. Tests invoke the registered defaults manually, so
// supply a minimal context. The registered impls ignore it.
const MUTATION_FN_CONTEXT = { client: queryClient, meta: undefined }

type ReactionCounts = Record<ReactionKind, number>
type UserReactions = Record<ReactionKind, string | null>
type ReactionsCache = { counts: ReactionCounts; userReactions: UserReactions }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyReactionsCache(): ReactionsCache {
  return {
    counts: { heart: 0, sparkle: 0, flame: 0, leaf: 0, wave: 0 },
    userReactions: { heart: null, sparkle: null, flame: null, leaf: null, wave: null },
  }
}

function makeFeedPage(posts: Partial<Post>[] = []): FeedPage {
  return { items: posts as Post[], mode: 'full', nextCursor: null }
}

function makeInfiniteData<T>(pages: T[]): InfiniteData<T> {
  return {
    pages,
    pageParams: pages.map((_, i) => (i === 0 ? null : `cursor-${i}`)),
  }
}

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-1',
    body: 'hello',
    parent_post_id: null,
    user_id: 'user-1',
    created_at: '2026-05-06T00:00:00.000Z',
    updated_at: '2026-05-06T00:00:00.000Z',
    is_removed: false,
    is_user_deleted: false,
    removed_at: null,
    removed_reason: null,
    user_deleted_at: null,
    mode: 'full',
    ...overrides,
  } as Post
}

beforeEach(() => {
  eqMock.mockResolvedValue({ data: [], error: null })
  deleteMock.mockReturnValue({ eq: eqMock })
  insertMock.mockResolvedValue({ data: [], error: null })
  fromMock.mockReturnValue({ insert: insertMock, delete: deleteMock })
  queryClient.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════════
// t-new1 — onMutate toggle:'add' snapshots reactions cache + applies optimistic update
// ═══════════════════════════════════════════════════════════════════════════════

describe('Story 3-11 / useToggleReaction.onMutate — AC #10 resolution (t-new1): toggle:add', () => {
  it('snapshots the reactions cache before modifying it', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults, 'collective.react defaults must be registered').toBeDefined()

    const POST_ID = 'post-r1'
    const seed = emptyReactionsCache()
    seed.counts.heart = 1
    queryClient.setQueryData(collectiveReactionsKey(POST_ID), seed)

    const vars = {
      id: 'rxn-new-uuid',
      post_id: POST_ID,
      kind: 'heart' as ReactionKind,
      user_id: 'user-1',
      toggle: 'add' as const,
    }

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    const context = await reactDefaults!.onMutate!(vars, MUTATION_FN_CONTEXT)

    // Context must include reactionsSnapshot
    const ctx = context as { reactionsSnapshot?: ReactionsCache }
    expect(ctx.reactionsSnapshot).toBeDefined()
    // Snapshot should have the PRE-update count (1, not 2)
    expect(ctx.reactionsSnapshot!.counts.heart).toBe(1)
    // Snapshot should have pre-update userReactions (null, not 'rxn-new-uuid')
    expect(ctx.reactionsSnapshot!.userReactions.heart).toBeNull()
  })

  it('increments counts[kind] by 1 in the reactions cache after toggle:add', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    const POST_ID = 'post-r2'
    const seed = emptyReactionsCache()
    seed.counts.flame = 2
    queryClient.setQueryData(collectiveReactionsKey(POST_ID), seed)

    const vars = {
      id: 'rxn-uuid-flame',
      post_id: POST_ID,
      kind: 'flame' as ReactionKind,
      user_id: 'user-1',
      toggle: 'add' as const,
    }

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    await reactDefaults!.onMutate!(vars, MUTATION_FN_CONTEXT)

    const after = queryClient.getQueryData<ReactionsCache>(collectiveReactionsKey(POST_ID))
    expect(after).toBeDefined()
    expect(after!.counts.flame).toBe(3)
  })

  it('sets userReactions[kind] to vars.id in the reactions cache after toggle:add', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    const POST_ID = 'post-r3'
    const seed = emptyReactionsCache()
    queryClient.setQueryData(collectiveReactionsKey(POST_ID), seed)

    const vars = {
      id: 'rxn-uuid-sparkle',
      post_id: POST_ID,
      kind: 'sparkle' as ReactionKind,
      user_id: 'user-1',
      toggle: 'add' as const,
    }

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    await reactDefaults!.onMutate!(vars, MUTATION_FN_CONTEXT)

    const after = queryClient.getQueryData<ReactionsCache>(collectiveReactionsKey(POST_ID))
    expect(after!.userReactions.sparkle).toBe('rxn-uuid-sparkle')
  })

  it('preserves feedSnapshot in context (existing Story 3-7 contract preserved)', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    const POST_ID = 'post-r4'
    const feedPost = makePost({ id: POST_ID })
    queryClient.setQueryData(collectiveFeedKey, makeInfiniteData([makeFeedPage([feedPost])]))

    const vars = {
      id: 'rxn-uuid',
      post_id: POST_ID,
      kind: 'heart' as ReactionKind,
      user_id: 'u1',
      toggle: 'add' as const,
    }

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    const context = await reactDefaults!.onMutate!(vars, MUTATION_FN_CONTEXT)

    const ctx = context as { feedSnapshot?: unknown; threadSnapshot?: unknown; reactionsSnapshot?: unknown }
    expect(ctx.feedSnapshot).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// t-new2 — onMutate toggle:'remove' snapshots + decrements count + clears userReactions
// ═══════════════════════════════════════════════════════════════════════════════

describe('Story 3-11 / useToggleReaction.onMutate — AC #10 resolution (t-new2): toggle:remove', () => {
  it('decrements counts[kind] by 1 after toggle:remove', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    const POST_ID = 'post-rm1'
    const seed = emptyReactionsCache()
    seed.counts.leaf = 3
    seed.userReactions.leaf = 'rxn-existing-id'
    queryClient.setQueryData(collectiveReactionsKey(POST_ID), seed)

    const vars = {
      id: 'rxn-existing-id',
      post_id: POST_ID,
      kind: 'leaf' as ReactionKind,
      user_id: 'user-1',
      toggle: 'remove' as const,
    }

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    await reactDefaults!.onMutate!(vars, MUTATION_FN_CONTEXT)

    const after = queryClient.getQueryData<ReactionsCache>(collectiveReactionsKey(POST_ID))
    expect(after).toBeDefined()
    expect(after!.counts.leaf).toBe(2)
  })

  it('clears userReactions[kind] to null after toggle:remove', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    const POST_ID = 'post-rm2'
    const seed = emptyReactionsCache()
    seed.counts.wave = 1
    seed.userReactions.wave = 'rxn-wave-id'
    queryClient.setQueryData(collectiveReactionsKey(POST_ID), seed)

    const vars = {
      id: 'rxn-wave-id',
      post_id: POST_ID,
      kind: 'wave' as ReactionKind,
      user_id: 'user-1',
      toggle: 'remove' as const,
    }

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    await reactDefaults!.onMutate!(vars, MUTATION_FN_CONTEXT)

    const after = queryClient.getQueryData<ReactionsCache>(collectiveReactionsKey(POST_ID))
    expect(after!.userReactions.wave).toBeNull()
  })

  it('clamps count at 0 when decrementing below zero (defensive)', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    const POST_ID = 'post-rm3'
    const seed = emptyReactionsCache()
    seed.counts.heart = 0 // already zero — remove should not produce negative
    queryClient.setQueryData(collectiveReactionsKey(POST_ID), seed)

    const vars = {
      id: 'rxn-stale',
      post_id: POST_ID,
      kind: 'heart' as ReactionKind,
      user_id: 'user-1',
      toggle: 'remove' as const,
    }

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    await reactDefaults!.onMutate!(vars, MUTATION_FN_CONTEXT)

    const after = queryClient.getQueryData<ReactionsCache>(collectiveReactionsKey(POST_ID))
    expect(after!.counts.heart).toBeGreaterThanOrEqual(0)
  })

  it('snapshots the reactions cache before decrementing', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    const POST_ID = 'post-rm4'
    const seed = emptyReactionsCache()
    seed.counts.sparkle = 5
    seed.userReactions.sparkle = 'rxn-sparkle-snap'
    queryClient.setQueryData(collectiveReactionsKey(POST_ID), seed)

    const vars = {
      id: 'rxn-sparkle-snap',
      post_id: POST_ID,
      kind: 'sparkle' as ReactionKind,
      user_id: 'user-1',
      toggle: 'remove' as const,
    }

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    const context = await reactDefaults!.onMutate!(vars, MUTATION_FN_CONTEXT)

    const ctx = context as { reactionsSnapshot?: ReactionsCache }
    expect(ctx.reactionsSnapshot).toBeDefined()
    // Snapshot reflects pre-decrement state
    expect(ctx.reactionsSnapshot!.counts.sparkle).toBe(5)
    expect(ctx.reactionsSnapshot!.userReactions.sparkle).toBe('rxn-sparkle-snap')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// t-new3 — onError restores reactionsSnapshot + prior feed/thread snapshots
//           Never calls setQueryData with undefined (AC #31)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Story 3-11 / useToggleReaction.onError — reactions rollback (t-new3)', () => {
  it('restores reactions cache to snapshot on error', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    const POST_ID = 'post-err1'
    const original = emptyReactionsCache()
    original.counts.heart = 3
    original.userReactions.heart = 'rxn-orig'
    queryClient.setQueryData(collectiveReactionsKey(POST_ID), original)

    const vars = {
      id: 'rxn-new',
      post_id: POST_ID,
      kind: 'heart' as ReactionKind,
      user_id: 'user-1',
      toggle: 'add' as const,
    }

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    const context = await reactDefaults!.onMutate!(vars, MUTATION_FN_CONTEXT)

    // Verify optimistic update was applied
    const afterOptimistic = queryClient.getQueryData<ReactionsCache>(collectiveReactionsKey(POST_ID))
    expect(afterOptimistic!.counts.heart).toBe(4)

    // Simulate error — should rollback
    await reactDefaults!.onError!(new Error('failed'), vars, context, MUTATION_FN_CONTEXT)

    const afterRollback = queryClient.getQueryData<ReactionsCache>(collectiveReactionsKey(POST_ID))
    expect(afterRollback!.counts.heart).toBe(3)
    expect(afterRollback!.userReactions.heart).toBe('rxn-orig')
  })

  it('does NOT call setQueryData(key, undefined) when reactionsSnapshot is undefined (AC #31)', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    const localQc = new QueryClient()
    if (reactDefaults) localQc.setMutationDefaults(['collective', 'react'], reactDefaults)

    const setQueryDataSpy = vi.spyOn(localQc, 'setQueryData')

    // Simulate context where reactionsSnapshot is undefined (cold cache — no reaction data)
    const ctx = {
      feedSnapshot: undefined,
      threadSnapshot: undefined,
      reactionsSnapshot: undefined,
    }

    const vars = {
      id: 'rxn-x',
      post_id: 'post-cold',
      kind: 'heart' as ReactionKind,
      user_id: 'u1',
      toggle: 'add' as const,
    }

    await reactDefaults!.onError!(new Error('failed'), vars, ctx, MUTATION_FN_CONTEXT)

    // Must NOT have called setQueryData with undefined as the value argument
    const undefinedCalls = setQueryDataSpy.mock.calls.filter((call) => call[1] === undefined)
    expect(undefinedCalls.length).toBe(0)
  })

  it('still restores feedSnapshot on error (existing Story 3-7 contract preserved)', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    const POST_ID = 'post-err3'
    const feedPost = makePost({ id: POST_ID })
    queryClient.setQueryData(collectiveFeedKey, makeInfiniteData([makeFeedPage([feedPost])]))

    const vars = {
      id: 'rxn-y',
      post_id: POST_ID,
      kind: 'flame' as ReactionKind,
      user_id: 'u1',
      toggle: 'add' as const,
    }

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    const context = await reactDefaults!.onMutate!(vars, MUTATION_FN_CONTEXT)

    // After onMutate feed snapshot should be preserved
    const ctx = context as { feedSnapshot?: unknown }
    expect(ctx.feedSnapshot).toBeDefined()

    // Spy to assert setQueryData is called with the snapshot
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData')
    await reactDefaults!.onError!(new Error('fail'), vars, context, MUTATION_FN_CONTEXT)

    const feedRestoreCalls = setQueryDataSpy.mock.calls.filter(
      (call) => JSON.stringify(call[0]) === JSON.stringify(collectiveFeedKey)
    )
    expect(feedRestoreCalls.length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// t-new4 — onSettled still invalidates ['collective'] prefix (AC #17)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Story 3-11 / useToggleReaction.onSettled — invalidation preserved (t-new4)', () => {
  it('onSettled fires invalidateQueries with [collective] prefix after the extension', async () => {
    const reactDefaults = queryClient.getMutationDefaults(['collective', 'react'])
    expect(reactDefaults).toBeDefined()

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await reactDefaults!.onSettled!(
      undefined,
      null,
      {
        id: 'rxn-settled',
        post_id: 'post-settled',
        kind: 'heart' as ReactionKind,
        user_id: 'u1',
        toggle: 'add' as const,
      },
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
// Story 3-15 — title in the create-post path + title-led optimistic feed row +
// delete_own feed-cache no-body (AC #27)
// ═══════════════════════════════════════════════════════════════════════════════

function makeYourPost(overrides: Partial<YourPost> = {}): YourPost {
  return {
    id: 'post-1',
    user_id: 'user-1',
    parent_post_id: null,
    title: 'my title',
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

// Loosely-typed callback invoker: the resolved MutationDefaults callbacks are
// typed with broader arities than a direct call supplies, so we cast through a
// permissive function type (test-only) to invoke them with our literal vars.
type AnyFn = (...args: any[]) => any

describe('Story 3-15 / useCreatePost insert payload carries title (AC #27a)', () => {
  it('passes a top-level title through to the insert', async () => {
    const postDefaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(postDefaults).toBeDefined()

    await (postDefaults!.mutationFn as AnyFn)({
      id: 'p-title',
      body: 'a body',
      title: 'A real letter title',
      parent_post_id: null,
      user_id: 'user-1',
    })

    expect(fromMock).toHaveBeenCalledWith('collective_posts')
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p-title', title: 'A real letter title' })
    )
  })

  it('inserts title: null when the reply caller omits title', async () => {
    const postDefaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(postDefaults).toBeDefined()

    await (postDefaults!.mutationFn as AnyFn)({
      id: 'reply-1',
      body: 'a reply body',
      parent_post_id: 'parent-1',
      user_id: 'user-1',
    })

    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ title: null }))
  })
})

describe('Story 3-15 / optimistic feed row is title-led, no body (AC #27b)', () => {
  it('inserts an optimistic feed row with title/excerpt/descendant_count/reactions and NO body', async () => {
    const postDefaults = queryClient.getMutationDefaults(['collective', 'post'])
    expect(postDefaults).toBeDefined()

    // Seed an empty feed page so the optimistic row is prepended.
    queryClient.setQueryData(collectiveFeedKey, makeInfiniteData([makeFeedPage([])]))

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    await (postDefaults!.onMutate as AnyFn)({
      id: 'opt-1',
      body: 'full body that should NOT land in the feed cache',
      title: 'Optimistic title',
      parent_post_id: null,
      user_id: 'user-1',
    })

    const feed = queryClient.getQueryData<InfiniteData<FeedPage>>(collectiveFeedKey)
    const row = feed!.pages[0]!.items[0] as Record<string, unknown>
    expect(row.id).toBe('opt-1')
    expect(row.title).toBe('Optimistic title')
    expect(row.excerpt).toBe('')
    expect(row.descendant_count).toBe(0)
    expect(row.reactions).toEqual({})
    expect(row.__optimistic).toBe(true)
    // The feed cache must NOT carry a full body (Story 3-15 D5).
    expect('body' in row).toBe(false)
  })
})

describe('Story 3-15 / delete_own feed-cache update omits body (AC #27c)', () => {
  const POST_ID = 'del-1'

  it('feed cache: sets is_user_deleted + user_deleted_at but does NOT write body', async () => {
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    // Seed a feed row. makePost yields a runtime `body` (a pre-3-15 leftover in
    // the helper), so if the feed branch wrongly wrote body it WOULD become
    // '[deleted]'. We assert it does NOT.
    queryClient.setQueryData(
      collectiveFeedKey,
      makeInfiniteData([makeFeedPage([makePost({ id: POST_ID })])])
    )

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    await (deleteDefaults!.onMutate as AnyFn)({ post_id: POST_ID })

    const row = queryClient.getQueryData<InfiniteData<FeedPage>>(collectiveFeedKey)!.pages[0]!
      .items[0] as Record<string, unknown>
    expect(row.is_user_deleted).toBe(true)
    expect(row.user_deleted_at).not.toBeNull()
    // The feed branch must NOT stamp '[deleted]' onto a body field.
    expect(row.body).not.toBe('[deleted]')
  })

  it('thread + yourPosts caches still write body: "[deleted]"', async () => {
    const deleteDefaults = queryClient.getMutationDefaults(['collective', 'delete_own'])
    expect(deleteDefaults).toBeDefined()

    // Cast: makePost yields a feed `Post` (no `body` in its type), but the
    // thread cache holds `ThreadPost` (which has `body`). The runtime object
    // carries a `body` field, so this faithfully simulates a seeded thread row.
    const threadData = {
      pages: [{ items: [makePost({ id: POST_ID, parent_post_id: 'root' })], mode: 'full', nextCursor: null }],
      pageParams: [null],
    } as unknown as InfiniteData<ThreadPageResult>
    queryClient.setQueryData(collectiveThreadKey(POST_ID), threadData)

    const yourData: InfiniteData<YourPostsPage> = {
      pages: [{ items: [makeYourPost({ id: POST_ID })], nextCursor: null }],
      pageParams: [null],
    }
    queryClient.setQueryData(yourPostsKey, yourData)

    await queryClient.cancelQueries({ queryKey: ['collective'] })
    await (deleteDefaults!.onMutate as AnyFn)({ post_id: POST_ID })

    const threadRow = queryClient.getQueryData<InfiniteData<ThreadPageResult>>(
      collectiveThreadKey(POST_ID)
    )!.pages[0]!.items[0]!
    expect(threadRow.body).toBe('[deleted]')
    expect(threadRow.is_user_deleted).toBe(true)

    const yourRow = queryClient.getQueryData<InfiniteData<YourPostsPage>>(yourPostsKey)!.pages[0]!
      .items[0]!
    expect(yourRow.body).toBe('[deleted]')
    expect(yourRow.is_user_deleted).toBe(true)
  })
})
