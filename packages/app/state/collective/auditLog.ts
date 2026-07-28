// packages/app/state/collective/auditLog.ts
//
// TanStack Query hook layer for the admin audit log (web + desktop).
//
// Surface:
//   - `auditLogKey`                canonical query-key tuple for the audit list
//   - `PAGE_SIZE`                  page size (memory budget regression sentinel)
//   - `AuditLogItem`               row shape (derived from the generated type)
//   - `AuditLogPage`               one page of the infinite query
//   - `fetchAuditLogPage()`        pure async fetcher (look-ahead keyset)
//   - `useAuditLog()`              useInfiniteQuery wrapper (calm-realtime)
//   - `usePostAdminDetail()`       tap-through post current-state (DEFINER RPC)
//   - `useTargetModerationHistory()` target-keyed moderation history (direct)
//
// The audit LIST reads `moderation_actions` DIRECTLY — no RPC, no joins.
// Everything the list renders is a column on the table, and `moderation_actions`
// has the `moderation_actions_select_admin` RLS policy + `GRANT SELECT TO
// authenticated`, so an admin session reads it directly (already precedented by
// `useLastModerationActionAt` in `moderation.ts`). Only the tap-through post
// body needs a DEFINER RPC, because `collective_posts` is RLS-walled.
//
// Query-key family: `auditLogKey` and the two panel hooks all share the
// `['moderation']` prefix, so the removal/suspension/note mutations — which
// invalidate `['moderation']` on settle — automatically refresh the audit view
// and any open panel.
//
// Boundary rule (D7): this file is on the TanStack Query side of the v2
// architecture split and must remain free of Legend-State imports. The narrow
// observe() exception that lives in `feed.ts` does NOT extend here.

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { supabase } from 'app/utils/supabase'
import type { Database } from 'app/types/database'

/**
 * Canonical query key for the audit list. `as const` preserves the literal
 * tuple; it shares the `['moderation']` prefix so the queue/mutation
 * invalidations also refresh the audit view.
 */
export const auditLogKey = ['moderation', 'audit'] as const

/**
 * Page size for the audit-log pagination. The look-ahead idiom requests
 * `PAGE_SIZE + 1` rows per page to detect "has more" without a count query.
 * Combined with `maxPages: 5` in `useAuditLog()`, this caps in-memory rows at
 * 100 (memory budget).
 */
export const PAGE_SIZE = 20

/**
 * Row shape for the audit list, derived from the generated `Database` type
 * (never hand-rolled) — it is exactly a `moderation_actions` row.
 */
export type AuditLogItem = Database['public']['Tables']['moderation_actions']['Row']

/** Current-state row for the tap-through post detail (DEFINER RPC result). */
export type PostAdminDetail =
  Database['public']['Functions']['collective_post_admin_detail']['Returns'][number]

export type AuditLogPage = {
  items: AuditLogItem[]
  nextCursor: string | null
}

/**
 * Pure async fetcher for one page of the audit log.
 *
 * Direct newest-first SELECT on `moderation_actions` with the `+1` look-ahead
 * idiom used by `feed.ts` / `yourPosts.ts`: request PAGE_SIZE+1 rows; if more
 * than PAGE_SIZE came back there is another page — slice to PAGE_SIZE and set
 * `nextCursor` to the last VISIBLE row's `created_at`; otherwise `null`. When
 * `cursor` is non-null, `.lt('created_at', cursor)` fetches strictly-older rows.
 *
 * KEYSET CAVEAT — the cursor is `created_at`-only, which is fine at solo-operator
 * scale (two manual moderation actions never share a microsecond). The hardening
 * option — DO NOT build it now — is a `(created_at, id)` compound keyset plus
 * recomputing the cursor from the actually-rendered last row. It closes two
 * boundary hazards, and in an audit log a *silently dropped row* is the failure
 * that matters:
 *   (a) TIE-DROP: `.lt('created_at', cursor)` is strictly-less-than, so if a tie
 *       group straddles the page boundary — the sliced-off look-ahead row shares
 *       `created_at` with the last visible row — every tied row is SKIPPED by the
 *       next page (dropped, not duplicated). A `(created_at, id)` keyset closes
 *       this.
 *   (b) PREPEND-DISPLACEMENT: the 30s `refetchInterval` re-runs page 1 with
 *       `pageParam: null` (always "newest 20"); if a new action lands between
 *       polls, the row that was 20th-newest is displaced to 21st while page 2
 *       still keyset-reads `.lt(oldCursor)` and starts BELOW it — so that one
 *       boundary row is transiently absent from the flattened union until a
 *       manual reload. Recomputing the cursor from the rendered last row is the
 *       fix. Neither is fatal at solo cadence; both are named here so a future
 *       maintainer scaling this knows the `(created_at, id)` keyset is the answer.
 */
export async function fetchAuditLogPage(cursor: string | null): Promise<AuditLogPage> {
  let query = supabase
    .from('moderation_actions')
    .select(
      'id,action_type,actor_user_id,target_post_id,target_user_id,reason,note,created_at,metadata'
    )
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE + 1)

  if (cursor != null) {
    query = query.lt('created_at', cursor)
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as AuditLogItem[]
  const hasMore = rows.length > PAGE_SIZE
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  // hasMore ⇒ rows.length > PAGE_SIZE, so index PAGE_SIZE-1 is always present.
  const nextCursor = hasMore ? rows[PAGE_SIZE - 1]!.created_at : null
  return { items, nextCursor }
}

/**
 * `useInfiniteQuery` wrapper for the audit log.
 *
 * Config rationale (mirrors feed/yourPosts):
 *   - `maxPages: 5` × `PAGE_SIZE: 20` = 100 in-memory cap. On an
 *     explicit "Load more" list this evicts the TOP page once past 100 rows —
 *     a visible upward jump, not a crash; there is no back-fill by design (the
 *     trail is append-only, newest-first — no `getPreviousPageParam`).
 *   - `staleTime: 25_000` < `refetchInterval: 30_000` — calm-realtime cadence
 *     (staleTime must be < refetchInterval for the poll to fire).
 *   - `refetchOnWindowFocus: true` — pick up new actions on return.
 */
export function useAuditLog() {
  return useInfiniteQuery({
    queryKey: auditLogKey,
    queryFn: ({ pageParam }: { pageParam: string | null }) => fetchAuditLogPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: AuditLogPage) => lastPage.nextCursor,
    maxPages: 5,
    refetchInterval: 30_000,
    staleTime: 25_000,
    refetchOnWindowFocus: true,
  })
}

/**
 * `useQuery` wrapper for the tap-through post's current state. Calls the
 * admin-only DEFINER RPC `collective_post_admin_detail` (the only path that can
 * read the RLS-walled `collective_posts`), unwrapping the single row. `enabled`
 * only while the panel is expanded AND a target post exists. Zero rows (a
 * hard-deleted target) resolve to `null` so the panel shows a calm note.
 */
export function usePostAdminDetail(targetPostId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['moderation', 'audit', 'postDetail', targetPostId],
    enabled: enabled && targetPostId != null,
    queryFn: async (): Promise<PostAdminDetail | null> => {
      const { data, error } = await supabase.rpc('collective_post_admin_detail', {
        target_post_id: targetPostId as string,
      })
      if (error) throw error
      return data?.[0] ?? null
    },
  })
}

/**
 * `useQuery` wrapper for a target's full moderation history — a direct,
 * target-keyed SELECT on `moderation_actions` (admin RLS, no RPC). Keyed on
 * whichever of `target_post_id` / `target_user_id` is set. This is
 * target-keyed, NOT entity-graph-complete: a post's history (by
 * `target_post_id`) does not surface author-level `suspend_user` actions (keyed
 * on `target_user_id`) — the UI labels it accordingly. `enabled` only while the
 * panel is open.
 */
export function useTargetModerationHistory({
  targetPostId,
  targetUserId,
  enabled,
}: {
  targetPostId: string | null
  targetUserId: string | null
  enabled: boolean
}) {
  return useQuery({
    queryKey: ['moderation', 'audit', 'history', targetPostId ?? targetUserId],
    // Self-total guard: even if a future caller enables this with BOTH targets
    // null, never issue the malformed `.eq('target_user_id', null)` filter.
    enabled: enabled && (targetPostId != null || targetUserId != null),
    queryFn: async (): Promise<AuditLogItem[]> => {
      let query = supabase
        .from('moderation_actions')
        .select(
          'id,action_type,actor_user_id,target_post_id,target_user_id,reason,note,created_at,metadata'
        )
      query =
        targetPostId != null
          ? query.eq('target_post_id', targetPostId)
          : query.eq('target_user_id', targetUserId as string)
      const { data, error } = await query.order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as AuditLogItem[]
    },
  })
}
