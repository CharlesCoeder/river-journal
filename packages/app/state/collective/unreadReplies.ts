// packages/app/state/collective/unreadReplies.ts
//
// Boundary rule (D7): no Legend-State imports in this file — TanStack Query only.
//
// The unread-Collective-replies count the web/desktop in-app reminder card
// reads. collective_posts is RLS-walled and the client has no safe index of
// "all replies to my posts across every thread", so the count comes from the
// auth.uid()-scoped SECURITY DEFINER RPC `unread_replies_for_user(since)`.
// Fetched exactly ONCE per app open (staleTime Infinity, no background /
// window-focus / remount refetch) — the product posture forbids polling a
// low-signal reminder count.

import { useQuery } from '@tanstack/react-query'
import { supabase } from 'app/utils/supabase'

/**
 * The caller's unread-reply count since `since` (an ISO timestamp captured once
 * at the card's mount). Returns the raw `useQuery` result object (un-unwrapped,
 * consistent with `useMyRemovedPosts` / `useMyActiveSuspension`) so the gate
 * reads `.data`.
 *
 * queryKey: ['collective', 'unreadReplies', userId, since]
 * enabled:  userId !== null && since !== null (the mount-pinned `since` gates it)
 * staleTime: Infinity; refetchOnWindowFocus / refetchOnMount: false
 */
export function useUnreadReplies(userId: string | null, since: string | null) {
  return useQuery({
    queryKey: ['collective', 'unreadReplies', userId, since] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('unread_replies_for_user', {
        since: since!,
      })
      if (error) throw error
      return (data as number) ?? 0
    },
    enabled: userId !== null && since !== null,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  })
}
