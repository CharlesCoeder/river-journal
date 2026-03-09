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
  mapDbFlowToLocalOrKeepExisting,
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

    // Use upsert for creates to handle re-syncing flows that already exist
    // in Supabase (e.g., anonymous flows adopted after login). Without this,
    // Legend-State's default INSERT hits the PK constraint → 409 Conflict.
    create: (input: any) =>
      supabase
        .from('flows')
        .upsert(input, { onConflict: 'id' })
        .select()
        .single(),

    transform: {
      load: (value: any) => {
        if (!value) return value
        if (Array.isArray(value)) {
          if (process.env.NODE_ENV === 'development') {
            const localFlowIds = Object.keys(flows$.peek() ?? {})
            // eslint-disable-next-line no-console
            console.log(
              `📥 [flows] list response: ${value.length} rows from Supabase (local has ${localFlowIds.length} flows)`,
              { serverIds: value.map((r: any) => r.id?.slice(0, 8)), localIds: localFlowIds.map(id => id.slice(0, 8)) }
            )
          }
          return value
            .map((row: any) =>
              mapDbFlowToLocalOrKeepExisting(row, row?.id ? flows$.peek()?.[row.id] ?? null : null)
            )
            .filter((row: Flow | null): row is Flow => row !== null)
        }
        if (value.daily_entry_id !== undefined) {
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.log('📥 [flows] single row save-response transformed', value.id)
          }
          return mapDbFlowToLocalOrKeepExisting(
            value,
            value?.id ? flows$.peek()?.[value.id] ?? null : null
          )
        }
        return value
      },
      save: (value: any) => {
        if (!value) return value
        // Skip syncing flows with no user_id (anonymous/orphan data).
        // adoptOrphanFlows() will stamp the user_id, then the item will sync.
        if (!value.user_id) return undefined
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.log('📤 [flows] outgoing create/update', value.id ?? '(new)')
        }
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
