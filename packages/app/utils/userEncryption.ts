import { supabase } from './supabase'
import type { TablesInsert } from '../types/database'
import type { EncryptionMode } from '../types/index'

export interface EncryptionSettings {
  mode: EncryptionMode | null
  salt: string | null
}

export interface EncryptionSettingsError {
  error: {
    message: string
    code: string
  }
}

const normalizeEncryptionMode = (value: string | null | undefined): EncryptionMode | null => {
  if (value === 'e2e' || value === 'managed') return value
  return null
}

const toEncryptionError = (message: string, code: string): EncryptionSettingsError => ({
  error: { message, code },
})

export async function readUserEncryptionSettings(
  userId: string
): Promise<{ data: EncryptionSettings; error: null } | { data: null; error: EncryptionSettingsError['error'] }> {
  const { data, error } = await supabase
    .from('users')
    .select('encryption_mode, encryption_salt')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    return {
      data: null,
      error: toEncryptionError(error.message, error.code ?? 'users_read_failed').error,
    }
  }

  return {
    data: {
      mode: normalizeEncryptionMode(data?.encryption_mode),
      salt: data?.encryption_salt ?? null,
    },
    error: null,
  }
}

export async function upsertUserEncryptionMode(input: {
  userId: string
  mode: EncryptionMode
}): Promise<{ data: EncryptionSettings; error: null } | { data: null; error: EncryptionSettingsError['error'] }> {
  const payload: TablesInsert<'users'> = {
    id: input.userId,
    encryption_mode: input.mode,
  }

  const { data, error } = await supabase
    .from('users')
    .upsert(payload, { onConflict: 'id' })
    .select('encryption_mode, encryption_salt')
    .single()

  if (error) {
    return {
      data: null,
      error: toEncryptionError(error.message, error.code ?? 'users_upsert_failed').error,
    }
  }

  return {
    data: {
      mode: normalizeEncryptionMode(data.encryption_mode),
      salt: data.encryption_salt ?? null,
    },
    error: null,
  }
}

export async function startE2EEncryptionBootstrap(_input: {
  userId: string
  password: string
}): Promise<{ error: null } | { error: EncryptionSettingsError['error'] }> {
  return {
    error: toEncryptionError(
      'End-to-end encrypted cloud sync is not available in this build yet. Your mode choice was saved, but Cloud Sync stays off until Story 4.2 lands.',
      'e2e_bootstrap_pending'
    ).error,
  }
}
