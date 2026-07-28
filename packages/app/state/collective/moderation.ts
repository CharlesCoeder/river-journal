// packages/app/state/collective/moderation.ts
//
// TanStack Query hook layer for the admin moderation queue.
//
// Surface:
//   - `moderationQueueKey`        canonical query-key tuple for the queue
//   - `lastModerationActionKey`   query-key tuple for the last-action timestamp
//   - `ModerationQueueItem`       row shape (derived from the generated type)
//   - `fetchModerationQueue()`    pure async fetcher (single bounded page)
//   - `useModerationQueue()`      useQuery wrapper (calm-realtime cadence)
//   - `useLastModerationActionAt()` last moderation-action timestamp (empty state)
//
// Boundary rule (D7): this file is on the TanStack Query side of the v2
// architecture split and must remain free of Legend-State imports. The narrow
// observe() exception that lives in `feed.ts` does NOT extend here.

import { useQuery } from '@tanstack/react-query'
import { supabase } from 'app/utils/supabase'
import type { Database } from 'app/types/database'

/**
 * Canonical query key for the moderation queue. `as const` preserves the
 * literal-tuple type so the removal/suspension/note mutations can invalidate
 * the whole `['moderation']` prefix on success and let this queue re-fetch.
 */
export const moderationQueueKey = ['moderation', 'queue'] as const

/**
 * Query key for the last moderation-action timestamp (empty-state copy only).
 * Shares the `['moderation']` prefix so a broad prefix invalidation refreshes
 * it alongside the queue.
 */
export const lastModerationActionKey = ['moderation', 'lastAction'] as const

/**
 * Row shape returned by `collective_moderation_queue`, derived from the
 * generated `Database` type (never hand-rolled), mirroring `feed.ts`'s `Post`.
 */
export type ModerationQueueItem =
  Database['public']['Functions']['collective_moderation_queue']['Returns'][number]

/**
 * Pure async fetcher for the moderation queue.
 *
 * Single bounded page (cap 100) — the queue is small for a solo operator. If
 * the queue routinely exceeds the cap, add cursor pagination later; the future
 * operational queue-depth metric — not this fetcher — is the overflow alarm.
 * Do NOT build infinite pagination here.
 */
export async function fetchModerationQueue(): Promise<ModerationQueueItem[]> {
  const { data, error } = await supabase.rpc('collective_moderation_queue', {
    page_size: 100,
  })
  if (error) throw error
  return data ?? []
}

/**
 * `useQuery` wrapper for the moderation queue.
 *
 * Config rationale (mirrors the feed cadence):
 *   - `staleTime: 25_000` < `refetchInterval: 30_000` — calm-realtime cadence
 *     (staleTime must be < refetchInterval for the poll to fire). The queue
 *     converges even without an explicit invalidation.
 *   - `refetchOnWindowFocus: true` — pick up state changes on return.
 *
 * The removal/suspension/note mutations invalidate the `['moderation']` prefix
 * to refresh this queue.
 */
export function useModerationQueue() {
  return useQuery({
    queryKey: moderationQueueKey,
    queryFn: fetchModerationQueue,
    refetchInterval: 30_000,
    staleTime: 25_000,
    refetchOnWindowFocus: true,
  })
}

/**
 * `useQuery` wrapper reading the newest `moderation_actions.created_at`, used
 * only for the empty-state timestamp ("Queue clear." + last action). Direct
 * admin SELECT is permitted here — `moderation_actions` has the
 * `moderation_actions_select_admin` RLS policy + `GRANT SELECT TO
 * authenticated` (unlike `collective_posts`, which requires a DEFINER RPC).
 */
export function useLastModerationActionAt() {
  return useQuery({
    queryKey: lastModerationActionKey,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('moderation_actions')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data?.created_at ?? null
    },
  })
}
