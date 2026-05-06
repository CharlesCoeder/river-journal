// packages/app/state/collective/mutations.ts
//
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  FOOTGUN #1 — EAGER IMPORT / MODULE-LOAD REGISTRATION                      ║
// ║                                                                              ║
// ║  TanStack Query's persister rehydrates mutations during                      ║
// ║  <PersistQueryClientProvider>'s mount. The rehydrated entries reference      ║
// ║  their `mutationKey` only — the registered default's `mutationFn` is the    ║
// ║  executable code path on replay. If defaults are registered AFTER mount      ║
// ║  (e.g. inside a useEffect in the Provider's children), resumePausedMutations ║
// ║  runs first, finds no defaults for the key, and SILENTLY NO-OPS. There is   ║
// ║  no error. There is no log. The post just disappears.                        ║
// ║                                                                              ║
// ║  This file MUST be the FIRST app-code import in provider/index.tsx (line 6) ║
// ║  so that setMutationDefaults runs at module load, BEFORE the provider mounts.║
// ║  See provider/index.tsx:1–7.                                                 ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
//
// ID GENERATION: `useCreatePost` does NOT generate the id internally via
// useState or useMemo. Each `.mutate(vars)` call must provide an `id` (or
// callers can use the `createPostWithId` helper below which calls
// crypto.randomUUID() at call time — per-call, not per-render). This avoids
// the double-render / strict-mode pitfall where a single `useState(crypto.randomUUID())`
// gets captured and re-used for a second submit, producing an unexpected
// ON CONFLICT. Two rapid taps → two distinct UUIDs → two distinct mutations,
// both subject to server-side ON CONFLICT (id) DO NOTHING idempotency.
//
// Boundary rule (D7): this file MUST NOT import the Legend-State package.
//
// Mutations registered here: ['collective','post'], ['collective','react'],
// ['collective','report']. ['collective','delete_own'] is deferred to
// Story 3.13.

import { useMutation, type UseMutationResult, type InfiniteData } from '@tanstack/react-query'
import { queryClient } from 'app/state/queryClient'
import { supabase } from 'app/utils/supabase'
import { collectiveFeedKey, type FeedPage, type Post } from './feed'
import { collectiveThreadKey, type ThreadPageResult } from './thread'
import { collectiveReactionsKey, type ReactionsCache } from './reactions'
import type { ToggleReactionVars } from './types'
import type { Database } from 'app/types/database'

// ─── Constants ────────────────────────────────────────────────────────────────

// 24h expressed as arithmetic so the intent is clear to future readers.
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreatePostVars = {
  id: string
  body: string
  parent_post_id?: string | null
  user_id: string
}

// ReactionKind is the single source of truth in types.ts — re-exported here
// for back-compat with any existing consumers importing from mutations.ts.
export type { ReactionKind } from './types'
export type { ToggleReactionVars } from './types'

export type ReportPostVars = {
  id: string
  post_id: string
  reporter_user_id: string
  reason_code: string
  note?: string | null
}

// DB insert types — typed against generated Database schema, no `any` re-derivation.
type PostInsert = Database['public']['Tables']['collective_posts']['Insert']
type ReactionInsert = Database['public']['Tables']['collective_reactions']['Insert']
type ReportInsert = Database['public']['Tables']['collective_reports']['Insert']

// Context shape for post mutation rollback
type PostMutationContext = { snapshot: InfiniteData<FeedPage> | undefined }

// Context shape for react mutation rollback
type ReactMutationContext = {
  feedSnapshot: InfiniteData<FeedPage> | undefined
  threadSnapshot: InfiniteData<ThreadPageResult> | undefined
  reactionsSnapshot: ReactionsCache | undefined
}

// ─── Sentinels (preserved from Story 3-2 stub) ───────────────────────────────
// These are read by provider/index.tsx:98–106 in dev as an ordering witness.
// Removing or renaming them breaks the dev-only eager-import regression guard.

export const __collectiveMutationsStub = true

export const __collectiveMutationsLoadedAt: number = Date.now()

// ═══════════════════════════════════════════════════════════════════════════════
// setMutationDefaults — THREE top-level calls at module load
// (see FOOTGUN #1 note at top of file)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. collective.post ───────────────────────────────────────────────────────

queryClient.setMutationDefaults(['collective', 'post'], {
  gcTime: TWENTY_FOUR_HOURS_MS,

  mutationFn: async (vars: CreatePostVars) => {
    const insert: PostInsert = {
      id: vars.id,
      body: vars.body,
      parent_post_id: vars.parent_post_id ?? null,
      user_id: vars.user_id,
    }
    const { error } = await supabase.from('collective_posts').insert(insert)
    // Any error (including unexpected 23505 on a non-id constraint) is re-thrown.
    // ON CONFLICT (id) DO NOTHING returns { data: [], error: null } — no throw.
    if (error) throw error
  },

  onMutate: async (vars: CreatePostVars): Promise<PostMutationContext> => {
    // Cancel any in-flight collective fetches to prevent them from
    // stomping our optimistic update.
    await queryClient.cancelQueries({ queryKey: ['collective'] })

    const snapshot = queryClient.getQueryData<InfiniteData<FeedPage>>(collectiveFeedKey)

    if (snapshot) {
      const optimisticRow = {
        id: vars.id,
        body: vars.body,
        parent_post_id: vars.parent_post_id ?? null,
        user_id: vars.user_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_removed: false,
        is_user_deleted: false,
        removed_at: null,
        removed_reason: null,
        user_deleted_at: null,
        mode: 'full' as const,
        // Client-only pending indicator — removed once onSettled invalidation
        // replaces this row with the canonical RPC-returned row.
        __optimistic: true,
      } as Post & { __optimistic: true }

      queryClient.setQueryData<InfiniteData<FeedPage>>(collectiveFeedKey, {
        ...snapshot,
        pages: snapshot.pages.map((page, i) =>
          i === 0 ? { ...page, items: [optimisticRow, ...page.items] } : page
        ),
      })
    }

    return { snapshot }
  },

  onError: (_err: unknown, _vars: CreatePostVars, ctx: PostMutationContext | undefined) => {
    // Restore snapshot only if it was defined — never call setQueryData with
    // undefined (which would clobber any cache that arrived between onMutate
    // and onError).
    if (ctx?.snapshot !== undefined) {
      queryClient.setQueryData(collectiveFeedKey, ctx.snapshot)
    }
  },

  onSettled: () => {
    // Invalidate the entire ['collective'] subtree so the authoritative
    // server state replaces the optimistic row. This covers feed, every
    // open thread, and your-posts. Accepted cost.
    queryClient.invalidateQueries({ queryKey: ['collective'] })
  },
})

// ─── 2. collective.react ──────────────────────────────────────────────────────

queryClient.setMutationDefaults(['collective', 'react'], {
  gcTime: TWENTY_FOUR_HOURS_MS,

  mutationFn: async (vars: ToggleReactionVars) => {
    if (vars.toggle === 'add') {
      const insert: ReactionInsert = {
        id: vars.id,
        post_id: vars.post_id,
        kind: vars.kind,
        user_id: vars.user_id,
      }
      const { error } = await supabase.from('collective_reactions').insert(insert)
      if (error) {
        // Swallow duplicate on the expected UNIQUE constraint — this covers
        // replay of an add that already landed.
        if (
          error.code === '23505' &&
          error.constraint === 'collective_reactions_post_id_user_id_kind_key'
        ) {
          return
        }
        throw error
      }
    } else {
      // toggle === 'remove': delete by the reaction's primary key (id).
      // The caller passes the existing reaction's UUID as vars.id.
      // Deleting by PK avoids chaining multiple .eq() filters while
      // still being precise about which row to remove.
      const { error } = await supabase
        .from('collective_reactions')
        .delete()
        .eq('id', vars.id)
      if (error) throw error
    }
  },

  onMutate: async (vars: ToggleReactionVars): Promise<ReactMutationContext> => {
    await queryClient.cancelQueries({ queryKey: ['collective'] })

    const feedSnapshot = queryClient.getQueryData<InfiniteData<FeedPage>>(collectiveFeedKey)
    const threadSnapshot = queryClient.getQueryData<InfiniteData<ThreadPageResult>>(
      collectiveThreadKey(vars.post_id)
    )

    // Snapshot the per-post reactions cache for optimistic toggle + rollback.
    const reactionsSnapshot = queryClient.getQueryData<ReactionsCache>(
      collectiveReactionsKey(vars.post_id)
    )

    // Apply optimistic toggle on the reactions cache.
    if (reactionsSnapshot) {
      const prevCount = reactionsSnapshot.counts[vars.kind] ?? 0
      const optimistic: ReactionsCache = {
        counts: {
          ...reactionsSnapshot.counts,
          [vars.kind]:
            vars.toggle === 'add'
              ? prevCount + 1
              : Math.max(0, prevCount - 1),
        },
        userReactions: {
          ...reactionsSnapshot.userReactions,
          [vars.kind]: vars.toggle === 'add' ? vars.id : null,
        },
      }
      queryClient.setQueryData(collectiveReactionsKey(vars.post_id), optimistic)
    }

    return { feedSnapshot, threadSnapshot, reactionsSnapshot }
  },

  onError: (_err: unknown, vars: ToggleReactionVars, ctx: ReactMutationContext | undefined) => {
    // Restore every cache we may have modified — never set undefined.
    if (ctx?.feedSnapshot !== undefined) {
      queryClient.setQueryData(collectiveFeedKey, ctx.feedSnapshot)
    }
    if (ctx?.threadSnapshot !== undefined) {
      queryClient.setQueryData(collectiveThreadKey(vars.post_id), ctx.threadSnapshot)
    }
    if (ctx?.reactionsSnapshot !== undefined) {
      queryClient.setQueryData(collectiveReactionsKey(vars.post_id), ctx.reactionsSnapshot)
    }
  },

  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['collective'] })
  },
})

// ─── 3. collective.report ─────────────────────────────────────────────────────

queryClient.setMutationDefaults(['collective', 'report'], {
  gcTime: TWENTY_FOUR_HOURS_MS,

  mutationFn: async (vars: ReportPostVars) => {
    // PRIVACY (NFR19): note content is NEVER passed to console.log / Sentry /
    // any structured-logging helper. We pass `note` only to the DB insert.
    const insert: ReportInsert = {
      id: vars.id,
      post_id: vars.post_id,
      reporter_user_id: vars.reporter_user_id,
      reason_code: vars.reason_code,
      note: vars.note ?? null,
    }
    const { error } = await supabase.from('collective_reports').insert(insert)
    if (error) {
      // Swallow duplicate on the expected UNIQUE constraint (post_id,
      // reporter_user_id). Duplicate reports are intentionally allowed to
      // no-op on the server rather than returning an error to the user.
      if (
        error.code === '23505' &&
        error.constraint === 'collective_reports_post_id_reporter_user_id_key'
      ) {
        return
      }
      // Re-throw raw error — Sentry's beforeSend redactor is the SDK-level
      // enforcement for stripping PII from error captures. Do NOT log here.
      throw error
    }
  },

  // Report onMutate intentionally does NOT mutate any cache.
  // Local-hide behavior (Story 3.12) is handled at the component level via
  // Legend-State users.preferences.locallyHiddenPosts — NOT in this TQ mutation.
  onMutate: async (_vars: ReportPostVars): Promise<null> => {
    return null
  },

  onError: () => {
    // No cache was mutated in onMutate — nothing to restore.
  },

  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['collective'] })
  },
})

// ═══════════════════════════════════════════════════════════════════════════════
// Consumer hooks
// ═══════════════════════════════════════════════════════════════════════════════
//
// Each hook is a thin useMutation({ mutationKey }) with NO inline mutationFn.
// If a hook supplies its own mutationFn, the persisted-replay path will use
// it instead of the default — and any cold-start replay will close over stale
// runtime state from the dehydrated snapshot. This is the documented footgun.
// See provider/index.tsx:1–7 and the note at the top of this file.

export function useCreatePost(): UseMutationResult<
  unknown,
  Error,
  CreatePostVars,
  PostMutationContext
> {
  return useMutation<unknown, Error, CreatePostVars, PostMutationContext>({
    mutationKey: ['collective', 'post'],
  })
}

export function useToggleReaction(): UseMutationResult<
  unknown,
  Error,
  ToggleReactionVars,
  ReactMutationContext
> {
  return useMutation<unknown, Error, ToggleReactionVars, ReactMutationContext>({
    mutationKey: ['collective', 'react'],
  })
}

export function useReportPost(): UseMutationResult<unknown, Error, ReportPostVars, null> {
  return useMutation<unknown, Error, ReportPostVars, null>({
    mutationKey: ['collective', 'report'],
  })
}

// ─── Helper for per-call UUID generation ──────────────────────────────────────
// Callers may pass their own `id` (e.g. from a form state that was seeded
// before the first render) or use this helper which generates a UUID at
// call time. See the "ID GENERATION" note at the top of this file.
export function createPostWithId(
  vars: Omit<CreatePostVars, 'id'> & { id?: string }
): CreatePostVars {
  return { ...vars, id: vars.id ?? crypto.randomUUID() }
}
