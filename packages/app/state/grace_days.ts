/**
 * state/grace_days.ts
 *
 * Synced observable for user grace day data, keyed by GraceDay ID.
 * Uses syncedSupabase() for both local persistence and remote Supabase sync.
 * The observable holds camelCase data; transforms convert at the sync boundary.
 *
 * PLAINTEXT — no encryption. This table uses syncedSupabase() purely for the
 * convenience of Legend-State observable + offline replay + RLS scoping.
 * Transforms only convert camelCase ↔ snake_case (architecture D2 / G3).
 */

import { observable } from '@legendapp/state'
import { syncedSupabase } from '@legendapp/state/sync-plugins/supabase'
import type { GraceDay } from './types'
import {
  supabase,
  persistPlugin,
  isSyncReady$,
  syncUserId$,
  dbGraceDayToLocal,
  localGraceDayToDb,
} from './syncConfig'

export const graceDays$ = observable<Record<string, GraceDay>>(
  syncedSupabase({
    supabase,
    collection: 'user_grace_days',
    actions: ['read', 'create', 'update', 'delete'],

    filter: (select) => {
      const userId = syncUserId$.peek()
      if (!userId) return select
      return select.eq('user_id', userId)
    },

    transform: {
      load: (value: any) => {
        if (!value) return value
        if (Array.isArray(value)) return value.map(dbGraceDayToLocal)
        if (value.user_id !== undefined) return dbGraceDayToLocal(value)
        return value
      },
      save: (value: any) => {
        if (!value) return value
        // No orphan adoption for grace days — see GraceDay type comment.
        // Skip rows belonging to a different user (stale local persistence
        // after user-switch). Mirrors entries.ts pattern.
        const currentUserId = syncUserId$.peek()
        if (currentUserId && value.userId && value.userId !== currentUserId) return undefined
        return localGraceDayToDb(value)
      },
    },

    waitFor: isSyncReady$,
    waitForSet: isSyncReady$,

    persist: { name: 'grace-days', plugin: persistPlugin, retrySync: true },
    retry: { infinite: true, backoff: 'exponential', maxDelay: 30 },
  })
)
