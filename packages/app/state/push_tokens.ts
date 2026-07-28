/**
 * state/push_tokens.ts
 *
 * Synced observable for device push tokens, keyed by push-token ID.
 * Uses syncedSupabase() for both local persistence and remote Supabase sync.
 * The observable holds camelCase data; transforms convert at the sync boundary.
 *
 * PLAINTEXT — server-visible, opted out of the content-protection boundary.
 * This table uses syncedSupabase() purely for the convenience of Legend-State
 * observable + offline replay + RLS scoping. Transforms only convert
 * camelCase ↔ snake_case (architecture D2 / D7).
 *
 * This module is platform-agnostic and imports NO native APIs: the native
 * notifications SDK is isolated to utils/pushTokens.{ts,native.ts}.
 */

import { observable } from '@legendapp/state'
import { syncedSupabase } from '@legendapp/state/sync-plugins/supabase'
import type { PushToken } from './types'
import {
  supabase,
  persistPlugin,
  isSyncReady$,
  syncUserId$,
  dbPushTokenToLocal,
  localPushTokenToDb,
} from './syncConfig'

export const pushTokens$ = observable<Record<string, PushToken>>(
  syncedSupabase({
    supabase,
    collection: 'user_push_tokens',
    actions: ['read', 'create', 'update', 'delete'],

    filter: (select) => {
      const userId = syncUserId$.peek()
      if (!userId) return select
      return select.eq('user_id', userId)
    },

    transform: {
      load: (value: any) => {
        if (!value) return value
        if (Array.isArray(value)) return value.map(dbPushTokenToLocal)
        if (value.user_id !== undefined) return dbPushTokenToLocal(value)
        return value
      },
      save: (value: any) => {
        if (!value) return value
        // No orphan adoption for push tokens — see PushToken type comment.
        // Skip rows belonging to a different user (stale local persistence
        // after user-switch). Mirrors grace_days.ts / entries.ts pattern.
        const currentUserId = syncUserId$.peek()
        if (currentUserId && value.userId && value.userId !== currentUserId) return undefined
        return localPushTokenToDb(value)
      },
    },

    waitFor: isSyncReady$,
    waitForSet: isSyncReady$,

    persist: { name: 'push-tokens', plugin: persistPlugin, retrySync: true },
    retry: { infinite: true, backoff: 'exponential', maxDelay: 30 },
  })
)
