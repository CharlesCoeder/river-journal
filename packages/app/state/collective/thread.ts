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

import { useInfiniteQuery } from '@tanstack/react-query'
import { supabase } from 'app/utils/supabase'
import type { Post } from './feed'

// Re-export the canonical Post type for consumer ergonomics. The
// declaration lives in `feed.ts` (Story 3-3 landed first); this file
// imports it to enforce a single source of truth across feed/thread.
export type { Post }

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

export interface ThreadPageResult {
  items: Post[]
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

  const rows = (data ?? []) as Post[]
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
