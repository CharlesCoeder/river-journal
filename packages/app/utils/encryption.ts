import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { bytesToHex, bytesToUtf8, hexToBytes, randomBytes, utf8ToBytes } from '@noble/ciphers/utils.js'
import { scryptAsync } from '@noble/hashes/scrypt.js'

const ENCRYPTION_ALGORITHM = 'xchacha20poly1305' as const
const ENCRYPTION_VERSION = 1 as const
const ENCRYPTION_PAYLOAD_PREFIX = 'rj:e2e:v1:'
const NONCE_BYTES = 24
const KEY_BYTES = 32
const SALT_BYTES = 32
const HEX_PATTERN = /^[0-9a-f]+$/

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
  } catch {
    // Fall through to the hard failure below if no secure runtime source is available.
  }
}

const assertCryptoGetRandomValues = () => {
  if (typeof globalThis.crypto?.getRandomValues === 'function') return
  installReactNativeRandomValuesFallback()
  if (typeof globalThis.crypto?.getRandomValues === 'function') return
  throwEncryptionError(
    'Secure random generation is unavailable in this runtime. crypto.getRandomValues is required for E2E encryption.',
    'crypto_get_random_values_unavailable'
  )
}

const assertHex = (value: string, fieldName: string) => {
  const normalized = value.toLowerCase()

  if (!normalized || normalized.length % 2 !== 0 || !HEX_PATTERN.test(normalized)) {
    throwEncryptionError(
      `Encrypted payload contains an invalid ${fieldName} value.`,
      `encrypted_payload_invalid_${fieldName}`
    )
  }
}

const assertMasterKey = (masterKey: Uint8Array) => {
  if (!(masterKey instanceof Uint8Array) || masterKey.length !== KEY_BYTES) {
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

  const nonceHex = payload.nonce
  if (typeof nonceHex !== 'string') {
    return throwEncryptionError('Encrypted payload nonce is invalid.', 'encrypted_payload_invalid_nonce')
  }
  const nonceValue: string = nonceHex
  assertHex(nonceValue, 'nonce')

  const ciphertextHex = payload.ciphertext
  if (typeof ciphertextHex !== 'string') {
    return throwEncryptionError(
      'Encrypted payload ciphertext is invalid.',
      'encrypted_payload_invalid_ciphertext'
    )
  }
  const ciphertextValue: string = ciphertextHex
  assertHex(ciphertextValue, 'ciphertext')

  const nonce = hexToBytes(nonceValue)
  if (nonce.length !== NONCE_BYTES) {
    throwEncryptionError('Encrypted payload nonce length is invalid.', 'encrypted_payload_invalid_nonce')
  }

  const ciphertext = hexToBytes(ciphertextValue)
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

export function generateEncryptionSaltHex(): string {
  assertCryptoGetRandomValues()
  return bytesToHex(randomBytes(SALT_BYTES))
}

const TAURI_DERIVE_KEY_COMMAND = 'derive_encryption_key'

/**
 * Attempt native scrypt derivation via the Tauri Rust backend.
 * Returns null if Tauri is unavailable (web/mobile).
 */
const tryNativeScrypt = async (password: string, saltHex: string): Promise<Uint8Array | null> => {
  if (typeof window === 'undefined') return null

  const hasTauri =
    Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__') ||
    Object.prototype.hasOwnProperty.call(window, '__TAURI__')

  if (!hasTauri) return null

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const keyHex = await invoke<string>(TAURI_DERIVE_KEY_COMMAND, {
      password,
      saltHex,
    })
    return hexToBytes(keyHex)
  } catch {
    // Fall through to JS scrypt
    return null
  }
}

export async function deriveMasterKeyFromPassword(password: string, saltHex: string): Promise<Uint8Array> {
  if (!password.trim()) {
    throwEncryptionError('Encryption password is required.', 'missing_password')
  }

  assertHex(saltHex, 'salt')
  const salt = hexToBytes(saltHex)

  if (salt.length !== SALT_BYTES) {
    throwEncryptionError('Encryption salt length is invalid.', 'invalid_salt')
  }

  // Prefer native Rust scrypt on Tauri desktop (dramatically faster)
  const nativeResult = await tryNativeScrypt(password, saltHex)
  if (nativeResult && nativeResult.length === KEY_BYTES) {
    return nativeResult
  }

  // Fallback: JS scryptAsync (web / mobile)
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

export function encryptFlowContent(plaintext: string, masterKey: Uint8Array): string {
  assertMasterKey(masterKey)
  assertCryptoGetRandomValues()

  const nonce = randomBytes(NONCE_BYTES)
  const cipher = xchacha20poly1305(masterKey, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(plaintext))

  return encodeEncryptedPayload({
    version: ENCRYPTION_VERSION,
    algorithm: ENCRYPTION_ALGORITHM,
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
  })
}

export function decryptFlowContent(serialized: string, masterKey: Uint8Array): string {
  assertMasterKey(masterKey)
  const payload = decodeEncryptedPayload(serialized)

  const nonce = hexToBytes(payload.nonce)
  const ciphertext = hexToBytes(payload.ciphertext)

  try {
    const cipher = xchacha20poly1305(masterKey, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return bytesToUtf8(plaintext)
  } catch (error) {
    return throwEncryptionError(
      `Failed to decrypt encrypted flow content: ${(error as Error).message}`,
      'flow_decrypt_failed'
    )
  }
}
