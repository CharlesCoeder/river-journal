// packages/app/state/collective/currentUser.ts
//
// Boundary rule (D7): no Legend-State imports in this file.
// D7-compliant hook for reading the current session user ID in Collective surfaces.
// Wraps supabase.auth.getSession() in a TanStack Query so components stay strictly
// on the query side — no store imports, no reactive calls.

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from 'app/utils/supabase'

const SESSION_USER_ID_KEY = ['session', 'userId'] as const

/**
 * Returns the current session user's ID, or null if not authenticated.
 * Returns undefined while the session query is loading (not yet resolved).
 *
 * queryKey: ['session', 'userId']
 *
 * The query subscribes to supabase.auth.onAuthStateChange so it stays fresh
 * across sign-in / sign-out / token-refresh and (critically on RN) when the
 * INITIAL_SESSION event fires after AsyncStorage finishes hydrating.
 */
export function useCurrentUserId(): string | null | undefined {
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: SESSION_USER_ID_KEY,
    queryFn: async () => {
      const { data } = await supabase.auth.getSession()
      return data.session?.user.id ?? null
    },
    staleTime: Infinity,
  })

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      queryClient.setQueryData<string | null>(
        SESSION_USER_ID_KEY,
        session?.user.id ?? null
      )
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [queryClient])

  return data ?? undefined
}
