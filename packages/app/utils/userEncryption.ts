import { supabase } from './supabase'
import type { TablesInsert } from '../types/database'
import type { EncryptionMode } from '../types/index'
import {
  bytesToKeyHex,
  deriveMasterKey,
  generateEncryptionSalt,
} from './encryption'
import {
  deleteEncryptionKey,
  saveEncryptionKey,
} from './encryptionKeyStore'

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

const toSettings = (input: {
  encryption_mode: EncryptionMode | null
  encryption_salt: string | null
}): EncryptionSettings => ({
  mode: normalizeEncryptionMode(input.encryption_mode),
  salt: input.encryption_salt ?? null,
})

const upsertUserEncryptionSettings = async (input: {
  userId: string
  mode: EncryptionMode | null
  salt?: string | null
}): Promise<{ data: EncryptionSettings; error: null } | { data: null; error: EncryptionSettingsError['error'] }> => {
  const payload: TablesInsert<'users'> = {
    id: input.userId,
    encryption_mode: input.mode,
    encryption_salt: input.salt ?? null,
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
    data: toSettings(data),
    error: null,
  }
}

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
  return upsertUserEncryptionSettings({
    userId: input.userId,
    mode: input.mode,
  })
}

export async function startE2EEncryptionBootstrap(input: {
  userId: string
  password: string
}): Promise<
  | { data: { mode: 'e2e'; salt: string; keyBackend: 'secure' | 'session' }; error: null }
  | { data: null; error: EncryptionSettingsError['error'] }
> {
  let salt: string
  let keyHex: string

  try {
    salt = await generateEncryptionSalt()
    keyHex = bytesToKeyHex(await deriveMasterKey(input.password, salt))
  } catch {
    return {
      data: null,
      error: toEncryptionError(
        'Could not derive the encryption key on this device.',
        'encryption_bootstrap_failed'
      ).error,
    }
  }

  const persistedSettings = await upsertUserEncryptionSettings({
    userId: input.userId,
    mode: 'e2e',
    salt,
  })

  if (persistedSettings.error) {
    return {
      data: null,
      error: persistedSettings.error,
    }
  }

  const keySaveResult = await saveEncryptionKey(input.userId, keyHex)
  if (keySaveResult.error) {
    await deleteEncryptionKey(input.userId)

    const rollbackResult = await upsertUserEncryptionSettings({
      userId: input.userId,
      mode: null,
      salt: null,
    })

    return {
      data: null,
      error:
        rollbackResult.error ??
        toEncryptionError(
          'This device could not store the encryption key securely.',
          'encryption_key_storage_failed'
        ).error,
    }
  }

  return {
    data: {
      mode: 'e2e',
      salt,
      keyBackend: keySaveResult.backend,
    },
    error: null,
  }
}
