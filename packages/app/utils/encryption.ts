import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { bytesToUtf8, randomBytes, utf8ToBytes } from '@noble/ciphers/utils.js'
import { scryptAsync } from '@noble/hashes/scrypt.js'

const ENCRYPTION_ALGORITHM = 'xchacha20poly1305' as const
const ENCRYPTION_VERSION = 1 as const
const ENCRYPTION_PAYLOAD_PREFIX = 'rj:e2e:v1:'
const MANAGED_PAYLOAD_PREFIX = 'rj:managed:v1:'
const NONCE_BYTES = 24
const KEY_BYTES = 32
const SALT_BYTES = 32
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

type EncryptedAlgorithm = typeof ENCRYPTION_ALGORITHM

export interface EncryptedFlowPayload {
  version: number
  algorithm: EncryptedAlgorithm
  nonce: string
  ciphertext: string
}

export class EncryptionError extends Error {
  code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'EncryptionError'
    this.code = code
  }
}

const throwEncryptionError = (message: string, code: string): never => {
  throw new EncryptionError(message, code)
}

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export const base64ToBytes = (b64: string): Uint8Array => {
  if (!b64 || b64.length % 4 !== 0 || !BASE64_PATTERN.test(b64)) {
    throwEncryptionError(
      'Invalid base64 string provided for decoding.',
      'invalid_base64_input'
    )
  }
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

export const isBase64String = (value: string): boolean => {
  if (!value || value.length % 4 !== 0) return false
  return BASE64_PATTERN.test(value)
}

const installReactNativeRandomValuesFallback = () => {
  const isReactNativeRuntime =
    typeof navigator !== 'undefined' &&
    typeof navigator.product === 'string' &&
    navigator.product.toLowerCase() === 'reactnative'

  if (!isReactNativeRuntime) return

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expoCrypto = require('expo-crypto') as {
      getRandomValues?: <T extends Uint8Array>(array: T) => T
      getRandomBytes?: (size: number) => Uint8Array
    }

    if (typeof expoCrypto.getRandomValues === 'function') {
      const cryptoObject = (globalThis.crypto ?? {}) as Crypto
      ;(globalThis as typeof globalThis & { crypto: Crypto }).crypto = {
        ...cryptoObject,
        getRandomValues: expoCrypto.getRandomValues,
      }
      return
    }

    if (typeof expoCrypto.getRandomBytes === 'function') {
      const getRandomBytes = expoCrypto.getRandomBytes
      const cryptoObject = (globalThis.crypto ?? {}) as Crypto
      ;(globalThis as typeof globalThis & { crypto: Crypto }).crypto = {
        ...cryptoObject,
        getRandomValues: <T extends ArrayBufferView>(array: T): T => {
          const target = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
          target.set(getRandomBytes(array.byteLength))
          return array
        },
      }
    }
  } catch (installError) {
    // Preserve the error so it is visible to debuggers if expo-crypto fails to import.
    // assertCryptoGetRandomValues() will throw with a clear user-facing message below.
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.warn('[encryption] Failed to install React Native crypto polyfill:', installError)
    }
  }
}

export const assertCryptoGetRandomValues = () => {
  if (typeof globalThis.crypto?.getRandomValues === 'function') return
  installReactNativeRandomValuesFallback()
  if (typeof globalThis.crypto?.getRandomValues === 'function') return
  throwEncryptionError(
    'Secure random generation is unavailable in this runtime. crypto.getRandomValues is required for E2E encryption.',
    'crypto_get_random_values_unavailable'
  )
}

const assertBase64 = (value: string, fieldName: string) => {
  if (!value || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    throwEncryptionError(
      `Encrypted payload contains an invalid ${fieldName} value.`,
      `encrypted_payload_invalid_${fieldName}`
    )
  }
}

const assertMasterKey = (masterKey: Uint8Array) => {
  if (!ArrayBuffer.isView(masterKey) || masterKey.byteLength !== KEY_BYTES) {
    throwEncryptionError(
      'Encryption key is invalid. A 32-byte master key is required.',
      'invalid_master_key'
    )
  }
}

const normalizePayload = (input: unknown): EncryptedFlowPayload => {
  if (!input || typeof input !== 'object') {
    throwEncryptionError('Encrypted payload is malformed.', 'encrypted_payload_invalid_shape')
  }

  const payload = input as Record<string, unknown>

  const version = payload.version
  if (version !== ENCRYPTION_VERSION) {
    throwEncryptionError('Encrypted payload version is unsupported.', 'unsupported_payload_version')
  }

  const algorithm = payload.algorithm
  if (algorithm !== ENCRYPTION_ALGORITHM) {
    throwEncryptionError('Encrypted payload algorithm is unsupported.', 'unsupported_payload_algorithm')
  }

  const nonceB64 = payload.nonce
  if (typeof nonceB64 !== 'string') {
    return throwEncryptionError('Encrypted payload nonce is invalid.', 'encrypted_payload_invalid_nonce')
  }
  const nonceValue: string = nonceB64
  assertBase64(nonceValue, 'nonce')

  const ciphertextB64 = payload.ciphertext
  if (typeof ciphertextB64 !== 'string') {
    return throwEncryptionError(
      'Encrypted payload ciphertext is invalid.',
      'encrypted_payload_invalid_ciphertext'
    )
  }
  const ciphertextValue: string = ciphertextB64
  assertBase64(ciphertextValue, 'ciphertext')

  const nonce = base64ToBytes(nonceValue)
  if (nonce.length !== NONCE_BYTES) {
    throwEncryptionError('Encrypted payload nonce length is invalid.', 'encrypted_payload_invalid_nonce')
  }

  const ciphertext = base64ToBytes(ciphertextValue)
  if (ciphertext.length === 0) {
    throwEncryptionError('Encrypted payload ciphertext is empty.', 'encrypted_payload_invalid_ciphertext')
  }

  return {
    version: ENCRYPTION_VERSION,
    algorithm: ENCRYPTION_ALGORITHM,
    nonce: nonceValue,
    ciphertext: ciphertextValue,
  }
}

export function generateEncryptionSalt(): string {
  assertCryptoGetRandomValues()
  return bytesToBase64(randomBytes(SALT_BYTES))
}

const TAURI_DERIVE_KEY_COMMAND = 'derive_encryption_key'

/**
 * Attempt native scrypt via Tauri Rust backend (desktop).
 */
const tryTauriScrypt = async (password: string, saltB64: string): Promise<Uint8Array | null> => {
  if (typeof window === 'undefined') return null

  const hasTauri =
    Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__') ||
    Object.prototype.hasOwnProperty.call(window, '__TAURI__')

  if (!hasTauri) return null

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const keyB64 = await invoke<string>(TAURI_DERIVE_KEY_COMMAND, {
      password,
      saltB64,
    })
    return base64ToBytes(keyB64)
  } catch {
    return null
  }
}

export async function deriveMasterKeyFromPassword(password: string, saltB64: string): Promise<Uint8Array> {
  if (!password.trim()) {
    throwEncryptionError('Encryption password is required.', 'missing_password')
  }

  assertBase64(saltB64, 'salt')
  const salt = base64ToBytes(saltB64)

  if (salt.length !== SALT_BYTES) {
    throwEncryptionError('Encryption salt length is invalid.', 'invalid_salt')
  }

  // 1. Prefer native Rust scrypt on Tauri desktop
  const tauriResult = await tryTauriScrypt(password, saltB64)
  if (tauriResult && tauriResult.length === KEY_BYTES) {
    return tauriResult
  }

  // 2. Prefer native OpenSSL scrypt on React Native mobile
  //    Import resolves to nativeScrypt.native.ts (RN) or nativeScrypt.ts (web/desktop stub)
  const { tryNativeScrypt } = await import('./nativeScrypt')
  const rnResult = await tryNativeScrypt(password, salt)
  if (rnResult && rnResult.length === KEY_BYTES) {
    return rnResult
  }

  // 3. Fallback: JS scryptAsync (web)
  await new Promise(resolve => setTimeout(resolve, 0))

  return scryptAsync(password, salt, {
    N: 2 ** 17,
    r: 8,
    p: 1,
    dkLen: KEY_BYTES,
  })
}

export function isEncryptedFlowPayload(content: string): boolean {
  return content.startsWith(ENCRYPTION_PAYLOAD_PREFIX)
}

export function encodeEncryptedPayload(payload: EncryptedFlowPayload): string {
  const normalized = normalizePayload(payload)
  return `${ENCRYPTION_PAYLOAD_PREFIX}${JSON.stringify(normalized)}`
}

export function decodeEncryptedPayload(serialized: string): EncryptedFlowPayload {
  if (!isEncryptedFlowPayload(serialized)) {
    throwEncryptionError('Flow payload is not an encrypted E2E envelope.', 'unsupported_payload_format')
  }

  const json = serialized.slice(ENCRYPTION_PAYLOAD_PREFIX.length)
  try {
    return normalizePayload(JSON.parse(json) as unknown)
  } catch (error) {
    if (error instanceof EncryptionError) throw error
    return throwEncryptionError('Encrypted payload JSON is malformed.', 'encrypted_payload_invalid_json')
  }
}

const encryptWithKey = (
  plaintext: string,
  key: Uint8Array,
  encodePayload: (payload: EncryptedFlowPayload) => string
): string => {
  assertMasterKey(key)
  assertCryptoGetRandomValues()

  const nonce = randomBytes(NONCE_BYTES)
  const cipher = xchacha20poly1305(key, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(plaintext))

  return encodePayload({
    version: ENCRYPTION_VERSION,
    algorithm: ENCRYPTION_ALGORITHM,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
  })
}

const decryptWithKey = (
  decodePayload: (serialized: string) => EncryptedFlowPayload,
  serialized: string,
  key: Uint8Array,
  errorLabel: string
): string => {
  assertMasterKey(key)
  const payload = decodePayload(serialized)

  const nonce = base64ToBytes(payload.nonce)
  const ciphertext = base64ToBytes(payload.ciphertext)

  try {
    const cipher = xchacha20poly1305(key, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return bytesToUtf8(plaintext)
  } catch (error) {
    return throwEncryptionError(
      `Failed to decrypt ${errorLabel} flow content: ${(error as Error).message}`,
      'flow_decrypt_failed'
    )
  }
}

export function encryptFlowContent(plaintext: string, masterKey: Uint8Array): string {
  return encryptWithKey(plaintext, masterKey, encodeEncryptedPayload)
}

export function decryptFlowContent(serialized: string, masterKey: Uint8Array): string {
  return decryptWithKey(decodeEncryptedPayload, serialized, masterKey, 'encrypted')
}

// =================================================================
// MANAGED ENCRYPTION
// =================================================================

export function isManagedEncryptedPayload(content: string): boolean {
  return content.startsWith(MANAGED_PAYLOAD_PREFIX)
}

export function encodeManagedPayload(payload: EncryptedFlowPayload): string {
  const normalized = normalizePayload(payload)
  return `${MANAGED_PAYLOAD_PREFIX}${JSON.stringify(normalized)}`
}

export function decodeManagedPayload(serialized: string): EncryptedFlowPayload {
  if (!isManagedEncryptedPayload(serialized)) {
    throwEncryptionError('Flow payload is not a managed encryption envelope.', 'unsupported_payload_format')
  }

  const json = serialized.slice(MANAGED_PAYLOAD_PREFIX.length)
  try {
    return normalizePayload(JSON.parse(json) as unknown)
  } catch (error) {
    if (error instanceof EncryptionError) throw error
    return throwEncryptionError('Managed payload JSON is malformed.', 'encrypted_payload_invalid_json')
  }
}

export function encryptFlowContentManaged(plaintext: string, managedKey: Uint8Array): string {
  return encryptWithKey(plaintext, managedKey, encodeManagedPayload)
}

export function decryptFlowContentManaged(serialized: string, managedKey: Uint8Array): string {
  return decryptWithKey(decodeManagedPayload, serialized, managedKey, 'managed-mode')
}

export function generateManagedEncryptionKey(): string {
  assertCryptoGetRandomValues()
  return bytesToBase64(randomBytes(KEY_BYTES))
}
