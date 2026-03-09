import { supabase } from './supabase'
import type { TablesInsert } from '../types/database'
import type { EncryptionMode } from '../types/index'
import {
  EncryptionError,
  deriveMasterKeyFromPassword,
  generateEncryptionSaltHex,
} from './encryption'
import { clearStoredMasterKey, storeMasterKey } from './encryptionKeyStore'

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
): Promise<
  | { data: EncryptionSettings; error: null }
  | { data: null; error: EncryptionSettingsError['error'] }
> {
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
}): Promise<
  | { data: EncryptionSettings; error: null }
  | { data: null; error: EncryptionSettingsError['error'] }
> {
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
  const input = _input
  let shouldCleanupLocalKey = false

  if (!input.password.trim()) {
    return {
      error: toEncryptionError('Encryption password is required.', 'missing_password').error,
    }
  }

  try {
    const salt = generateEncryptionSaltHex()
    const masterKey = deriveMasterKeyFromPassword(input.password, salt)
    const payload: TablesInsert<'users'> = {
      id: input.userId,
      encryption_mode: 'e2e',
      encryption_salt: salt,
    }

    const { error } = await supabase
      .from('users')
      .upsert(payload, { onConflict: 'id' })
      .select('encryption_mode, encryption_salt')
      .single()

    if (error) {
      shouldCleanupLocalKey = true
      return {
        error: toEncryptionError(error.message, error.code ?? 'users_upsert_failed').error,
      }
    }

    try {
      await storeMasterKey(input.userId, masterKey)
    } catch (error) {
      shouldCleanupLocalKey = true
      return {
        error: toEncryptionError(
          (error as Error).message || 'Failed to store encryption key on this device.',
          'local_key_store_failed'
        ).error,
      }
    }

    return { error: null }
  } catch (error) {
    shouldCleanupLocalKey = true
    if (error instanceof EncryptionError) {
      return {
        error: toEncryptionError(error.message, error.code).error,
      }
    }

    return {
      error: toEncryptionError(
        (error as Error).message || 'Failed to bootstrap end-to-end encryption.',
        'e2e_bootstrap_failed'
      ).error,
    }
  } finally {
    if (shouldCleanupLocalKey) {
      await clearStoredMasterKey(input.userId)
    }
  }
}

export async function unlockE2EEncryptionOnDevice(input: {
  userId: string
  password: string
  salt: string
}): Promise<{ error: null } | { error: EncryptionSettingsError['error'] }> {
  let shouldCleanupLocalKey = false

  if (!input.password.trim()) {
    return {
      error: toEncryptionError('Encryption password is required.', 'missing_password').error,
    }
  }

  try {
    const masterKey = deriveMasterKeyFromPassword(input.password, input.salt)
    shouldCleanupLocalKey = true
    await storeMasterKey(input.userId, masterKey)
    shouldCleanupLocalKey = false
    return { error: null }
  } catch (error) {
    if (error instanceof EncryptionError) {
      return {
        error: toEncryptionError(error.message, error.code).error,
      }
    }

    return {
      error: toEncryptionError(
        (error as Error).message || 'Failed to unlock end-to-end encryption on this device.',
        'local_key_store_failed'
      ).error,
    }
  } finally {
    if (shouldCleanupLocalKey) {
      await clearStoredMasterKey(input.userId)
    }
  }
}
