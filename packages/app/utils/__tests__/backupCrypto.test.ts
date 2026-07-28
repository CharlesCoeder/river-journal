// @vitest-environment happy-dom
/**
 * Unit tests for the encrypted-backup envelope (`backupCrypto.ts`).
 *
 * The expensive scrypt KDF (`deriveMasterKeyFromPassword`) is swapped for a
 * fast deterministic sha256 stand-in so wrong-passphrase/tamper detection is
 * genuinely exercised (real XChaCha20-Poly1305 AEAD, real salt generation)
 * without paying real N=2**17 scrypt cost per case. A different passphrase or a
 * different salt still yields a different key, so the security behavior under
 * test is preserved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { kdfSpy } = vi.hoisted(() => ({ kdfSpy: vi.fn() }))

vi.mock('app/utils/encryption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/utils/encryption')>()
  const { createHash } = await import('node:crypto')
  return {
    ...actual,
    deriveMasterKeyFromPassword: async (password: string, saltB64: string) => {
      kdfSpy(password, saltB64)
      return new Uint8Array(createHash('sha256').update(`${password}::${saltB64}`).digest())
    },
  }
})

import { decodeBackupPayload, decryptBackup, encryptBackup, isBackupPayload } from '../backupCrypto'
import { EncryptionError } from '../encryption'

function b64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function rand(n: number): Uint8Array {
  const arr = new Uint8Array(n)
  for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256)
  return arr
}

beforeEach(() => {
  kdfSpy.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('backup envelope encrypt/decrypt round trip', () => {
  it('decrypts back to the exact original plaintext with the same passphrase', async () => {
    const plaintext = JSON.stringify({ hello: 'world', count: 42 })
    const serialized = await encryptBackup(plaintext, 'a good passphrase')
    expect(isBackupPayload(serialized)).toBe(true)
    expect(serialized.startsWith('rj:backup:v1:')).toBe(true)

    const decrypted = await decryptBackup(serialized, 'a good passphrase')
    expect(decrypted).toBe(plaintext)
  })

  it('embeds the salt so the envelope carries version/algorithm/salt/nonce/ciphertext', async () => {
    const serialized = await encryptBackup('payload', 'passphrase12')
    const envelope = decodeBackupPayload(serialized)
    expect(envelope.version).toBe(1)
    expect(envelope.algorithm).toBe('xchacha20poly1305')
    expect(typeof envelope.salt).toBe('string')
    expect(envelope.salt.length).toBeGreaterThan(0)
    expect(typeof envelope.nonce).toBe('string')
    expect(typeof envelope.ciphertext).toBe('string')
  })

  it('generates a fresh salt per export — two exports of the same input differ', async () => {
    const a = await encryptBackup('same input', 'same passphrase')
    const b = await encryptBackup('same input', 'same passphrase')
    expect(a).not.toBe(b)
    expect(decodeBackupPayload(a).salt).not.toBe(decodeBackupPayload(b).salt)
  })
})

describe('backup decrypt failure surface', () => {
  it('throws for a wrong passphrase', async () => {
    const serialized = await encryptBackup('secret', 'correct passphrase')
    await expect(decryptBackup(serialized, 'wrong passphrase')).rejects.toBeInstanceOf(
      EncryptionError
    )
  })

  it('throws for a tampered ciphertext byte', async () => {
    const serialized = await encryptBackup('secret', 'passphrase12')
    const envelope = decodeBackupPayload(serialized)
    const tampered = `rj:backup:v1:${JSON.stringify({ ...envelope, ciphertext: b64(rand(48)) })}`
    await expect(decryptBackup(tampered, 'passphrase12')).rejects.toBeInstanceOf(EncryptionError)
  })

  it('feeds the passphrase verbatim — a whitespace-differing passphrase does not decrypt', async () => {
    const serialized = await encryptBackup('secret', '  leading space pass')
    await expect(decryptBackup(serialized, 'leading space pass')).rejects.toBeInstanceOf(
      EncryptionError
    )
    await expect(decryptBackup(serialized, '  leading space pass')).resolves.toBe('secret')
  })
})

describe('prefix / shape rejection before key derivation', () => {
  it('rejects a wrong prefix (flow-content envelope) before deriving a key', async () => {
    const foreign = `rj:e2e:v1:${JSON.stringify({
      version: 1,
      algorithm: 'xchacha20poly1305',
      nonce: b64(rand(24)),
      ciphertext: b64(rand(16)),
    })}`
    await expect(decryptBackup(foreign, 'passphrase12')).rejects.toBeInstanceOf(EncryptionError)
    expect(kdfSpy).not.toHaveBeenCalled()
  })

  it('rejects a backup envelope missing the embedded salt before deriving a key', async () => {
    const missingSalt = `rj:backup:v1:${JSON.stringify({
      version: 1,
      algorithm: 'xchacha20poly1305',
      nonce: b64(rand(24)),
      ciphertext: b64(rand(16)),
    })}`
    await expect(decryptBackup(missingSalt, 'passphrase12')).rejects.toBeInstanceOf(EncryptionError)
    expect(kdfSpy).not.toHaveBeenCalled()
  })

  it('rejects a non-envelope string with no known prefix', async () => {
    await expect(decryptBackup('not a backup at all', 'passphrase12')).rejects.toBeInstanceOf(
      EncryptionError
    )
    expect(kdfSpy).not.toHaveBeenCalled()
  })

  it('rejects a valid-prefix header with malformed JSON', () => {
    expect(() => decodeBackupPayload('rj:backup:v1:{not json')).toThrow(EncryptionError)
  })
})
