import { supabase } from './supabase'
import type { Tables, TablesInsert } from '../types/database'
import type { EncryptionMode } from '../types/index'
import {
  EncryptionError,
  decryptFlowContent,
  deriveMasterKeyFromPassword,
  generateEncryptionSaltHex,
  generateManagedEncryptionKey,
  isHexString,
  isEncryptedFlowPayload,
} from './encryption'
import { cacheOnlyMasterKey, clearStoredMasterKey, storeMasterKey } from './encryptionKeyStore'

export interface EncryptionSettings {
  mode: EncryptionMode | null
  salt: string | null
  managedKeyHex: string | null
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

const INVALID_ENCRYPTION_PASSWORD_ERROR = {
  message: 'Encryption password is incorrect for this account.',
  code: 'invalid_encryption_password',
} satisfies EncryptionSettingsError['error']

type FlowVerificationRow = Pick<Tables<'flows'>, 'id' | 'content'>

export async function readUserEncryptionSettings(
  userId: string
): Promise<
  | { data: EncryptionSettings; error: null }
  | { data: null; error: EncryptionSettingsError['error'] }
> {
  const { data, error } = await supabase
    .from('users')
    .select('encryption_mode, encryption_salt, managed_encryption_key')
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
      managedKeyHex: data?.managed_encryption_key ?? null,
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
    .select('encryption_mode, encryption_salt, managed_encryption_key')
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
      managedKeyHex: data.managed_encryption_key ?? null,
    },
    error: null,
  }
}

export async function startE2EEncryptionBootstrap(_input: {
  userId: string
  password: string
}): Promise<{ error: null; masterKey: Uint8Array } | { error: EncryptionSettingsError['error']; masterKey: null }> {
  const input = _input

  if (!input.password.trim()) {
    return {
      error: toEncryptionError('Encryption password is required.', 'missing_password').error,
      masterKey: null,
    }
  }

  try {
    const salt = generateEncryptionSaltHex()
    const masterKey = await deriveMasterKeyFromPassword(input.password, salt)
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
      return {
        error: toEncryptionError(error.message, error.code ?? 'users_upsert_failed').error,
        masterKey: null,
      }
    }

    // Phase 1: cache in memory only — keyring persistence is deferred
    cacheOnlyMasterKey(input.userId, masterKey)

    return { error: null, masterKey }
  } catch (error) {
    if (error instanceof EncryptionError) {
      return {
        error: toEncryptionError(error.message, error.code).error,
        masterKey: null,
      }
    }

    return {
      error: toEncryptionError(
        (error as Error).message || 'Failed to bootstrap end-to-end encryption.',
        'e2e_bootstrap_failed'
      ).error,
      masterKey: null,
    }
  }
}

export async function validateE2EMasterKeyForUser(input: {
  masterKey: Uint8Array
  invalidKeyMessage?: string
  invalidKeyCode?: string
}): Promise<{ error: null; didVerify: boolean } | { error: EncryptionSettingsError['error']; didVerify: boolean }> {
  const { data, error } = await supabase.from('flows').select('id, content').limit(50)

  if (error) {
    return {
      error: toEncryptionError(error.message, error.code ?? 'flows_read_failed').error,
      didVerify: false,
    }
  }

  const encryptedFlow = ((data ?? []) as FlowVerificationRow[]).find(flow =>
    isEncryptedFlowPayload(flow.content)
  )

  if (!encryptedFlow) {
    return { error: null, didVerify: false }
  }

  try {
    decryptFlowContent(encryptedFlow.content, input.masterKey)
    return { error: null, didVerify: true }
  } catch (error) {
    if (error instanceof EncryptionError && error.code === 'flow_decrypt_failed') {
      return {
        error: toEncryptionError(
          input.invalidKeyMessage ?? INVALID_ENCRYPTION_PASSWORD_ERROR.message,
          input.invalidKeyCode ?? INVALID_ENCRYPTION_PASSWORD_ERROR.code
        ).error,
        didVerify: true,
      }
    }

    if (error instanceof EncryptionError) {
      return {
        error: toEncryptionError(error.message, error.code).error,
        didVerify: true,
      }
    }

    return {
      error: toEncryptionError(
        (error as Error).message || 'Failed to verify the encryption key for this account.',
        'flow_decrypt_failed'
      ).error,
      didVerify: true,
    }
  }
}

export async function unlockE2EEncryptionOnDevice(input: {
  userId: string
  password: string
  salt: string
}): Promise<{ error: null; masterKey: Uint8Array } | { error: EncryptionSettingsError['error']; masterKey: null }> {
  if (!input.password.trim()) {
    return {
      error: toEncryptionError('Encryption password is required.', 'missing_password').error,
      masterKey: null,
    }
  }

  try {
    const masterKey = await deriveMasterKeyFromPassword(input.password, input.salt)
    const validation = await validateE2EMasterKeyForUser({ masterKey })

    if (validation.error) {
      return { error: validation.error, masterKey: null }
    }

    // Phase 1: cache in memory only — keyring persistence is deferred
    cacheOnlyMasterKey(input.userId, masterKey)

    return { error: null, masterKey }
  } catch (error) {
    if (error instanceof EncryptionError) {
      return {
        error: toEncryptionError(error.message, error.code).error,
        masterKey: null,
      }
    }

    return {
      error: toEncryptionError(
        (error as Error).message || 'Failed to unlock end-to-end encryption on this device.',
        'local_key_store_failed'
      ).error,
      masterKey: null,
    }
  }
}

/**
 * Phase 2: Persist the master key to the platform keyring in the background.
 * Returns success/failure without throwing so callers can show toast feedback.
 */
export async function persistMasterKeyToKeyring(input: {
  userId: string
  masterKey: Uint8Array
}): Promise<{ error: null } | { error: EncryptionSettingsError['error'] }> {
  try {
    await storeMasterKey(input.userId, input.masterKey)
    return { error: null }
  } catch (error) {
    return {
      error: toEncryptionError(
        (error as Error).message || 'Failed to store the encryption key in the device keychain.',
        'keyring_persist_failed'
      ).error,
    }
  }
}

export async function bootstrapManagedEncryption(input: {
  userId: string
}): Promise<
  | { error: null; managedKeyHex: string }
  | { error: EncryptionSettingsError['error']; managedKeyHex: null }
> {
  try {
    const managedKeyHex = generateManagedEncryptionKey()

    const payload: TablesInsert<'users'> = {
      id: input.userId,
      encryption_mode: 'managed',
      managed_encryption_key: managedKeyHex,
    }

    const { error } = await supabase
      .from('users')
      .upsert(payload, { onConflict: 'id' })
      .select('encryption_mode, managed_encryption_key')
      .single()

    if (error) {
      return {
        error: toEncryptionError(error.message, error.code ?? 'users_upsert_failed').error,
        managedKeyHex: null,
      }
    }

    return { error: null, managedKeyHex }
  } catch (error) {
    if (error instanceof EncryptionError) {
      return {
        error: toEncryptionError(error.message, error.code).error,
        managedKeyHex: null,
      }
    }

    return {
      error: toEncryptionError(
        (error as Error).message || 'Failed to bootstrap managed encryption.',
        'managed_bootstrap_failed'
      ).error,
      managedKeyHex: null,
    }
  }
}

export async function fetchManagedEncryptionKey(
  userId: string
): Promise<
  | { data: string; error: null }
  | { data: null; error: EncryptionSettingsError['error'] }
> {
  const { data, error } = await supabase
    .from('users')
    .select('managed_encryption_key')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    return {
      data: null,
      error: toEncryptionError(error.message, error.code ?? 'users_read_failed').error,
    }
  }

  const keyHex = data?.managed_encryption_key
  if (!keyHex) {
    return {
      data: null,
      error: toEncryptionError(
        'Managed encryption key not found for this account.',
        'managed_key_missing'
      ).error,
    }
  }

  // M3: Validate key format before returning — fail early on corrupted data
  if (keyHex.length !== 64 || !isHexString(keyHex)) {
    return {
      data: null,
      error: toEncryptionError(
        'Managed encryption key is invalid. Expected a 64-character hex string (32 bytes).',
        'managed_key_invalid'
      ).error,
    }
  }

  return { data: keyHex, error: null }
}

export async function getManagedKeyHex(
  userId: string
): Promise<
  | { data: string; error: null }
  | { data: null; error: EncryptionSettingsError['error'] }
> {
  return fetchManagedEncryptionKey(userId)
}
