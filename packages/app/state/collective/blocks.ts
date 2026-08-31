// packages/app/state/collective/blocks.ts
//
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SILENT-BOUNDARY INVARIANT — READ BEFORE EDITING                             ║
// ║                                                                              ║
// ║  User-to-user blocking is SILENT and SYMMETRIC. No code path may emit any     ║
// ║  signal — toast, push, receipt, email, or a distinct error — to the blocked   ║
// ║  user. Blocking a user and being blocked are indistinguishable from the       ║
// ║  outside: a cross-boundary reply/reaction fails with the SAME generic error    ║
// ║  the RLS layer returns for any denial. The server-side twin of this comment    ║
// ║  lives at the predicate migration. If you add a branch here, prove it emits    ║
// ║  nothing observable to the other side of the boundary.                        ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
//
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  FOOTGUN #1 — EAGER IMPORT / MODULE-LOAD REGISTRATION                        ║
// ║                                                                              ║
// ║  TanStack Query's persister rehydrates mutations during                       ║
// ║  <PersistQueryClientProvider>'s mount. The rehydrated entries reference       ║
// ║  their `mutationKey` only — the registered default's `mutationFn` is the      ║
// ║  executable code path on replay. If defaults are registered AFTER mount,      ║
// ║  resumePausedMutations runs first, finds no defaults for the key, and          ║
// ║  SILENTLY NO-OPS. This module MUST be eager-imported in provider/index.tsx     ║
// ║  BEFORE the provider mounts (immediately after                                ║
// ║  'app/state/collective/moderationMutations'), so setMutationDefaults runs at   ║
// ║  module load.                                                                 ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
//
// Boundary rule (D7): this file is on the TanStack Query side of the v2
// architecture split — NO Legend-State import. It imports from
// '@tanstack/react-query' + 'app/utils/supabase' only.
//
// Direct PostgREST (NOT RPC): `user_blocks` is an RLS-governed table with client
// grants (SELECT/INSERT/DELETE to `authenticated`) and one-sided RLS (own rows
// only). No block RPC exists and none is needed — this mirrors the report
// mutation in `mutations.ts`, not the SECURITY DEFINER pattern in
// `moderationMutations.ts`.
//
// Mutations registered here: ['collective','block'], ['collective','unblock'].
// Both invalidate the ['collective'] prefix on settle — this transitively
// refreshes feed, every open thread, yourPosts, reactions, AND the
// blocked-users list, so newly-filtered surfaces refresh with no per-key
// bookkeeping (RLS is authoritative; the client never filters).

import { useMutation, useQuery, type UseMutationResult } from '@tanstack/react-query'
import { queryClient } from 'app/state/queryClient'
import { supabase } from 'app/utils/supabase'
import type { Database } from 'app/types/database'

// ─── Constants ────────────────────────────────────────────────────────────────

// 24h expressed as arithmetic so the intent is clear to future readers.
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserBlockRow = Database['public']['Tables']['user_blocks']['Row']
type UserBlockInsert = Database['public']['Tables']['user_blocks']['Insert']

// `blocker_user_id` MUST be supplied explicitly by the caller (the column has no
// DEFAULT; RLS `WITH CHECK (auth.uid() = blocker_user_id)` verifies it — mirror
// how the report mutation supplies `reporter_user_id`).
export type BlockUserVars = { blocker_user_id: string; blocked_user_id: string }
export type UnblockUserVars = { id: string }

// ─── Query keys ─────────────────────────────────────────────────────────────

/**
 * Canonical query-key PREFIX for the calling user's block list. `as const`
 * preserves the literal-tuple type so a `['collective']` prefix invalidation
 * from a mutation matches it. Mirrors `yourPostsKey`.
 */
export const blockedUsersKey = ['collective', 'blockedUsers'] as const

/**
 * User-scoped query key. The block list is account-specific and RLS-scoped to
 * own rows, so embedding the user id keeps a stale persisted cache from serving
 * account A's rows to account B, and keys per-user cache entries cleanly.
 */
export const blockedUsersKeyForUser = (userId: string) => [...blockedUsersKey, userId] as const

// ═══════════════════════════════════════════════════════════════════════════════
// setMutationDefaults — TWO top-level calls at module load (FOOTGUN #1)
// ═══════════════════════════════════════════════════════════════════════════════
//
// TELEMETRY: no capture ships here (the app has no product analytics). The
// blocked user's id must NEVER enter telemetry or any log — that is a
// re-identification side-channel that would break the silent invariant above.

// ─── 1. collective.block ───────────────────────────────────────────────────────

queryClient.setMutationDefaults(['collective', 'block'], {
  gcTime: TWENTY_FOUR_HOURS_MS,

  mutationFn: async (vars: BlockUserVars) => {
    const insert: UserBlockInsert = {
      blocker_user_id: vars.blocker_user_id,
      blocked_user_id: vars.blocked_user_id,
    }
    const { error } = await supabase.from('user_blocks').insert(insert)
    if (error) {
      // Swallow the duplicate-block idempotency case ONLY on the exact unique
      // constraint (offline-replay of a block that already landed). This MUST
      // be constraint-scoped, never code-only: an FK `23503` (the blocked
      // author was deleted / an offline INSERT replayed against a now-gone
      // author) also could theoretically collide on code with a different
      // 23505, but more importantly a `23503` is NOT a duplicate — it must
      // throw (silently, no leak) rather than resolve as success.
      if (
        error.code === '23505' &&
        // `constraint` is present at runtime on Postgres errors but is not in
        // the PostgrestError type, so read it through a narrow cast.
        (error as { constraint?: string }).constraint === 'user_blocks_blocker_blocked_key'
      ) {
        return
      }
      throw error
    }
  },

  // No optimistic cache patch (deliberate — the epic resolves optimistic
  // prediction as OMITTED). Blocked content disappears on the onSettled
  // invalidation refetch (~immediate on-line). No row-scoped removal/rollback
  // for a low-frequency, re-tappable action.
  onMutate: async (_vars: BlockUserVars): Promise<null> => {
    return null
  },

  onSettled: () => {
    // Invalidate the entire ['collective'] subtree: feed, every open thread,
    // yourPosts, reactions, AND the blocked-users list. RLS/RPC filtering is
    // authoritative — the refetch is what removes the blocked author's content.
    queryClient.invalidateQueries({ queryKey: ['collective'] })
  },
})

// ─── 2. collective.unblock ─────────────────────────────────────────────────────

queryClient.setMutationDefaults(['collective', 'unblock'], {
  gcTime: TWENTY_FOUR_HOURS_MS,

  mutationFn: async (vars: UnblockUserVars) => {
    // Delete by the row's primary key. The one-sided DELETE RLS scopes this to
    // the caller's own rows. A DELETE matching zero rows is a silent no-op in
    // PostgREST (no error) — that IS the replay-idempotency contract; do not
    // add existence checks.
    const { error } = await supabase.from('user_blocks').delete().eq('id', vars.id)
    if (error) throw error
  },

  onMutate: async (_vars: UnblockUserVars): Promise<null> => {
    return null
  },

  onSettled: () => {
    // Blocked content reappears on refetch; the blocked-users list drops the row.
    queryClient.invalidateQueries({ queryKey: ['collective'] })
  },
})

// ═══════════════════════════════════════════════════════════════════════════════
// Consumer hooks — thin useMutation({ mutationKey }) with NO inline mutation fn.
// An inline fn would shadow the persisted-replay default (FOOTGUN #1).
// ═══════════════════════════════════════════════════════════════════════════════

export function useBlockUser(): UseMutationResult<void, Error, BlockUserVars, null> {
  return useMutation<void, Error, BlockUserVars, null>({
    mutationKey: ['collective', 'block'],
  })
}

export function useUnblockUser(): UseMutationResult<void, Error, UnblockUserVars, null> {
  return useMutation<void, Error, UnblockUserVars, null>({
    mutationKey: ['collective', 'unblock'],
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// useBlockedUsers — the calling user's own block list
// ═══════════════════════════════════════════════════════════════════════════════
//
// `userId` comes from the caller (`useCurrentUserId()` at the screen level):
//   - `undefined` — session still resolving → query disabled.
//   - `null` — signed out → disabled.
//   - string — enabled, keyed under blockedUsersKeyForUser(userId).
//
// RLS already scopes to own rows; the explicit `.eq('blocker_user_id', userId)`
// keeps intent + per-user cache keying. No polling / no refetchInterval — this
// is a small, low-frequency list, not a feed. `.select('*')` with no `.limit()`
// is an accepted scale ceiling (the block list is small by nature).
export function useBlockedUsers(userId: string | null | undefined) {
  return useQuery({
    queryKey: blockedUsersKeyForUser(typeof userId === 'string' ? userId : 'signed-out'),
    queryFn: async (): Promise<UserBlockRow[]> => {
      const { data, error } = await supabase
        .from('user_blocks')
        .select('*')
        .eq('blocker_user_id', userId as string)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as UserBlockRow[]
    },
    enabled: typeof userId === 'string',
  })
}
