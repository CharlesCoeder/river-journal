/**
 * state/flows.ts
 *
 * Synced observable for flow data, keyed by Flow ID.
 * Uses syncedSupabase() for both local persistence and remote Supabase sync.
 * The observable holds camelCase data; transforms convert at the sync boundary.
 *
 * Soft deletes: when fieldDeleted is configured, calling .delete() on a flow
 * sets is_deleted=true in Supabase rather than hard-deleting.
 */

import { observable } from '@legendapp/state'
import { syncedSupabase } from '@legendapp/state/sync-plugins/supabase'
import type { Flow } from './types'
import {
  supabase,
  persistPlugin,
  isSyncReady$,
  dbFlowToLocal,
  localFlowToDb,
} from './syncConfig'

// =================================================================
// FLOWS OBSERVABLE
// =================================================================

export const flows$ = observable<Record<string, Flow>>(
  syncedSupabase({
    supabase,
    collection: 'flows',
    actions: ['read', 'create', 'update', 'delete'],

    // No client-side filter needed — flows RLS scopes via daily_entries.user_id
    // which is enforced server-side through the EXISTS subquery policy.

    transform: {
      load: (value: any) => {
        if (!value) return value
        if (Array.isArray(value)) {
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.log(`📥 [flows] list response: ${value.length} rows from Supabase`)
          }
          return value.map((row: any) => dbFlowToLocal(row))
        }
        if (value.daily_entry_id !== undefined) {
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.log('📥 [flows] single row save-response transformed', value.id)
          }
          return dbFlowToLocal(value)
        }
        return value
      },
      save: (value: any) => {
        if (process.env.NODE_ENV === 'development' && value) {
          // eslint-disable-next-line no-console
          console.log('📤 [flows] outgoing create/update', value.id ?? '(new)')
        }
        if (!value) return value
        return localFlowToDb(value)
      },
    },

    waitFor: isSyncReady$,
    waitForSet: isSyncReady$,

    persist: {
      name: 'flows',
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
