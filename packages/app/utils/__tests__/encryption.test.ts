import { describe, expect, it } from 'vitest'
import {
  decodeEncryptedPayload,
  decodeManagedPayload,
  decryptFlowContent,
  decryptFlowContentManaged,
  deriveMasterKeyFromPassword,
  encryptFlowContent,
  encryptFlowContentManaged,
  generateEncryptionSaltHex,
  generateManagedEncryptionKey,
  isEncryptedFlowPayload,
  isManagedEncryptedPayload,
} from '../encryption'
import { hexToBytes } from '@noble/ciphers/utils.js'

describe('encryption utils', () => {
  it('derives a deterministic key from password + salt', { timeout: 15000 }, async () => {
    const saltHex = '4a7d2a4f6f7ce932f934f01750d75e6ea27a9579fce42f8a938cb2f08f4249fb'
    const a = await deriveMasterKeyFromPassword('correct horse battery staple', saltHex)
    const b = await deriveMasterKeyFromPassword('correct horse battery staple', saltHex)
    const c = await deriveMasterKeyFromPassword('different password', saltHex)

    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    expect(a).toHaveLength(32)
  })

  it('encrypts/decrypts flow content with a versioned payload envelope', async () => {
    const key = await deriveMasterKeyFromPassword(
      'correct horse battery staple',
      '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df'
    )
    const plaintext = 'Today I wrote 413 words.'

    const encryptedPayload = encryptFlowContent(plaintext, key)
    expect(isEncryptedFlowPayload(encryptedPayload)).toBe(true)

    const decoded = decodeEncryptedPayload(encryptedPayload)
    expect(decoded.version).toBe(1)
    expect(decoded.algorithm).toBe('xchacha20poly1305')
    expect(decoded.nonce).not.toHaveLength(0)
    expect(decoded.ciphertext).not.toHaveLength(0)

    const decrypted = decryptFlowContent(encryptedPayload, key)
    expect(decrypted).toBe(plaintext)
  })

  it('rejects malformed payloads loudly', () => {
    expect(() => decodeEncryptedPayload('hello world')).toThrowError(/unsupported|payload/i)
    expect(() => decodeEncryptedPayload('rj:e2e:v1:{"version":99}')).toThrowError(/version/i)
  })

  it('generates random salt hex strings', () => {
    const saltA = generateEncryptionSaltHex()
    const saltB = generateEncryptionSaltHex()

    expect(saltA).toMatch(/^[0-9a-f]+$/)
    expect(saltA).toHaveLength(64)
    expect(saltA).not.toBe(saltB)
  })
})

describe('managed encryption', () => {
  it('generates a 32-byte managed encryption key as hex', () => {
    const keyHex = generateManagedEncryptionKey()
    expect(keyHex).toMatch(/^[0-9a-f]+$/)
    expect(keyHex).toHaveLength(64)

    const keyB = generateManagedEncryptionKey()
    expect(keyHex).not.toBe(keyB)
  })

  it('round-trips encrypt/decrypt with managed prefix', () => {
    const keyHex = generateManagedEncryptionKey()
    const managedKey = hexToBytes(keyHex)
    const plaintext = 'Managed mode journal entry content'

    const encrypted = encryptFlowContentManaged(plaintext, managedKey)
    expect(isManagedEncryptedPayload(encrypted)).toBe(true)
    expect(isEncryptedFlowPayload(encrypted)).toBe(false)

    const decoded = decodeManagedPayload(encrypted)
    expect(decoded.version).toBe(1)
    expect(decoded.algorithm).toBe('xchacha20poly1305')

    const decrypted = decryptFlowContentManaged(encrypted, managedKey)
    expect(decrypted).toBe(plaintext)
  })

  it('detects managed vs E2E prefix correctly', () => {
    expect(isManagedEncryptedPayload('rj:managed:v1:{"test":1}')).toBe(true)
    expect(isManagedEncryptedPayload('rj:e2e:v1:{"test":1}')).toBe(false)
    expect(isManagedEncryptedPayload('plain text')).toBe(false)

    expect(isEncryptedFlowPayload('rj:e2e:v1:{"test":1}')).toBe(true)
    expect(isEncryptedFlowPayload('rj:managed:v1:{"test":1}')).toBe(false)
  })

  it('rejects malformed managed payloads', () => {
    expect(() => decodeManagedPayload('hello world')).toThrowError(/unsupported|payload/i)
    expect(() => decodeManagedPayload('rj:managed:v1:{"version":99}')).toThrowError(/version/i)
  })

  it('fails to decrypt managed content with wrong key', () => {
    const keyA = hexToBytes(generateManagedEncryptionKey())
    const keyB = hexToBytes(generateManagedEncryptionKey())
    const encrypted = encryptFlowContentManaged('secret', keyA)

    expect(() => decryptFlowContentManaged(encrypted, keyB)).toThrowError(/decrypt/i)
  })
})

