// packages/app/state/collective/eligibility.ts
//
// Boundary rule (D7): no Legend-State imports in this file.
// Tiny TanStack Query hook wrapping the `is_eligible_to_post()` SECURITY
// DEFINER RPC. Returns the server's authoritative answer to "is the calling
// user allowed to post to the Collective right now?" — independent of any
// feed contents (see migration 20260508000000_add_is_eligible_to_post_rpc).

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { supabase } from 'app/utils/supabase'

// Stable tuple (exported for invalidation reuse on sync-toggle / streak cross).
export const collectiveEligibilityKey = ['collective', 'eligibility'] as const

export interface UseEligibleToPostResult {
  // The RPC answer when fresh; undefined while loading or on error-with-no-cache.
  data: boolean | undefined
  isLoading: boolean
  isError: boolean
  // Raw query for callers that want refetch / status detail.
  query: UseQueryResult<boolean, Error>
}

/**
 * `useEligibleToPost()` — calls `is_eligible_to_post()` and returns the
 * boolean answer. Errors are exposed via `isError` (consumer hook collapses
 * error-with-no-cache to `'loading'` deliberately, not implicitly).
 *
 * queryKey: ['collective', 'eligibility']
 * staleTime: 25_000 (mirrors feed cadence; refetchInterval isn't set here —
 *   eligibility flips are sparse, so refetchOnWindowFocus + invalidations
 *   on sync-toggle / streak cross are sufficient).
 * refetchOnWindowFocus: true
 */
export function useEligibleToPost(): UseEligibleToPostResult {
  const query = useQuery<boolean, Error>({
    queryKey: collectiveEligibilityKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_eligible_to_post')
      if (error) throw error
      // Surface SQL NULL as an error (collapsed to 'loading' by the consumer)
      // rather than silently coercing to `false` / not-qualified. NULL here
      // would mean the predicate dependency (e.g. user_timezone row) was
      // missing — a transient state, not a real "no" answer.
      if (data === null || data === undefined) {
        throw new Error('is_eligible_to_post returned null')
      }
      return data === true
    },
    staleTime: 25_000,
    refetchOnWindowFocus: true,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    query,
  }
}
