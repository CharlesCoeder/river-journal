// packages/app/state/collective/yourPosts.ts
//
// TanStack Query hook for the calling user's own Collective posts.
//
// Surface:
//   - `yourPostsKey`         canonical query-key tuple
//   - `PAGE_SIZE`            page-size constant (NFR31 budget regression sentinel)
//   - `YourPost` / `YourPostsPage` row + page shapes
//   - `fetchYourPostsPage()` pure async fetcher (look-ahead pagination)
//   - `useYourPosts()`       useInfiniteQuery wrapper (calm-realtime cadence)
//
// Boundary rule (D7): this file is on the TanStack Query side of the v2
// architecture split and must remain free of Legend-State imports. The
// narrow observe() exception that lives in `feed.ts` does NOT extend here
// — own-posts visibility is unaffected by today's word count.

import { useInfiniteQuery } from '@tanstack/react-query'
import { supabase } from 'app/utils/supabase'

/**
 * Canonical query-key PREFIX for the user's own posts. `as const` preserves
 * the literal-tuple type so `queryClient.invalidateQueries({ queryKey:
 * ['collective'] })` from mutations matches by prefix.
 *
 * NOTE (cross-user defense): the ACTUAL query key is user-scoped — see
 * `yourPostsKeyForUser()`. Mutations that walk this cache must use prefix
 * matching (`queryClient.getQueriesData({ queryKey: yourPostsKey })`), never
 * exact `getQueryData(yourPostsKey)`.
 */
export const yourPostsKey = ['collective', 'yourPosts'] as const

/**
 * User-scoped query key for the calling user's own posts. Own-post rows are
 * account-specific (full bodies, unlike the feed's excerpts), so the key
 * embeds the user id — a stale persisted cache hydrated after an account
 * switch can then never serve user A's rows to user B, even if the sign-out
 * cache purge was skipped (e.g. crash mid-sign-out).
 */
export const yourPostsKeyForUser = (userId: string) => [...yourPostsKey, userId] as const

/**
 * Page size for the user's own posts pagination. The look-ahead idiom
 * requests `PAGE_SIZE + 1` rows on every page to detect "has more" without
 * a separate count query. Combined with `maxPages: 5` in `useYourPosts()`,
 * this caps in-memory rows at 100 (NFR31 budget).
 */
export const PAGE_SIZE = 20

/**
 * Row shape returned by `collective_your_posts_page`. `mode` is narrowed
 * to the literal `'full'` because this RPC has no preview branch (the
 * 500-words gate does not apply to a user reading their own posts).
 * Forward-compatible with the `'preview' | 'full'` union used by feed/thread
 * because `'full'` is a member of that union.
 */
export type YourPost = {
  id: string
  user_id: string
  parent_post_id: string | null
  // Story 3-15: top-level own posts carry their title; reply-type own posts
  // are NULL (guaranteed by the collective_posts_title_chk CHECK).
  title: string | null
  body: string
  created_at: string
  is_removed: boolean
  is_user_deleted: boolean
  user_deleted_at: string | null
  reaction_count: number
  descendant_count: number
  tenure_tier: 30 | 100 | 365 | null
  mode: 'full'
}

export type YourPostsPage = {
  items: YourPost[]
  nextCursor: string | null
}

/**
 * Pure async fetcher for one page of the user's own posts.
 *
 * The "+1 row" look-ahead idiom: request PAGE_SIZE+1 rows; if we got back
 * exactly that many, there's another page — drop the extra row and surface
 * the LAST visible row's `created_at` as `nextCursor`. If we got back
 * `<= PAGE_SIZE` rows, this is the last page (`nextCursor: null`).
 */
export async function fetchYourPostsPage(
  cursor: string | null
): Promise<YourPostsPage> {
  const { data, error } = await supabase.rpc('collective_your_posts_page', {
    cursor,
    page_size: PAGE_SIZE + 1,
  })
  if (error) throw error
  const rows = (data ?? []) as YourPost[]
  const hasMore = rows.length > PAGE_SIZE
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  // hasMore ⇒ rows.length > PAGE_SIZE, so index PAGE_SIZE-1 is always present.
  const nextCursor = hasMore ? rows[PAGE_SIZE - 1]!.created_at : null
  return { items, nextCursor }
}

/**
 * `useInfiniteQuery` wrapper for the calling user's own posts.
 *
 * `currentUserId` comes from the caller (`useCurrentUserId()` at the screen
 * level) so this module stays free of extra hook dependencies. Semantics:
 *   - `undefined` — session still resolving → query disabled (no fetch under
 *     a placeholder key, no flash of another user's hydrated cache).
 *   - `null` — signed out → disabled (the RPC requires auth anyway).
 *   - string — enabled, keyed under `yourPostsKeyForUser(userId)`.
 *
 * Config rationale:
 *   - `maxPages: 5` × `PAGE_SIZE: 20` = 100 in-memory cap (NFR31).
 *   - `staleTime: 25_000` < `refetchInterval: 30_000` — calm-realtime
 *     cadence (staleTime must be < refetchInterval for refetches to fire).
 *   - `gcTime` defaults to the global 24h — back-button-restore matters.
 *   - No mutationKey here; `useDeleteOwnPost` (Story 3.13) reaches this
 *     hook by invalidating the broader `['collective']` prefix.
 */
export function useYourPosts(currentUserId: string | null | undefined) {
  return useInfiniteQuery({
    queryKey: yourPostsKeyForUser(currentUserId ?? 'signed-out'),
    queryFn: ({ pageParam }) => fetchYourPostsPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: YourPostsPage) => lastPage.nextCursor,
    maxPages: 5,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 25_000,
    enabled: typeof currentUserId === 'string',
  })
}
