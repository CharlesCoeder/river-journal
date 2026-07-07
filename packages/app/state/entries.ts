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

    // Insert-or-IGNORE for creates, to handle the UNIQUE(user_id, entry_date)
    // constraint when two devices create the same day's entry offline.
    //
    // We deliberately do NOT use a merge-upsert here. A merge-upsert
    // (`ON CONFLICT DO UPDATE SET ...`) rewrites EVERY column in the payload,
    // including the primary key `id`, to the incoming row's value. Because
    // `flows.daily_entry_id REFERENCES daily_entries(id)` has no ON UPDATE
    // CASCADE, rewriting a conflicting row's `id` either (a) raises a
    // foreign_key_violation when the winning row already has child flows —
    // spinning the infinite retry below forever — or (b) silently swaps the
    // canonical id, orphaning the other device's flows that point at it.
    //
    // `ignoreDuplicates: true` emits `ON CONFLICT DO NOTHING`, so the existing
    // row (and its id) is left untouched and remains canonical. On a real
    // insert, RETURNING yields the new row. On a conflict, RETURNING is empty,
    // so we read the canonical server row back and hand it to the load
    // transform, letting the client converge onto the winning id.
    //
    // NOTE (multi-device convergence, human decision pending): this stops all
    // server-side PK corruption, but the *losing* device's local entry stays
    // keyed by its original client id while its `.id` field converges to the
    // winner. Legend-State keys records by object key, not by fieldId, so it
    // will not re-key the entry or re-point that device's local flows
    // (dailyEntryId still references the losing id). Fully healing the losing
    // device needs either deterministic entry ids per (user_id, entry_date)
    // — note generateEntryId(date) already takes the date and currently
    // ignores it — or an explicit client reconciliation pass. See report.
    create: async (input: any) => {
      const inserted = await supabase
        .from('daily_entries')
        .upsert(input, { onConflict: 'user_id,entry_date', ignoreDuplicates: true })
        .select()

      if (inserted.error) return inserted
      if (inserted.data && inserted.data.length > 0) {
        return { data: inserted.data[0], error: null }
      }

      // Conflict: a row for this (user_id, entry_date) already exists. Return
      // the canonical server row so the client can converge onto its id.
      return supabase
        .from('daily_entries')
        .select()
        .eq('user_id', input.user_id)
        .eq('entry_date', input.entry_date)
        .single()
    },

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
