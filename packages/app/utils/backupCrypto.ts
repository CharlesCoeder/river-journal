/**
 * Encrypted backup envelope — composes the app's existing encryption pipeline
 * to protect a whole-journal backup file under a user passphrase.
 *
 * This module reuses the exact primitives already used for flow content
 * (`deriveMasterKeyFromPassword` scrypt KDF, XChaCha20-Poly1305 AEAD, base64
 * helpers) and does NOT reimplement any of them. The one deliberate structural
 * difference from the flow-content envelope: a backup file is self-contained
 * (it can be restored on a fresh device that has no user profile), so the
 * per-file scrypt `salt` is embedded IN the envelope alongside the nonce and
 * ciphertext. A fresh random salt is generated on every export.
 *
 * Envelope: `rj:backup:v1:{"version","algorithm","salt","nonce","ciphertext"}`
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { bytesToUtf8, randomBytes, utf8ToBytes } from '@noble/ciphers/utils.js'
import {
  EncryptionError,
  base64ToBytes,
  bytesToBase64,
  deriveMasterKeyFromPassword,
  generateEncryptionSalt,
  isBase64String,
} from 'app/utils/encryption'

const BACKUP_PAYLOAD_PREFIX = 'rj:backup:v1:'
const BACKUP_ALGORITHM = 'xchacha20poly1305' as const
const BACKUP_VERSION = 1 as const
const NONCE_BYTES = 24

export interface BackupEnvelope {
  version: number
  algorithm: typeof BACKUP_ALGORITHM
  /** Per-file scrypt salt (base64). Embedded so restore can re-derive the key. */
  salt: string
  nonce: string
  ciphertext: string
}

const throwBackupError = (message: string, code: string): never => {
  throw new EncryptionError(message, code)
}

const assertBackupBase64 = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || !value || !isBase64String(value)) {
    return throwBackupError(
      `Backup payload contains an invalid ${fieldName} value.`,
      `backup_payload_invalid_${fieldName}`
    )
  }
  return value
}

/** True when a string carries the self-describing backup-envelope prefix. */
export function isBackupPayload(content: string): boolean {
  return content.startsWith(BACKUP_PAYLOAD_PREFIX)
}

/** Serialize a validated envelope to its prefixed wire form. */
export function encodeBackupPayload(envelope: BackupEnvelope): string {
  return `${BACKUP_PAYLOAD_PREFIX}${JSON.stringify(envelope)}`
}

/**
 * Decode and shape-validate a backup envelope. Rejects a wrong/absent prefix,
 * malformed JSON, or a missing/invalid `salt`/`nonce`/`ciphertext` field with a
 * typed `EncryptionError` BEFORE any key derivation — a foreign but parseable
 * payload (e.g. a flow-content envelope) is never treated as a restorable
 * backup.
 */
export function decodeBackupPayload(serialized: string): BackupEnvelope {
  if (!isBackupPayload(serialized)) {
    throwBackupError('Payload is not an encrypted backup envelope.', 'unsupported_backup_format')
  }

  const json = serialized.slice(BACKUP_PAYLOAD_PREFIX.length)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return throwBackupError('Backup payload JSON is malformed.', 'backup_payload_invalid_json')
  }

  if (!parsed || typeof parsed !== 'object') {
    throwBackupError('Backup payload is malformed.', 'backup_payload_invalid_shape')
  }
  const payload = parsed as Record<string, unknown>

  if (payload.version !== BACKUP_VERSION) {
    throwBackupError('Backup payload version is unsupported.', 'unsupported_backup_version')
  }
  if (payload.algorithm !== BACKUP_ALGORITHM) {
    throwBackupError('Backup payload algorithm is unsupported.', 'unsupported_backup_algorithm')
  }

  const salt = assertBackupBase64(payload.salt, 'salt')
  const nonce = assertBackupBase64(payload.nonce, 'nonce')
  const ciphertext = assertBackupBase64(payload.ciphertext, 'ciphertext')

  return { version: BACKUP_VERSION, algorithm: BACKUP_ALGORITHM, salt, nonce, ciphertext }
}

/**
 * Encrypt a UTF-8 string under a passphrase-derived key. A fresh random salt is
 * generated per call and embedded in the returned envelope. The passphrase is
 * fed to the KDF verbatim — no trim/normalize — so a fresh device re-derives
 * the same key from the same passphrase + embedded salt.
 */
export async function encryptBackup(plaintext: string, passphrase: string): Promise<string> {
  const saltB64 = generateEncryptionSalt()
  const key = await deriveMasterKeyFromPassword(passphrase, saltB64)

  const nonce = randomBytes(NONCE_BYTES)
  const cipher = xchacha20poly1305(key, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(plaintext))

  return encodeBackupPayload({
    version: BACKUP_VERSION,
    algorithm: BACKUP_ALGORITHM,
    salt: saltB64,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
  })
}

/**
 * Decrypt a backup envelope. Prefix/shape rejection happens first (before any
 * key derivation). A wrong passphrase or tampered ciphertext fails AEAD
 * authentication and throws a typed `EncryptionError` — the caller surfaces a
 * clean failure and performs zero writes.
 */
export async function decryptBackup(serialized: string, passphrase: string): Promise<string> {
  const envelope = decodeBackupPayload(serialized)

  const key = await deriveMasterKeyFromPassword(passphrase, envelope.salt)
  const nonce = base64ToBytes(envelope.nonce)
  const ciphertext = base64ToBytes(envelope.ciphertext)

  try {
    const cipher = xchacha20poly1305(key, nonce)
    return bytesToUtf8(cipher.decrypt(ciphertext))
  } catch {
    return throwBackupError(
      'Backup could not be decrypted with the provided passphrase.',
      'backup_decrypt_failed'
    )
  }
}
