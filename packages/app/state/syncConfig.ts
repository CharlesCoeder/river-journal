/**
 * state/syncConfig.ts
 *
 * Central Supabase sync configuration for Legend-State.
 * Sets up configureSyncedSupabase with shared defaults and provides
 * transform helpers for camelCase ↔ snake_case conversion at the sync boundary.
 *
 * Pattern: each observable that maps to a Supabase table uses syncedSupabase()
 * with these shared defaults. The observable holds camelCase data; transforms
 * convert to/from snake_case for the Supabase API.
 */

import { observable } from '@legendapp/state'
import { configureSyncedSupabase } from '@legendapp/state/sync-plugins/supabase'
import { supabase } from '../utils/supabase'
import { persistPlugin } from './persistConfig'
import type { Flow, Entry } from './types'
import type { EncryptionMode } from '../types/index'
import { v4 as uuidv4 } from 'uuid'
import {
  EncryptionError,
  assertCryptoGetRandomValues,
  base64ToBytes,
  decryptFlowContent,
  decryptFlowContentManaged,
  encryptFlowContent,
  encryptFlowContentManaged,
  isEncryptedFlowPayload,
  isManagedEncryptedPayload,
} from '../utils/encryption'
import { getCachedMasterKey } from '../utils/encryptionKeyStore'
import { fetchManagedEncryptionKey } from '../utils/userEncryption'

// =================================================================
// UUID GENERATION
// =================================================================

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Ensure crypto.getRandomValues is available before uuidv4 uses it,
  // preventing a silent Math.random() fallback on React Native.
  assertCryptoGetRandomValues()
  return uuidv4()
}

// =================================================================
// GLOBAL SYNC CONFIGURATION
// =================================================================

configureSyncedSupabase({
  generateId: generateUUID,
  changesSince: 'last-sync',
  fieldCreatedAt: 'created_at',
  fieldUpdatedAt: 'updated_at',
  fieldDeleted: 'is_deleted',
})

// =================================================================
// SYNC READINESS GATE
// =================================================================
// Standalone observables to avoid circular deps (store.ts ↔ flows.ts/entries.ts).
// initializeApp.ts wires these to store$.session reactively.

export const isSyncReady$ = observable(false)
export const syncUserId$ = observable<string | null>(null)
export const orphanFlowsPending$ = observable<{
  flowCount: number
  entryCount: number
  userId: string
} | null>(null)
export const syncEncryptionMode$ = observable<EncryptionMode | null>(null)
export const syncManagedKeyBytes$ = observable<Uint8Array | null>(null)

export interface SyncEncryptionError {
  message: string
  code: string
}

export const syncEncryptionError$ = observable<SyncEncryptionError | null>(null)

const toSyncEncryptionError = (message: string, code: string): SyncEncryptionError => ({
  message,
  code,
})

const setSyncEncryptionError = (message: string, code: string): never => {
  const syncError = toSyncEncryptionError(message, code)
  syncEncryptionError$.set(syncError)
  throw new EncryptionError(`${syncError.code}: ${syncError.message}`, code)
}

export const getManagedKeyBytes = async (
  userId?: string
): Promise<
  | { data: Uint8Array; error: null }
  | { data: null; error: SyncEncryptionError }
> => {
  const cached = syncManagedKeyBytes$.peek()
  if (cached) return { data: cached as Uint8Array, error: null }

  if (!userId) {
    return {
      data: null,
      error: toSyncEncryptionError(
        'Managed encryption key is unavailable because no authenticated user is present.',
        'missing_sync_user',
      ),
    }
  }

  const result = await fetchManagedEncryptionKey(userId)
  if (result.error) {
    return { data: null, error: toSyncEncryptionError(result.error.message, result.error.code) }
  }

  const keyBytes = base64ToBytes(result.data)
  syncManagedKeyBytes$.set(keyBytes)
  return { data: keyBytes, error: null }
}

// =================================================================
// SHARED EXPORTS
// =================================================================

export { supabase, persistPlugin }

// =================================================================
// TRANSFORM HELPERS: entries (daily_entries)
// =================================================================

interface DbEntryRow {
  id: string
  entry_date: string
  user_id: string
  created_at: string
  updated_at: string
  is_deleted?: boolean
}

export function dbEntryToLocal(row: DbEntryRow): Entry {
  return {
    id: row.id,
    entryDate: row.entry_date,
    lastModified: row.updated_at,
    user_id: row.user_id,
    local_session_id: '',
  }
}

export function localEntryToDb(value: Partial<Entry> & { id?: string }): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (value.id !== undefined) result.id = value.id
  if (value.entryDate !== undefined) result.entry_date = value.entryDate
  if (value.user_id !== undefined) result.user_id = value.user_id
  // lastModified → updated_at is handled by DB trigger, don't send it
  // local_session_id is local-only, never sent

  if (process.env.NODE_ENV === 'development') {
    const authUserId = syncUserId$.peek()
    // eslint-disable-next-line no-console
    console.log('🔍 [entries] localEntryToDb payload', {
      id: result.id,
      entry_date: result.entry_date,
      user_id: result.user_id,
      authUserId,
      match: result.user_id === authUserId,
    })
  }

  return result
}

// =================================================================
// TRANSFORM HELPERS: flows
// =================================================================

interface DbFlowRow {
  id: string
  daily_entry_id: string
  content: string
  word_count: number
  created_at: string
  updated_at: string
  is_deleted?: boolean
}

const decryptFlowContentFromDb = (content: string): string => {
  // Dispatch on payload prefix (self-describing) — not on user’s current mode
  if (isManagedEncryptedPayload(content)) {
    // Synchronous .peek() is safe: isSyncReady$ gate (via isEncryptionReadyForSync$)
    // ensures the managed key is cached before any sync transforms execute.
    const managedKey = syncManagedKeyBytes$.peek()
    if (!managedKey) {
      return setSyncEncryptionError(
        'Managed encryption key is not available. Please sign in again.',
        'managed_key_missing'
      )
    }

    try {
      const plaintext = decryptFlowContentManaged(content, managedKey as Uint8Array)
      return plaintext
    } catch (error) {
      if (error instanceof EncryptionError) {
        return setSyncEncryptionError(error.message, error.code)
      }
      const fallbackMessage =
        (error as Error).message || 'Failed to decrypt managed-mode flow content.'
      return setSyncEncryptionError(fallbackMessage, 'flow_decrypt_failed')
    }
  }

  if (!isEncryptedFlowPayload(content)) return content

  const userId = syncUserId$.peek()
  if (!userId) {
    return setSyncEncryptionError(
      'Encrypted flow cannot be decrypted because no authenticated user is available for key lookup.',
      'missing_sync_user'
    )
  }

  const key = getCachedMasterKey(userId)
  if (!key) {
    return setSyncEncryptionError(
      'Encryption password required on this device before encrypted flows can sync.',
      'e2e_password_required'
    )
  }

  try {
    const plaintext = decryptFlowContent(content, key)
    return plaintext
  } catch (error) {
    if (error instanceof EncryptionError) {
      return setSyncEncryptionError(error.message, error.code)
    }

    const fallbackMessage = (error as Error).message || 'Failed to decrypt encrypted flow content.'
    return setSyncEncryptionError(fallbackMessage, 'flow_decrypt_failed')
  }
}

const encryptFlowContentForDb = (content: string, userId: string): string => {
  const mode = syncEncryptionMode$.peek()

  if (mode === 'managed') {
    // Synchronous .peek() is safe: isSyncReady$ gate (via isEncryptionReadyForSync$)
    // ensures the managed key is cached before any sync transforms execute.
    const managedKey = syncManagedKeyBytes$.peek()
    if (!managedKey) {
      return setSyncEncryptionError(
        'Managed encryption key is not available. Please sign in again.',
        'managed_key_missing'
      )
    }

    try {
      const encryptedContent = encryptFlowContentManaged(content, managedKey as Uint8Array)
      return encryptedContent
    } catch (error) {
      if (error instanceof EncryptionError) {
        return setSyncEncryptionError(error.message, error.code)
      }
      const fallbackMessage = (error as Error).message || 'Failed to encrypt flow content.'
      return setSyncEncryptionError(fallbackMessage, 'flow_encrypt_failed')
    }
  }

  if (mode !== 'e2e') {
    return setSyncEncryptionError(
      'Encryption mode is not initialized. Cloud Sync cannot upload until encryption is configured.',
      'sync_encryption_mode_uninitialized'
    )
  }

  const key = getCachedMasterKey(userId)
  if (!key) {
    return setSyncEncryptionError(
      'Encryption password required on this device before encrypted flows can sync.',
      'e2e_password_required'
    )
  }

  try {
    const encryptedContent = encryptFlowContent(content, key)
    return encryptedContent
  } catch (error) {
    if (error instanceof EncryptionError) {
      return setSyncEncryptionError(error.message, error.code)
    }

    const fallbackMessage = (error as Error).message || 'Failed to encrypt flow content.'
    return setSyncEncryptionError(fallbackMessage, 'flow_encrypt_failed')
  }
}

export function dbFlowToLocal(row: DbFlowRow): Flow {
  const content = decryptFlowContentFromDb(row.content)

  return {
    id: row.id,
    dailyEntryId: row.daily_entry_id,
    timestamp: row.created_at,
    content,
    wordCount: row.word_count,
    local_session_id: '',
  }
}

export function mapDbFlowToLocalOrKeepExisting(
  row: DbFlowRow,
  existingLocalFlow?: Flow | null
): Flow | null {
  try {
    return dbFlowToLocal(row)
  } catch {
    return existingLocalFlow ?? null
  }
}

export function localFlowToDb(value: Partial<Flow> & { id?: string }): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (value.id !== undefined) result.id = value.id
  if (value.dailyEntryId !== undefined) result.daily_entry_id = value.dailyEntryId
  if (value.content !== undefined) {
    const userId = value.user_id || syncUserId$.peek()

    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.log('🔍 [flows] localFlowToDb payload', {
        id: result.id,
        daily_entry_id: result.daily_entry_id,
        userId,
        encryptionMode: syncEncryptionMode$.peek(),
        hasManagedKey: !!syncManagedKeyBytes$.peek(),
      })
    }

    if (!userId) {
      return setSyncEncryptionError(
        'Cannot upload flow content: no authenticated user available for encryption.',
        'missing_sync_user',
      )
    }
    result.content = encryptFlowContentForDb(value.content, userId)
  }
  if (value.wordCount !== undefined) result.word_count = value.wordCount
  if (value.timestamp !== undefined) result.created_at = value.timestamp
  // updated_at handled by DB trigger
  // local_session_id is local-only
  // user_id is not a flows column (association through daily_entries)
  return result
}
