import { supabase } from './supabase'
import type { Tables, TablesInsert } from '../types/database'
import type { EncryptionMode } from '../types/index'
import {
  EncryptionError,
  decryptFlowContent,
  deriveMasterKeyFromPassword,
  encryptFlowContent,
  generateEncryptionSalt,
  generateManagedEncryptionKey,
  isBase64String,
  isEncryptedFlowPayload,
} from './encryption'
import { cacheOnlyMasterKey, clearStoredMasterKey, storeMasterKey } from './encryptionKeyStore'

export interface EncryptionSettings {
  mode: EncryptionMode | null
  salt: string | null
  managedKeyB64: string | null
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

/**
 * Known constant encrypted with the master key and stored server-side as
 * `users.encryption_key_verifier`. On unlock we decrypt the stored ciphertext
 * and check it equals this string — a positive proof the re-entered password
 * derived the right key, independent of whether any flows exist to sample.
 * Versioned so the format can evolve without ambiguity.
 */
const E2E_KEY_VERIFIER_PLAINTEXT = 'river-key-check-v1'

type FlowVerificationRow = Pick<Tables<'flows'>, 'id' | 'content'>

/**
 * Encrypts the well-known verifier constant with the given master key.
 * The result is stored in `users.encryption_key_verifier`.
 */
function buildKeyVerifier(masterKey: Uint8Array): string {
  return encryptFlowContent(E2E_KEY_VERIFIER_PLAINTEXT, masterKey)
}

/**
 * Returns true iff `masterKey` decrypts `verifier` back to the known constant.
 * A wrong key throws (auth tag mismatch) or yields different plaintext → false.
 */
function verifyMasterKeyAgainstVerifier(masterKey: Uint8Array, verifier: string): boolean {
  try {
    return decryptFlowContent(verifier, masterKey) === E2E_KEY_VERIFIER_PLAINTEXT
  } catch {
    return false
  }
}

/**
 * Fetches the stored key verifier for the account. `verifier: null` means a
 * legacy account that predates the verifier (fall back to flow sampling).
 */
async function fetchEncryptionVerifier(
  userId: string
): Promise<{ verifier: string | null; error: null } | { verifier: null; error: EncryptionSettingsError['error'] }> {
  const { data, error } = await supabase
    .from('users')
    .select('encryption_key_verifier')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    return {
      verifier: null,
      error: toEncryptionError(error.message, error.code ?? 'users_read_failed').error,
    }
  }

  return { verifier: data?.encryption_key_verifier ?? null, error: null }
}

/**
 * Self-heal: writes the key verifier for a legacy account, but only if the
 * column is still NULL (guarded so we never clobber an existing verifier).
 * Fire-and-forget — failure just means the account heals on a later unlock.
 */
async function writeVerifierIfAbsent(userId: string, masterKey: Uint8Array): Promise<void> {
  try {
    await supabase
      .from('users')
      .update({ encryption_key_verifier: buildKeyVerifier(masterKey) })
      .eq('id', userId)
      .is('encryption_key_verifier', null)
  } catch {
    // Non-fatal: the account remains on legacy flow-sampling verification.
  }
}

/**
 * Verifies a derived master key for an existing account: prefer the stored
 * verifier; fall back to flow sampling for legacy accounts (and heal them by
 * writing a verifier after a conclusive sampling match).
 */
async function verifyExistingE2EMasterKey(input: {
  userId: string
  masterKey: Uint8Array
  verifier: string | null
}): Promise<{ error: null } | { error: EncryptionSettingsError['error'] }> {
  if (input.verifier) {
    if (verifyMasterKeyAgainstVerifier(input.masterKey, input.verifier)) {
      return { error: null }
    }
    return { error: INVALID_ENCRYPTION_PASSWORD_ERROR }
  }

  // Legacy account with no verifier: fall back to sampling existing flows.
  const validation = await validateE2EMasterKeyForUser({ masterKey: input.masterKey })
  if (validation.error) {
    return { error: validation.error }
  }

  // Only heal when sampling conclusively proved the key (an encrypted flow
  // decrypted). If nothing decisive was sampled we cannot confirm the password,
  // so we must not canonicalize a possibly-wrong key by writing a verifier.
  if (validation.didVerify) {
    void writeVerifierIfAbsent(input.userId, input.masterKey)
  }

  return { error: null }
}

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
      managedKeyB64: data?.managed_encryption_key ?? null,
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
      managedKeyB64: data.managed_encryption_key ?? null,
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
    const salt = generateEncryptionSalt()
    const masterKey = await deriveMasterKeyFromPassword(input.password, salt)
    const verifier = buildKeyVerifier(masterKey)

    // Guarded insert-if-absent: the RPC writes our salt/verifier ONLY when the
    // account has none yet, then returns the authoritative row. This makes a
    // spurious bootstrap (e.g. after a transient settings-load failure) safe —
    // an existing salt is never overwritten, so previously-encrypted data stays
    // decryptable.
    const { data, error } = await supabase.rpc('bootstrap_e2e_encryption', {
      p_salt: salt,
      p_verifier: verifier,
    })

    if (error) {
      return {
        error: toEncryptionError(error.message, error.code ?? 'users_upsert_failed').error,
        masterKey: null,
      }
    }

    const row = Array.isArray(data) ? data[0] : null
    const serverSalt = row?.out_salt ?? null

    if (!serverSalt) {
      return {
        error: toEncryptionError(
          'Encryption setup did not persist a salt for this account.',
          'e2e_salt_missing'
        ).error,
        masterKey: null,
      }
    }

    if (serverSalt === salt) {
      // Fresh bootstrap won the race: our salt/verifier were written.
      // Phase 1: cache in memory only — keyring persistence is deferred.
      cacheOnlyMasterKey(input.userId, masterKey)
      return { error: null, masterKey }
    }

    // A salt already existed server-side (concurrent bootstrap, or this was a
    // spurious re-bootstrap). Treat as an UNLOCK against the existing salt so we
    // never fork the account onto a second key. Re-derive with the real salt and
    // verify the password before accepting it.
    const existingMasterKey = await deriveMasterKeyFromPassword(input.password, serverSalt)
    const verification = await verifyExistingE2EMasterKey({
      userId: input.userId,
      masterKey: existingMasterKey,
      verifier: row?.out_verifier ?? null,
    })

    if (verification.error) {
      return { error: verification.error, masterKey: null }
    }

    cacheOnlyMasterKey(input.userId, existingMasterKey)
    return { error: null, masterKey: existingMasterKey }
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

    // Prefer the stored key verifier — a positive proof the password is correct
    // even when the account has no encrypted flows to sample. Legacy accounts
    // (verifier: null) fall back to flow sampling and self-heal a verifier.
    // A FAILED fetch must fail the unlock (not downgrade to sampling): the
    // sampling fallback can inconclusively accept a wrong password, which is
    // exactly the account-forking bug the verifier exists to prevent.
    const verifierResult = await fetchEncryptionVerifier(input.userId)
    if (verifierResult.error) {
      return { error: verifierResult.error, masterKey: null }
    }

    const verification = await verifyExistingE2EMasterKey({
      userId: input.userId,
      masterKey,
      verifier: verifierResult.verifier,
    })

    if (verification.error) {
      return { error: verification.error, masterKey: null }
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
  | { error: null; managedKeyB64: string }
  | { error: EncryptionSettingsError['error']; managedKeyB64: null }
> {
  try {
    const managedKeyB64 = generateManagedEncryptionKey()

    // Race-safe insert-if-absent: the RPC keeps any key already on the account
    // (COALESCE) and returns the authoritative key. Two devices bootstrapping
    // concurrently therefore converge on a single key — the loser's candidate is
    // discarded rather than overwriting the winner and stranding its writes.
    const { data, error } = await supabase.rpc('bootstrap_managed_encryption', {
      p_key: managedKeyB64,
    })

    if (error) {
      return {
        error: toEncryptionError(error.message, error.code ?? 'users_upsert_failed').error,
        managedKeyB64: null,
      }
    }

    const winningKey = Array.isArray(data) ? data[0]?.out_key ?? null : null

    if (!winningKey) {
      return {
        error: toEncryptionError(
          'Managed encryption setup did not persist a key for this account.',
          'managed_key_missing'
        ).error,
        managedKeyB64: null,
      }
    }

    return { error: null, managedKeyB64: winningKey }
  } catch (error) {
    if (error instanceof EncryptionError) {
      return {
        error: toEncryptionError(error.message, error.code).error,
        managedKeyB64: null,
      }
    }

    return {
      error: toEncryptionError(
        (error as Error).message || 'Failed to bootstrap managed encryption.',
        'managed_bootstrap_failed'
      ).error,
      managedKeyB64: null,
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

  const keyB64 = data?.managed_encryption_key
  if (!keyB64) {
    return {
      data: null,
      error: toEncryptionError(
        'Managed encryption key not found for this account.',
        'managed_key_missing'
      ).error,
    }
  }

  // M3: Validate key format before returning — fail early on corrupted data
  if (keyB64.length !== 44 || !isBase64String(keyB64)) {
    return {
      data: null,
      error: toEncryptionError(
        'Managed encryption key is invalid. Expected a base64-encoded 32-byte key.',
        'managed_key_invalid'
      ).error,
    }
  }

  return { data: keyB64, error: null }
}

// =================================================================
// TRUSTED BROWSERS (Web E2E Key Persistence)
// =================================================================

export interface TrustedBrowser {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string
  deviceTokenHash: string
}

/**
 * Registers a trusted browser server-side.
 * Enforces max 10 browsers per user and rate limiting (3/hour).
 */
export async function registerTrustedBrowser(
  userId: string,
  deviceTokenHash: string,
  label: string
): Promise<{ error: null } | { error: EncryptionSettingsError['error'] }> {
  // Rate limiting: max 3 registrations per user per hour
  const { count: recentCount, error: countError } = await supabase
    .from('trusted_browsers')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())

  if (!countError && (recentCount ?? 0) >= 3) {
    return toEncryptionError(
      'Too many browsers trusted recently. Please wait before trusting another browser.',
      'rate_limited'
    )
  }

  // App-side max browsers check
  const { count: totalCount, error: totalError } = await supabase
    .from('trusted_browsers')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (!totalError && (totalCount ?? 0) >= 10) {
    return toEncryptionError(
      'Maximum of 10 trusted browsers reached. Revoke an existing browser first.',
      'max_trusted_browsers'
    )
  }

  const payload: TablesInsert<'trusted_browsers'> = {
    user_id: userId,
    device_token_hash: deviceTokenHash,
    label,
  }

  try {
    const { error } = await supabase.from('trusted_browsers').insert(payload)

    if (error) {
      // Map Postgres trigger exception to friendly error code (TOCTOU race)
      if (error.message?.includes('Maximum of 10 trusted browsers per user')) {
        return toEncryptionError(
          'Maximum of 10 trusted browsers reached. Revoke an existing browser first.',
          'max_trusted_browsers'
        )
      }
      return toEncryptionError(
        error.message,
        error.code ?? 'trusted_browser_register_failed'
      )
    }

    return { error: null }
  } catch (error) {
    return toEncryptionError(
      (error as Error).message || 'Failed to register trusted browser.',
      'trusted_browser_register_failed'
    )
  }
}

export type TrustedBrowserVerification =
  | { status: 'valid'; id: string }
  | { status: 'revoked' }
  | { status: 'network_error' }

/**
 * Verifies a trusted browser by matching user_id AND device_token_hash.
 * Returns a three-state result to distinguish revocation from network errors.
 */
export async function verifyTrustedBrowser(
  userId: string,
  deviceTokenHash: string
): Promise<TrustedBrowserVerification> {
  const { data, error } = await supabase
    .from('trusted_browsers')
    .select('id')
    .eq('user_id', userId)
    .eq('device_token_hash', deviceTokenHash)
    .maybeSingle()

  if (error) {
    return { status: 'network_error' }
  }

  if (!data) {
    return { status: 'revoked' }
  }

  return { status: 'valid', id: data.id }
}

/**
 * Revokes (deletes) a trusted browser by id.
 */
export async function revokeTrustedBrowser(
  browserId: string
): Promise<{ error: null } | { error: EncryptionSettingsError['error'] }> {
  const { error } = await supabase
    .from('trusted_browsers')
    .delete()
    .eq('id', browserId)

  if (error) {
    return toEncryptionError(
      error.message,
      error.code ?? 'trusted_browser_revoke_failed'
    )
  }

  return { error: null }
}

/**
 * Fetches all trusted browsers for a user, ordered by last_used_at desc.
 */
export async function fetchTrustedBrowsers(userId: string): Promise<TrustedBrowser[]> {
  const { data, error } = await supabase
    .from('trusted_browsers')
    .select('id, label, created_at, last_used_at, device_token_hash')
    .eq('user_id', userId)
    .order('last_used_at', { ascending: false })

  if (error || !data) return []

  return data.map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    deviceTokenHash: row.device_token_hash,
  }))
}

/**
 * Updates last_used_at to now. Fire-and-forget.
 */
export async function updateTrustedBrowserLastUsed(browserId: string): Promise<void> {
  await supabase
    .from('trusted_browsers')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', browserId)
}

/**
 * Deletes a trusted browser by (user_id, device_token_hash).
 * Used during sign-out to revoke the current browser's server-side row.
 */
export async function deleteTrustedBrowserByHash(
  userId: string,
  deviceTokenHash: string
): Promise<{ error: null } | { error: EncryptionSettingsError['error'] }> {
  const { error } = await supabase
    .from('trusted_browsers')
    .delete()
    .eq('user_id', userId)
    .eq('device_token_hash', deviceTokenHash)

  if (error) {
    return toEncryptionError(
      error.message,
      error.code ?? 'trusted_browser_delete_failed'
    )
  }

  return { error: null }
}

