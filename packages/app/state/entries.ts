/**
 * state/entries.ts
 *
 * Synced observable for daily entry data, keyed by Entry ID.
 * Uses syncedSupabase() for both local persistence and remote Supabase sync.
 * The observable holds camelCase data; transforms convert at the sync boundary.
 */

import { observable } from '@legendapp/state'
import { syncedSupabase } from '@legendapp/state/sync-plugins/supabase'
import type { Entry } from './types'
import {
  supabase,
  persistPlugin,
  isSyncReady$,
  syncUserId$,
  dbEntryToLocal,
  localEntryToDb,
} from './syncConfig'

// =================================================================
// ENTRIES OBSERVABLE
// =================================================================

export const entries$ = observable<Record<string, Entry>>(
  syncedSupabase({
    supabase,
    collection: 'daily_entries',
    actions: ['read', 'create', 'update'],

    // Scope reads to the authenticated user (RLS also enforces this server-side)
    filter: (select) => {
      const userId = syncUserId$.peek()
      if (!userId) return select
      return select.eq('user_id', userId)
    },

    // Use upsert for creates to handle the UNIQUE(user_id, entry_date) constraint.
    // If two devices create entries for the same date, the second becomes a no-op
    // instead of throwing a constraint violation the user would see.
    create: (input: any) =>
      supabase
        .from('daily_entries')
        .upsert(input, { onConflict: 'user_id,entry_date' })
        .select()
        .single(),

    transform: {
      load: (value: any) => {
        if (!value) return value
        if (Array.isArray(value)) {
          if (process.env.NODE_ENV === 'development') {
            const localEntryIds = Object.keys(entries$.peek() ?? {})
            // eslint-disable-next-line no-console
            console.log(
              `📥 [entries] list response: ${value.length} rows from Supabase (local has ${localEntryIds.length} entries)`,
              { serverIds: value.map((r: any) => r.id?.slice(0, 8)), localIds: localEntryIds.map(id => id.slice(0, 8)) }
            )
          }
          return value.map((row: any) => dbEntryToLocal(row))
        }
        if (value.entry_date !== undefined) {
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.log('📥 [entries] single row save-response transformed', value.id)
          }
          return dbEntryToLocal(value)
        }
        return value
      },
      save: (value: any) => {
        if (!value) return value
        // Skip syncing entries with no user_id (anonymous/orphan data).
        // adoptOrphanFlows() will stamp the user_id, then the item will sync.
        if (!value.user_id) return undefined
        // Skip entries belonging to a different user — prevents RLS 403 from
        // stale data left in local persistence after a user switch.
        const currentUserId = syncUserId$.peek()
        if (currentUserId && value.user_id !== currentUserId) {
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.warn('⚠️ [entries] skipping stale entry (user mismatch)', {
              entryId: value.id?.slice(0, 8),
              entryUserId: value.user_id?.slice(0, 8),
              currentUserId: currentUserId.slice(0, 8),
            })
          }
          return undefined
        }
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.log('📤 [entries] outgoing create/update', value.id ?? '(new)')
        }
        return localEntryToDb(value)
      },
    },

    waitFor: isSyncReady$,
    waitForSet: isSyncReady$,

    persist: {
      name: 'entries',
      plugin: persistPlugin,
      retrySync: true,
    },

    retry: {
      infinite: true,
      backoff: 'exponential',
      maxDelay: 30,
    },
  })
)
