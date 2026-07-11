// packages/app/state/collective/moderationReceipts.ts
//
// Boundary rule (D7): no Legend-State imports in this file — TanStack Query only.
//
// The caller's OWN removed posts, the sole client-readable source for the
// "your post was removed" receipt. `moderation_actions` is admin-only and
// `collective_your_posts_page` deliberately excludes removed rows, so a
// purpose-built SECURITY DEFINER RPC (`collective_my_removed_posts`) returns
// removed-post metadata only — NO body, NO title (NFR19 structural leak guard).
// Reply-vs-top-level is derived from `parent_post_id`.

import { useQuery } from '@tanstack/react-query'
import { supabase } from 'app/utils/supabase'

/** A removed-post row from `collective_my_removed_posts` (metadata only). */
export interface RemovedPostRow {
  id: string
  parent_post_id: string | null
  created_at: string
  removed_reason: string | null
  removed_at: string
}

/**
 * The caller's own removed posts (newest-first per the RPC's `ORDER BY
 * removed_at DESC`). Returns the raw `useQuery` result object (un-unwrapped,
 * consistent with `useYourPosts`) so the gate can read `.data`.
 *
 * queryKey: ['collective', 'moderationReceipts', 'removedPosts', userId]
 * staleTime: 60_000
 * enabled: userId !== null
 */
export function useMyRemovedPosts(userId: string | null) {
  return useQuery({
    queryKey: ['collective', 'moderationReceipts', 'removedPosts', userId] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('collective_my_removed_posts', {
        max_rows: 50,
      })
      if (error) throw error
      return (data as RemovedPostRow[]) ?? []
    },
    enabled: userId !== null,
    staleTime: 60_000,
  })
}
