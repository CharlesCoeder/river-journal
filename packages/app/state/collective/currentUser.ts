// packages/app/state/collective/currentUser.ts
//
// Boundary rule (D7): no Legend-State imports in this file.
// D7-compliant hook for reading the current session user ID in Collective surfaces.
// Wraps supabase.auth.getSession() in a TanStack Query so components stay strictly
// on the query side — no store imports, no reactive calls.

import { useQuery } from '@tanstack/react-query'
import { supabase } from 'app/utils/supabase'

/**
 * Returns the current session user's ID, or null if not authenticated.
 * Returns undefined while the session query is loading (not yet resolved).
 *
 * queryKey: ['session', 'userId']
 * staleTime: Infinity (session ID doesn't change without a page reload)
 */
export function useCurrentUserId(): string | null | undefined {
  const { data } = useQuery({
    queryKey: ['session', 'userId'] as const,
    queryFn: async () => {
      const { data } = await supabase.auth.getSession()
      return data.session?.user.id ?? null
    },
    staleTime: Infinity,
  })

  return data ?? undefined
}
