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

// =================================================================
// UUID GENERATION
// =================================================================

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID
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
export const orphanFlowsPending$ = observable<{ flowCount: number; entryCount: number; userId: string } | null>(null)
export const syncEncryptionMode$ = observable<EncryptionMode | null>(null)
export const syncEncryptionSalt$ = observable<string | null>(null)
export const syncEncryptionKeyState$ = observable<'unknown' | 'available' | 'missing'>('unknown')
export const syncEncryptionKeyBackend$ = observable<'secure' | 'session' | null>(null)
export const syncEncryptionError$ = observable<{ message: string; code: string } | null>(null)
export const encryptionSyncLockRequested$ = observable(false)

export const clearSyncEncryptionError = () => {
  syncEncryptionError$.set(null)
}

export const requestEncryptionSyncLock = (error: { message: string; code: string }) => {
  syncEncryptionError$.set(error)
  isSyncReady$.set(false)
  encryptionSyncLockRequested$.set(true)
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

export function dbFlowToLocal(row: DbFlowRow): Flow {
  return {
    id: row.id,
    dailyEntryId: row.daily_entry_id,
    timestamp: row.created_at,
    content: row.content,
    wordCount: row.word_count,
    local_session_id: '',
  }
}

export function localFlowToDb(value: Partial<Flow> & { id?: string }): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (value.id !== undefined) result.id = value.id
  if (value.dailyEntryId !== undefined) result.daily_entry_id = value.dailyEntryId
  if (value.content !== undefined) result.content = value.content
  if (value.wordCount !== undefined) result.word_count = value.wordCount
  if (value.timestamp !== undefined) result.created_at = value.timestamp
  // updated_at handled by DB trigger
  // local_session_id is local-only
  // user_id is not a flows column (association through daily_entries)
  return result
}
