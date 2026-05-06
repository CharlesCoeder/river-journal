// packages/app/state/collective/reactions.ts
//
// Boundary rule (D7): MUST NOT import the Legend-State package.
//
// Query hook and fetch function for per-post reaction state.
// Provides the ['collective', 'reactions', postId] cache key that
// useToggleReaction.onMutate applies optimistic updates against.

import { useQuery } from '@tanstack/react-query'
import { supabase } from 'app/utils/supabase'
import type { Database } from 'app/types/database'
import type { ReactionKind } from './types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReactionCounts = Record<ReactionKind, number>
export type UserReactions = Record<ReactionKind, string | null>

export type ReactionsCache = {
  counts: ReactionCounts
  userReactions: UserReactions
}

// Row type from the generated Database schema — no `any`.
type ReactionRow = Database['public']['Tables']['collective_reactions']['Row']

// ─── Constants ────────────────────────────────────────────────────────────────

const REACTION_KINDS: ReactionKind[] = ['heart', 'sparkle', 'flame', 'leaf', 'wave']

function emptyReactionsCache(): ReactionsCache {
  const counts = {} as ReactionCounts
  const userReactions = {} as UserReactions
  for (const kind of REACTION_KINDS) {
    counts[kind] = 0
    userReactions[kind] = null
  }
  return { counts, userReactions }
}

// ─── Query key ────────────────────────────────────────────────────────────────

export const collectiveReactionsKey = (postId: string) =>
  ['collective', 'reactions', postId] as const

// ─── Fetch function ───────────────────────────────────────────────────────────

/**
 * Fetches all reactions for a given post and aggregates them into:
 *   - `counts`: total count per ReactionKind (includes anonymized rows)
 *   - `userReactions`: the current user's reaction id per kind (or null)
 *
 * Anonymized reactions (user_id IS NULL) count toward `counts` but
 * are NEVER reflected in `userReactions`.
 */
export async function fetchPostReactions(
  postId: string,
  userId: string | null
): Promise<ReactionsCache> {
  const { data, error } = await supabase
    .from('collective_reactions')
    .select('id, user_id, kind')
    .eq('post_id', postId)

  if (error) throw error

  const result = emptyReactionsCache()
  const rows: Pick<ReactionRow, 'id' | 'user_id' | 'kind'>[] = data ?? []

  for (const row of rows) {
    const kind = row.kind as ReactionKind
    if (!REACTION_KINDS.includes(kind)) continue

    // Every row (including anonymized) increments the count.
    result.counts[kind] = (result.counts[kind] ?? 0) + 1

    // Only the current authenticated user's rows set userReactions.
    if (userId !== null && row.user_id === userId) {
      result.userReactions[kind] = row.id
    }
  }

  return result
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Query hook for per-post reaction state.
 *
 * Returns `{ counts, userReactions }` where:
 *   - `counts[kind]` is the total number of reactions of that kind
 *   - `userReactions[kind]` is the current user's reaction id (DELETE target) or null
 *
 * Cold-cache behavior: `data` is `undefined` while loading. Consumers should
 * fall back to `emptyReactionsCache()` equivalents (all-zero / all-null).
 */
export function usePostReactions(postId: string, userId: string | null) {
  return useQuery({
    queryKey: collectiveReactionsKey(postId),
    queryFn: () => fetchPostReactions(postId, userId),
    staleTime: 25_000,
  })
}
