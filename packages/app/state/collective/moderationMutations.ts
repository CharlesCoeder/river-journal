// packages/app/state/collective/moderationMutations.ts
//
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  FOOTGUN #1 — EAGER IMPORT / MODULE-LOAD REGISTRATION                      ║
// ║                                                                              ║
// ║  TanStack Query's persister rehydrates mutations during                      ║
// ║  <PersistQueryClientProvider>'s mount. The rehydrated entries reference      ║
// ║  their `mutationKey` only — the registered default's `mutationFn` is the    ║
// ║  executable code path on replay. If defaults are registered AFTER mount,     ║
// ║  resumePausedMutations runs first, finds no defaults for the key, and         ║
// ║  SILENTLY NO-OPS. This module MUST be eager-imported in provider/index.tsx    ║
// ║  BEFORE the provider mounts (immediately after 'app/state/collective/         ║
// ║  mutations'), so setMutationDefaults runs at module load.                    ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
//
// Boundary rule (D7): this file is on the TanStack Query side of the v2
// architecture split — NO Legend-State import.
//
// Mutations registered here: ['moderation','remove'], ['moderation','suspend'],
// ['moderation','note']. All three invalidate the ['moderation'] prefix on
// settle so both moderationQueueKey (['moderation','queue']) and
// lastModerationActionKey (['moderation','lastAction']) refresh.

import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { queryClient } from 'app/state/queryClient'
import { supabase } from 'app/utils/supabase'
import { moderationQueueKey, type ModerationQueueItem } from './moderation'

// ─── Types ────────────────────────────────────────────────────────────────────

export type RemovePostVars = {
  target_post_id: string
  reason_code: string
  custom_note?: string | null
}

// `kind` is fixed to 'post_react' inside the mutationFn — it is NOT a caller var.
export type SuspendUserVars = {
  target_user_id: string
  duration_days: number
  reason?: string | null
}

export type AddNoteVars = {
  note: string
  target_post_id: string
}

// Context shape for the optimistic-remove rollback.
type RemoveContext = { snapshot: ModerationQueueItem[] | undefined }

// ═══════════════════════════════════════════════════════════════════════════════
// setMutationDefaults — THREE top-level calls at module load (FOOTGUN #1)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. moderation.remove ──────────────────────────────────────────────────────

queryClient.setMutationDefaults(['moderation', 'remove'], {
  mutationFn: async (vars: RemovePostVars) => {
    // PRIVACY: custom_note free text is passed ONLY to the RPC — never
    // to console/Sentry/any logger.
    const { error } = await supabase.rpc('remove_post', {
      target_post_id: vars.target_post_id,
      reason_code: vars.reason_code,
      custom_note: vars.custom_note ?? null,
    })
    if (error) throw error
  },

  onMutate: async (vars: RemovePostVars): Promise<RemoveContext> => {
    // Cancel any in-flight ['moderation'] fetches so a concurrent queue refetch
    // can't stomp the optimistic patch.
    await queryClient.cancelQueries({ queryKey: ['moderation'] })

    const snapshot = queryClient.getQueryData<ModerationQueueItem[]>(moderationQueueKey)

    if (snapshot) {
      // Row-scoped patch: flip ONLY the matching row's is_removed. The .map
      // tolerates an absent target row (offline-replay re-run against a
      // rehydrated cache), leaving siblings untouched.
      queryClient.setQueryData<ModerationQueueItem[]>(
        moderationQueueKey,
        snapshot.map((row) =>
          row.post_id === vars.target_post_id ? { ...row, is_removed: true } : row
        )
      )
    }

    return { snapshot }
  },

  onError: (_err: unknown, vars: RemovePostVars, ctx: RemoveContext | undefined) => {
    // Row-scoped rollback: restore ONLY the target row's prior state, leaving any
    // concurrent in-flight optimistic patch on a sibling row intact. Never
    // setQueryData(key, undefined), which would clobber a fresher cache that
    // arrived between onMutate and onError.
    if (ctx?.snapshot === undefined) return

    const priorRow = ctx.snapshot.find((row) => row.post_id === vars.target_post_id)
    const current = queryClient.getQueryData<ModerationQueueItem[]>(moderationQueueKey)

    if (current === undefined) {
      // Nothing partial to preserve (the whole cache is gone) — restore wholesale.
      queryClient.setQueryData(moderationQueueKey, ctx.snapshot)
      return
    }

    // The target wasn't in the pre-patch snapshot (offline-replay against a
    // cache that never held it) — there is no prior row state to roll back to.
    if (priorRow === undefined) return

    queryClient.setQueryData<ModerationQueueItem[]>(
      moderationQueueKey,
      current.map((row) => (row.post_id === vars.target_post_id ? priorRow : row))
    )
  },

  onSettled: () => {
    // Refreshes both queue + last-action timestamp (shared ['moderation'] prefix).
    queryClient.invalidateQueries({ queryKey: ['moderation'] })
  },
})

// ─── 2. moderation.suspend ─────────────────────────────────────────────────────

queryClient.setMutationDefaults(['moderation', 'suspend'], {
  mutationFn: async (vars: SuspendUserVars) => {
    // `kind` is fixed here — the RPC accepts only 'post_react'. PRIVACY:
    // reason free text goes ONLY to the RPC.
    const { error } = await supabase.rpc('suspend_user', {
      target_user_id: vars.target_user_id,
      kind: 'post_react',
      duration_days: vars.duration_days,
      reason: vars.reason ?? null,
    })
    if (error) throw error
  },

  // Suspend touches no queue data (the queue RPC never surfaces suspension
  // state), so there is no durable optimistic patch to apply. No-op onMutate.
  onMutate: async (_vars: SuspendUserVars): Promise<null> => {
    return null
  },

  onError: () => {
    // Nothing was mutated in onMutate — nothing to restore.
  },

  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['moderation'] })
  },
})

// ─── 3. moderation.note ────────────────────────────────────────────────────────

queryClient.setMutationDefaults(['moderation', 'note'], {
  mutationFn: async (vars: AddNoteVars) => {
    // PRIVACY: note free text is passed ONLY to the RPC.
    const { error } = await supabase.rpc('add_moderation_note', {
      note: vars.note,
      target_post_id: vars.target_post_id,
    })
    if (error) throw error
  },

  // A note mutates no post/report state — no optimistic cache change.
  onMutate: async (_vars: AddNoteVars): Promise<null> => {
    return null
  },

  onError: () => {
    // Nothing to restore.
  },

  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['moderation'] })
  },
})

// ═══════════════════════════════════════════════════════════════════════════════
// Consumer hooks — thin useMutation({ mutationKey }) with NO inline mutationFn.
// An inline fn would shadow the persisted-replay default (FOOTGUN #1).
// ═══════════════════════════════════════════════════════════════════════════════

export function useRemovePost(): UseMutationResult<void, Error, RemovePostVars, RemoveContext> {
  return useMutation<void, Error, RemovePostVars, RemoveContext>({
    mutationKey: ['moderation', 'remove'],
  })
}

export function useSuspendUser(): UseMutationResult<void, Error, SuspendUserVars, null> {
  return useMutation<void, Error, SuspendUserVars, null>({
    mutationKey: ['moderation', 'suspend'],
  })
}

export function useAddModerationNote(): UseMutationResult<void, Error, AddNoteVars, null> {
  return useMutation<void, Error, AddNoteVars, null>({
    mutationKey: ['moderation', 'note'],
  })
}
