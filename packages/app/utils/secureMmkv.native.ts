/**
 * Encrypted MMKV storage for the Supabase auth session (React Native).
 *
 * The Supabase auth session contains a long-lived refresh token. Previously it
 * was persisted in a PLAINTEXT MMKV instance, so a device backup or filesystem
 * read would expose that token. This module stores the session in an AES-256
 * encrypted MMKV instance whose encryption key lives in the platform keychain
 * (Expo SecureStore) — the same durable keyring the E2E master key uses
 * (see encryptionKeyStore.native.ts).
 *
 * Design:
 *  - First launch: a random 32-byte key is generated and written to SecureStore,
 *    then an encrypted MMKV instance is opened with it.
 *  - Subsequent launches: the key is read back from SecureStore and the same
 *    encrypted instance is reopened.
 *  - Migration: existing installs have a plaintext session in the legacy MMKV
 *    instance ('supabase-auth'). On first run of this code the plaintext keys are
 *    imported into the encrypted instance and the plaintext copy is cleared, so
 *    users are NOT logged out by this change.
 *  - Fallback: if SecureStore is unavailable/errors (e.g. no keychain), we fall
 *    back to the legacy UNENCRYPTED MMKV instance (with a console.warn) rather
 *    than bricking auth. This preserves the previous behavior in that failure
 *    mode instead of logging the user out.
 *
 * The storage adapter methods are async (they await a one-time bootstrap that
 * reads the key from SecureStore). @supabase/supabase-js accepts async storage
 * methods, so awaiting the internal init promise per call is safe.
 */

import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import { createMMKV, existsMMKV, type MMKV } from 'react-native-mmkv'
import { bytesToBase64 } from './encryption'

/** Legacy plaintext instance id (pre-hardening). */
const PLAINTEXT_INSTANCE_ID = 'supabase-auth'
/** New encrypted instance id. Kept separate from the legacy id so migration is unambiguous. */
const ENCRYPTED_INSTANCE_ID = 'supabase-auth-encrypted'
/** SecureStore key under which the MMKV encryption key (a base64 string) is stored. */
const ENCRYPTION_KEY_SECURESTORE_KEY = 'river-journal.supabase-auth.mmkv-encryption-key'
/**
 * 24 random bytes base64-encode to exactly 32 ASCII chars (== 32 bytes), which is
 * the maximum key length MMKV allows for AES-256. 192 bits of entropy.
 */
const ENCRYPTION_KEY_RANDOM_BYTES = 24

type StorageAdapter = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

/** Generate a 32-char (32-byte) base64 key suitable for MMKV AES-256. */
function generateEncryptionKeyString(): string {
  return bytesToBase64(Crypto.getRandomBytes(ENCRYPTION_KEY_RANDOM_BYTES))
}

/** Read the encryption key from SecureStore, generating + persisting one on first launch. */
async function loadOrCreateEncryptionKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(ENCRYPTION_KEY_SECURESTORE_KEY)
  if (existing) return existing

  const key = generateEncryptionKeyString()
  await SecureStore.setItemAsync(ENCRYPTION_KEY_SECURESTORE_KEY, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
  return key
}

/**
 * Move any legacy plaintext session into the encrypted instance.
 *
 * Runs only when the encrypted instance is empty AND a legacy plaintext instance
 * exists with data, so it is effectively one-shot and idempotent. After importing,
 * the plaintext copy is cleared so the refresh token no longer sits unencrypted.
 */
function migratePlaintextSession(encrypted: MMKV): void {
  if (encrypted.length > 0) return
  if (!existsMMKV(PLAINTEXT_INSTANCE_ID)) return

  const plaintext = createMMKV({ id: PLAINTEXT_INSTANCE_ID })
  if (plaintext.getAllKeys().length === 0) return

  encrypted.importAllFrom(plaintext)
  plaintext.clearAll()
}

let instancePromise: Promise<MMKV> | null = null

async function initInstance(): Promise<MMKV> {
  try {
    const encryptionKey = await loadOrCreateEncryptionKey()
    const encrypted = createMMKV({
      id: ENCRYPTED_INSTANCE_ID,
      encryptionKey,
      encryptionType: 'AES-256',
    })

    try {
      migratePlaintextSession(encrypted)
    } catch (migrationError) {
      // A failed migration must not block auth — a fresh login will repopulate the
      // encrypted store. Leave the plaintext copy in place so nothing is lost.
      console.warn('[secureMmkv] Failed to migrate legacy plaintext session:', migrationError)
    }

    return encrypted
  } catch (error) {
    // SecureStore unavailable (no keychain, locked device, etc.). Fall back to the
    // legacy UNENCRYPTED instance so existing sessions keep working instead of the
    // user being logged out / auth bricking. This is strictly the old behavior.
    console.warn(
      '[secureMmkv] SecureStore unavailable; falling back to UNENCRYPTED MMKV for Supabase auth.',
      error
    )
    return createMMKV({ id: PLAINTEXT_INSTANCE_ID })
  }
}

function getInstance(): Promise<MMKV> {
  if (!instancePromise) instancePromise = initInstance()
  return instancePromise
}

/**
 * Supabase-compatible storage adapter backed by an encrypted MMKV instance.
 * Methods are async because the encryption key is bootstrapped from SecureStore.
 */
export const secureMmkvStorageAdapter: StorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const mmkv = await getInstance()
    return mmkv.getString(key) ?? null
  },
  async setItem(key: string, value: string): Promise<void> {
    const mmkv = await getInstance()
    mmkv.set(key, value)
  },
  async removeItem(key: string): Promise<void> {
    const mmkv = await getInstance()
    mmkv.remove(key)
  },
}
