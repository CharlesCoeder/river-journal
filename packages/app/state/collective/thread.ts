// packages/app/state/collective/thread.ts
//
// Story 3-4 — TanStack Query thread hook for the Collective domain.
//
// This module exports the `useThread(postId, { role })` hook plus the pure
// `fetchThreadPage` function that powers it. Consumers (the upcoming
// ThreadView surface) recurse the forest by mounting one `useThread` per
// expanded subtree — this hook does NOT walk the tree.
//
// Boundary rule (D7): this file MUST NOT import the Legend-State package.
// The streak-cross-500 cache-invalidation observe block is the narrow
// exception that lives in `feed.ts` ONLY. Thread caches are invalidated
// transitively because `['collective']` is a prefix of
// `['collective', 'thread', postId]`.

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { supabase } from 'app/utils/supabase'
import type { Database } from 'app/types/database'
import type { Post } from './feed'

// Re-export the canonical Post type for consumer ergonomics. The
// declaration lives in `feed.ts` (Story 3-3 landed first); this file
// imports it to enforce a single source of truth across feed/thread.
export type { Post }

/**
 * ThreadPost — the per-row shape returned by `collective_thread_page`.
 * Unlike the feed's `Post` type, ThreadPost includes `descendant_count`
 * (added in Story 3-10 via Pattern B recursive CTE). ThreadView imports
 * this type rather than `Post` for correct type-checking.
 *
 * Story 3-15: ThreadPost now also carries `title`. It auto-derives from the
 * RPC `Returns`, which always emits `NULL` for replies (guaranteed by the
 * polarised `collective_posts_title_chk` CHECK) — so no manual `title: null`
 * mapping is needed anywhere; replies are always `title: null` by CHECK.
 */
export type ThreadPost = Database['public']['Functions']['collective_thread_page']['Returns'][number]

/**
 * ThreadRoot — the single root row returned by `collective_thread_root`
 * (Story 3-15). This is the body source for the thread view now that the
 * feed RPC dropped full `body`. Carries `title` + full `body` +
 * `descendant_count` + `reactions` tally + `mode`.
 */
export type ThreadRoot = Database['public']['Functions']['collective_thread_root']['Returns'][number]

/**
 * Page size for thread reply pagination. Matches the feed page size; the
 * server clamps `page_size` to 50. We request `PAGE_SIZE + 1` rows on
 * every page to detect "has more" without a separate count query.
 */
export const PAGE_SIZE = 20

/**
 * The canonical query key for a thread rooted at `postId`. The shape
 * `['collective', 'thread', postId]` lets the broader `['collective']`
 * prefix invalidation (fired from `feed.ts`'s streak-cross-500 observe
 * block in Story 3-3) drop every thread cache transitively.
 */
export function collectiveThreadKey(postId: string) {
  return ['collective', 'thread', postId] as const
}

/**
 * Query key for a thread's ROOT row (Story 3-15). Nested UNDER the thread key
 * (`['collective', 'thread', postId, 'root']`) so the existing `['collective']`
 * prefix invalidation — fired from `feed.ts`'s streak-cross-500 observe and
 * from every mutation's `onSettled` — drops it transitively, with no new
 * invalidation wiring.
 */
export function collectiveThreadRootKey(postId: string) {
  return ['collective', 'thread', postId, 'root'] as const
}

export interface ThreadPageResult {
  items: ThreadPost[]
  mode: 'full' | 'preview'
  nextCursor: string | null
}

/**
 * Pure async fetcher for one page of thread replies. Exported separately
 * from the hook so it can be unit-tested in isolation.
 *
 * Calls `supabase.rpc('collective_thread_page', { post_id, cursor,
 * page_size: PAGE_SIZE + 1 })`. The +1 row is dropped if present, with
 * `nextCursor` surfaced from the new last item. When the RPC returns
 * `mode: 'preview'`, `nextCursor` is forced to `null` UNCONDITIONALLY and
 * `items` is clamped to the first 3 rows (defense-in-depth against any
 * future server regression that would over-return preview rows).
 *
 * On RPC error the function re-throws an `Error` carrying the supabase
 * error message — TanStack Query's standard retry/error contract takes
 * over from there.
 */
export async function fetchThreadPage(
  postId: string,
  cursor: string | null
): Promise<ThreadPageResult> {
  const { data, error } = await supabase.rpc('collective_thread_page', {
    post_id: postId,
    cursor,
    page_size: PAGE_SIZE + 1,
  })

  if (error) {
    throw new Error(error.message)
  }

  const rows = (data ?? []) as ThreadPost[]
  const mode: 'full' | 'preview' = rows[0]?.mode ?? 'full'

  if (mode === 'preview') {
    // Preview gate is unbypassable: clamp to 3 rows and never paginate.
    return {
      items: rows.slice(0, 3),
      mode: 'preview',
      nextCursor: null,
    }
  }

  // Full mode: standard +1 trim + hasMore detection.
  if (rows.length > PAGE_SIZE) {
    const trimmed = rows.slice(0, PAGE_SIZE)
    return {
      items: trimmed,
      mode: 'full',
      nextCursor: trimmed[trimmed.length - 1]!.created_at,
    }
  }

  return {
    items: rows,
    mode: 'full',
    nextCursor: null,
  }
}

/**
 * `useThread(postId, { role })` — the TanStack Query infinite-query hook
 * for a thread rooted at any post id (top-level thread root or focused
 * subthread root; structurally identical).
 *
 * Memory bound (NFR31): worst-case in-memory footprint is
 *   `(open expansion count) × maxPages × PAGE_SIZE`
 * = `open_expansions × 5 × 20`
 * = `open_expansions × 100 posts`.
 *
 * The 5-minute `gcTime` on `'expansion'` instances caps how long
 * collapsed-but-not-yet-evicted expansions persist in the cache. The
 * load-bearing UX rule that makes this bound hold: ThreadView (Story
 * 3-10) MUST mount expansions lazily — only when the user expands a
 * subtree. NEVER auto-walk the tree.
 *
 * Role semantics:
 *   - `'expansion'` → `gcTime: 5 * 60_000` (5 min). Caps inline-expansion
 *     persistence so a user who collapses a sub-tree does not pay the
 *     memory cost indefinitely.
 *   - `'root'` → `gcTime: 24 * 60 * 60_000` (24 h). Back-button restore
 *     of a thread the user just navigated into is high-value UX.
 */
export function useThread(
  postId: string,
  { role }: { role: 'root' | 'expansion' }
) {
  return useInfiniteQuery<
    ThreadPageResult,
    Error,
    { pages: ThreadPageResult[]; pageParams: (string | null)[] },
    ReturnType<typeof collectiveThreadKey>,
    string | null
  >({
    queryKey: collectiveThreadKey(postId),
    queryFn: ({ pageParam }) => fetchThreadPage(postId, pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    maxPages: 5,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 25_000,
    gcTime: role === 'expansion' ? 5 * 60_000 : 24 * 60 * 60_000,
  })
}

/**
 * Pure async fetcher for a thread's root row (Story 3-15). Calls
 * `supabase.rpc('collective_thread_root', { post_id })`, throws on RPC error,
 * and returns `data?.[0] ?? null`. A `null` return is the removed/not-found
 * case (AC 11) — the RPC returns zero rows when the root is moderator-removed
 * or absent — so the consumer renders a removed/not-found state rather than an
 * error boundary. Exported separately so it is unit-testable in isolation.
 */
export async function fetchThreadRoot(postId: string): Promise<ThreadRoot | null> {
  const { data, error } = await supabase.rpc('collective_thread_root', {
    post_id: postId,
  })

  if (error) {
    throw new Error(error.message)
  }

  return data?.[0] ?? null
}

/**
 * `useThreadRoot(postId)` — single-row `useQuery` (NOT infinite) for a thread's
 * root. Calm cadence matching `useThread`'s `'root'` role: `staleTime` (25s) <
 * `refetchInterval` (30s) so refetches fire; `gcTime` 24h because back-button
 * restore of a thread the user just opened is high-value. Do NOT poll faster
 * than 30s. The key nests under the thread key so `['collective']` invalidation
 * drops it transitively.
 */
export function useThreadRoot(postId: string) {
  return useQuery({
    queryKey: collectiveThreadRootKey(postId),
    queryFn: () => fetchThreadRoot(postId),
    staleTime: 25_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    gcTime: 24 * 60 * 60_000,
  })
}
