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
  requestEncryptionSyncLock,
  syncEncryptionError$,
  syncEncryptionMode$,
  syncUserId$,
} from './syncConfig'
import { loadEncryptionKey } from '../utils/encryptionKeyStore'
import {
  decryptFlowContent,
  encryptFlowContent,
  EncryptedPayloadError,
  isEncryptedFlowContent,
  keyHexToBytes,
} from '../utils/encryption'

interface DbFlowRow {
  id: string
  daily_entry_id: string
  content: string
  word_count: number
  created_at: string
  updated_at: string
  is_deleted?: boolean
}

const getRequiredKeyBytes = async (userId: string): Promise<Uint8Array> => {
  const { keyHex } = await loadEncryptionKey(userId)

  if (!keyHex) {
    requestEncryptionSyncLock({
      message: 'This device still needs your encryption password before Cloud Sync can turn on.',
      code: 'encryption_key_required',
    })
    throw new Error('E2E key is unavailable on this device.')
  }

  return keyHexToBytes(keyHex)
}

export const transformRemoteFlowRow = async (row: DbFlowRow): Promise<Flow> => {
  if (!isEncryptedFlowContent(row.content)) {
    return dbFlowToLocal(row)
  }

  const userId = syncUserId$.peek()
  if (!userId) {
    requestEncryptionSyncLock({
      message: 'Cloud Sync requires an authenticated user before encrypted flows can be decrypted.',
      code: 'flow_decrypt_failed',
    })
    throw new Error('Cannot decrypt flow content without an authenticated user.')
  }

  try {
    const decryptedContent = await decryptFlowContent(row.content, await getRequiredKeyBytes(userId))
    return dbFlowToLocal({
      ...row,
      content: decryptedContent,
    })
  } catch (error) {
    requestEncryptionSyncLock({
      message:
        error instanceof EncryptedPayloadError
          ? 'An encrypted journal payload is malformed or uses an unsupported version.'
          : 'Encrypted journal content could not be decrypted on this device.',
      code: error instanceof EncryptedPayloadError ? 'encrypted_payload_invalid' : 'flow_decrypt_failed',
    })
    throw error
  }
}

export const transformLocalFlowForRemote = async (
  value: Partial<Flow> & { id?: string }
): Promise<Record<string, unknown> | undefined> => {
  if (!value.user_id) return undefined

  if (syncEncryptionMode$.peek() !== 'e2e') {
    return localFlowToDb(value)
  }

  try {
    const encryptedContent = await encryptFlowContent(
      value.content ?? '',
      await getRequiredKeyBytes(value.user_id)
    )

    return localFlowToDb({
      ...value,
      content: encryptedContent,
    })
  } catch (error) {
    if (syncEncryptionError$.peek()?.code !== 'encryption_key_required') {
      requestEncryptionSyncLock({
        message: 'Encrypted journal content could not be prepared for upload on this device.',
        code: 'flow_encrypt_failed',
      })
    }
    throw error
  }
}

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
      load: async (value: any) => {
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
          return Promise.all(value.map((row: DbFlowRow) => transformRemoteFlowRow(row)))
        }
        if (value.daily_entry_id !== undefined) {
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.log('📥 [flows] single row save-response transformed', value.id)
          }
          return transformRemoteFlowRow(value as DbFlowRow)
        }
        return value
      },
      save: async (value: any) => {
        if (!value) return value
        // Skip syncing flows with no user_id (anonymous/orphan data).
        // adoptOrphanFlows() will stamp the user_id, then the item will sync.
        if (!value.user_id) return undefined
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.log('📤 [flows] outgoing create/update', value.id ?? '(new)')
        }
        return transformLocalFlowForRemote(value)
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
