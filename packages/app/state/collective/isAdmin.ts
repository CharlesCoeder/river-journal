// packages/app/state/collective/isAdmin.ts
//
// Boundary rule (D7): no Legend-State imports in this file.
// D7-compliant hook for reading the current session's admin status in admin
// surfaces. Wraps supabase.auth.getSession() in a TanStack Query so components
// stay strictly on the query side — no store imports, no reactive calls.
// Mirrors currentUser.ts exactly; only the projected value differs.
//
// IMPORTANT distinction — two `is_admin` surfaces, one source of truth
// (`raw_app_meta_data.is_admin` on the account):
//   - The CLIENT gate (this hook) reads `session.user.app_metadata.is_admin`,
//     exposed directly by the JS SDK. It does NOT depend on the top-level-claim
//     access-token hook.
//   - The SERVER path (RLS policies + SECURITY DEFINER functions) reads the
//     TOP-LEVEL claim `auth.jwt() ->> 'is_admin'`, which the access-token hook
//     promotes from app_metadata. That is the real security boundary; this
//     client read is UX-only route gating.
// We read from `app_metadata` (service-role-only) and NEVER from the
// end-user-writable metadata bag (settable via auth.updateUser({ data })),
// which would let any account self-grant admin.

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from 'app/utils/supabase'

const SESSION_IS_ADMIN_KEY = ['session', 'isAdmin'] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function projectIsAdmin(session: any): boolean | null {
  if (!session) return null
  // Fail closed: only the strict boolean `true` grants admin. Any other value
  // (missing, explicit false, a "true" string, a number) resolves to false.
  return session.user?.app_metadata?.is_admin === true
}

/**
 * Returns the current session's admin status:
 *   - undefined while the session query is loading (not yet resolved)
 *   - null when there is no session (logged out)
 *   - true when app_metadata.is_admin === true (strict)
 *   - false for any other resolved session (non-admin)
 *
 * queryKey: ['session', 'isAdmin']
 *
 * Subscribes to supabase.auth.onAuthStateChange so it stays fresh across
 * sign-in / sign-out / token-refresh; a sign-out reliably flips the projected
 * value back to null so the gate re-closes.
 */
export function useIsAdmin(): boolean | null | undefined {
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: SESSION_IS_ADMIN_KEY,
    queryFn: async () => {
      const { data } = await supabase.auth.getSession()
      return projectIsAdmin(data.session)
    },
    // biome-ignore lint/style/useNumberNamespace: session query intentionally never refetches; the `Infinity` literal is asserted by isAdmin.test.ts
    staleTime: Infinity,
  })

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      queryClient.setQueryData<boolean | null>(SESSION_IS_ADMIN_KEY, projectIsAdmin(session))
    })

    // Tear the subscription down on unmount so repeated mounts don't stack
    // listeners (leak), and a sign-out reliably re-closes the gate.
    return () => {
      subscription.unsubscribe()
    }
  }, [queryClient])

  // `undefined` only while loading; once resolved it is `true`/`false` (session)
  // or `null` (logged out). Do NOT collapse `null` to `undefined` — callers
  // distinguish "loading" from "logged out".
  return data
}
