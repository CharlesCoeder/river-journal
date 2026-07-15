// packages/app/state/collective/exportPosts.ts
//
// Cursor-paginated read of the calling user's OWN Collective posts for a full
// data-portability export. Unlike the feed / `collective_your_posts_page`
// reads, this path deliberately includes moderator-removed and self-deleted
// rows (with body + title) — it is the owner exporting their own content.
//
// Boundary rule (D7): this file is on the TanStack Query side of the v2
// architecture split. It MAY import `supabase` (like `yourPosts.ts` /
// `moderationReceipts.ts`) but MUST NOT import Legend-State (`@legendapp/state`
// / `use$`). The pure Markdown formatter and the export orchestrator live in
// `utils/exportCollectivePosts.ts`, which stays supabase-free by having the
// page-fetcher below injected into it.

import { supabase } from 'app/utils/supabase'

/**
 * Row shape returned by `collective_export_page`. Mirrors `YourPost` but adds
 * `removed_reason` / `removed_at` (so the export can render a moderation
 * marker) and drops the UI-only `tenure_tier` / `mode` fields. `user_id` is
 * non-null — the RPC filters to `WHERE user_id = auth.uid()`.
 */
export type CollectiveExportRow = {
  id: string
  user_id: string
  parent_post_id: string | null
  // Top-level posts carry a title; reply-type posts are NULL (guaranteed by
  // the collective_posts_title_chk CHECK).
  title: string | null
  body: string
  created_at: string
  is_removed: boolean
  is_user_deleted: boolean
  user_deleted_at: string | null
  removed_reason: string | null
  removed_at: string | null
  reaction_count: number
  descendant_count: number
}

/**
 * Composite keyset cursor: `(createdAt, id)`. `created_at` alone is NOT unique
 * (a transaction-stable NOW() default and a client-settable created_at both
 * produce realistic ties), so paginating on it with a strict `<` would silently
 * drop rows sharing the boundary timestamp — data loss in a data-portability
 * export. The `id` tiebreak makes the key a total order: every row is returned
 * exactly once. Mirrors the RPC's `(created_at, id)` keyset.
 */
export type CollectiveExportCursor = {
  createdAt: string
  id: string
}

export type CollectiveExportPage = {
  items: CollectiveExportRow[]
  nextCursor: CollectiveExportCursor | null
}

/**
 * Page size for the export pagination. The look-ahead idiom requests
 * `PAGE_SIZE + 1` rows per page to detect "has more" without a count query, so
 * `PAGE_SIZE + 1` MUST stay within `collective_export_page`'s hard ceiling of
 * 50 — otherwise the server would clamp the extra look-ahead row away and the
 * loop could never detect a further page. 49 maximizes the page while keeping
 * `PAGE_SIZE + 1 = 50` at (not over) the ceiling. There is intentionally NO
 * `maxPages` cap on the export loop (see `fetchAllExportPosts`) — the whole
 * history must be covered — so this constant is not tied to an in-memory
 * budget the way `yourPosts.ts`'s `PAGE_SIZE = 20` is.
 */
export const PAGE_SIZE = 49

/**
 * Pause (ms) handed back to the event loop between pages, so a large history
 * export never blocks the UI for more than roughly a frame.
 */
const PAGE_YIELD_MS = 0

/** Hand the main thread back between pages so a long export never janks the UI. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, PAGE_YIELD_MS))
}

/**
 * Fetch one page of the caller's own export rows.
 *
 * The "+1 row" look-ahead idiom (mirrors `fetchYourPostsPage`): request
 * `PAGE_SIZE + 1` rows; if we got back more than `PAGE_SIZE`, there's another
 * page — drop the extra row and surface the LAST visible row's composite
 * `(created_at, id)` key as `nextCursor`. Otherwise this is the last page
 * (`nextCursor: null`). The cursor is split into the RPC's `cursor` /
 * `cursor_id` args so the server resumes on the exact `(created_at, id)` tuple.
 */
export async function fetchExportPostsPage(
  cursor: CollectiveExportCursor | null
): Promise<CollectiveExportPage> {
  const { data, error } = await supabase.rpc('collective_export_page', {
    cursor: cursor?.createdAt ?? null,
    cursor_id: cursor?.id ?? null,
    page_size: PAGE_SIZE + 1,
  })
  if (error) throw error
  const rows = (data ?? []) as CollectiveExportRow[]
  const hasMore = rows.length > PAGE_SIZE
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  // hasMore ⇒ rows.length > PAGE_SIZE, so index PAGE_SIZE-1 is always present.
  const lastVisible = hasMore ? rows[PAGE_SIZE - 1]! : null
  const nextCursor = lastVisible
    ? { createdAt: lastVisible.created_at, id: lastVisible.id }
    : null
  return { items, nextCursor }
}

/**
 * One-shot read of the caller's ENTIRE own-post history. Loops
 * `fetchExportPostsPage` from `cursor = null` until `nextCursor === null`,
 * concatenating pages and reporting a running COUNT after each non-empty page
 * (calm "N so far" progress — the total is unknown until pagination finishes).
 *
 * Unlike the UI hook this has NO `maxPages` cap: the export must cover every
 * post. It yields to the event loop between pages so a large history never
 * blocks the UI for more than a frame.
 *
 * `deps.fetchPage` is injectable so the orchestrator (and this file's tests)
 * can drive the loop with fixtures and never touch `supabase`; it defaults to
 * the real `fetchExportPostsPage`.
 */
export async function fetchAllExportPosts(
  onProgress?: (count: number) => void,
  deps?: { fetchPage?: (cursor: CollectiveExportCursor | null) => Promise<CollectiveExportPage> }
): Promise<CollectiveExportRow[]> {
  const fetchPage = deps?.fetchPage ?? fetchExportPostsPage
  const all: CollectiveExportRow[] = []
  let cursor: CollectiveExportCursor | null = null

  for (;;) {
    const { items, nextCursor } = await fetchPage(cursor)
    if (items.length > 0) {
      all.push(...items)
      onProgress?.(all.length)
    }
    if (nextCursor === null) break
    cursor = nextCursor
    await yieldToEventLoop()
  }

  return all
}
