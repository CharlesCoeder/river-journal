// packages/app/state/collective/suspension.ts
//
// Boundary rule (D7): no Legend-State imports in this file.
// Hook for checking if the current user has an active suspension.

import { useQuery } from '@tanstack/react-query'
import { supabase } from 'app/utils/supabase'

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns true if the given user has an active suspension for 'post_react'.
 * Returns undefined while loading or if userId is null (disabled).
 *
 * queryKey: ['collective', 'suspension', userId, 'post_react']
 * staleTime: 60_000 (60 seconds)
 * enabled: userId !== null
 */
export function useIsSuspended(userId: string | null): boolean | undefined {
  const result = useQuery({
    queryKey: ['collective', 'suspension', userId, 'post_react'] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_active_suspension', {
        uid: userId!,
        kind_param: 'post_react',
      })
      if (error) throw error
      return data as boolean
    },
    enabled: userId !== null,
    staleTime: 60_000,
  })

  return result?.data ?? undefined
}

// ─── Active-suspension row (reason + expiry) ───────────────────────────────────

/**
 * The caller's own active-suspension row, or null if none is active.
 *
 * Unlike `useIsSuspended` (a bare boolean via the `is_active_suspension` RPC),
 * this direct-SELECTs the caller's own row so the in-app receipt UX can show
 * the reason + `ends_at`. The `user_suspensions_select_admin_or_own` RLS policy
 * (`auth.uid() = user_id`) already permits this own-read — no RPC and no
 * migration are needed. The `.eq('user_id', userId)` is convenience, not
 * security: RLS is the real guard.
 *
 * The `.gt('ends_at', nowIso)` is the server-side active guard applied at fetch
 * time. Because `staleTime` holds the result for 60s, a suspension can lapse
 * mid-session while still cached — consumers MUST re-check `ends_at > now` at
 * render (see `ModerationReceiptGate`).
 *
 * queryKey: ['collective', 'suspension', userId, 'activeRow']
 * staleTime: 60_000
 * enabled: userId !== null
 */
export interface ActiveSuspensionRow {
  id: string
  kind: string
  starts_at: string
  ends_at: string
  reason: string | null
}

export function useMyActiveSuspension(userId: string | null): ActiveSuspensionRow | null {
  const result = useQuery({
    queryKey: ['collective', 'suspension', userId, 'activeRow'] as const,
    queryFn: async () => {
      const nowIso = new Date().toISOString()
      const { data, error } = await supabase
        .from('user_suspensions')
        .select('id, kind, starts_at, ends_at, reason')
        .eq('user_id', userId!)
        .gt('ends_at', nowIso)
        .order('ends_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return (data as ActiveSuspensionRow | null) ?? null
    },
    enabled: userId !== null,
    staleTime: 60_000,
  })

  return result?.data ?? null
}
