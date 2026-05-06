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
