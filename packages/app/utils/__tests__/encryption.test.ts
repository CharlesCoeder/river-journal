import { describe, expect, it } from 'vitest'
import {
  base64ToBytes,
  bytesToBase64,
  decodeEncryptedPayload,
  decodeManagedPayload,
  decryptFlowContent,
  decryptFlowContentManaged,
  deriveMasterKeyFromPassword,
  encryptFlowContent,
  encryptFlowContentManaged,
  generateEncryptionSalt,
  generateManagedEncryptionKey,
  isBase64String,
  isEncryptedFlowPayload,
  isManagedEncryptedPayload,
} from '../encryption'

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

describe('encryption utils', () => {
  it('derives a deterministic key from password + salt', { timeout: 15000 }, async () => {
    const saltB64 = 'Sn0qT2986TL5NPAXUNdebqJ6lXn85C+Kk4yy8I9CSfs='
    const a = await deriveMasterKeyFromPassword('correct horse battery staple', saltB64)
    const b = await deriveMasterKeyFromPassword('correct horse battery staple', saltB64)
    const c = await deriveMasterKeyFromPassword('different password', saltB64)

    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    expect(a).toHaveLength(32)
  })

  it('encrypts/decrypts flow content with a versioned payload envelope', async () => {
    const key = await deriveMasterKeyFromPassword(
      'correct horse battery staple',
      'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8='
    )
    const plaintext = 'Today I wrote 413 words.'

    const encryptedPayload = encryptFlowContent(plaintext, key)
    expect(isEncryptedFlowPayload(encryptedPayload)).toBe(true)

    const decoded = decodeEncryptedPayload(encryptedPayload)
    expect(decoded.version).toBe(1)
    expect(decoded.algorithm).toBe('xchacha20poly1305')
    expect(decoded.nonce).toMatch(BASE64_PATTERN)
    expect(decoded.ciphertext).toMatch(BASE64_PATTERN)

    const decrypted = decryptFlowContent(encryptedPayload, key)
    expect(decrypted).toBe(plaintext)
  })

  it('rejects malformed payloads loudly', () => {
    expect(() => decodeEncryptedPayload('hello world')).toThrowError(/unsupported|payload/i)
    expect(() => decodeEncryptedPayload('rj:e2e:v1:{"version":99}')).toThrowError(/version/i)
  })

  it('generates random salt as base64 strings', () => {
    const saltA = generateEncryptionSalt()
    const saltB = generateEncryptionSalt()

    expect(saltA).toMatch(BASE64_PATTERN)
    expect(saltA).toHaveLength(44)
    expect(saltA).not.toBe(saltB)
  })

  it('validates base64 format correctly', () => {
    expect(isBase64String('SGVsbG8=')).toBe(true)
    expect(isBase64String('AAAA')).toBe(true)
    expect(isBase64String('A+B/CD==')).toBe(true)
    expect(isBase64String('')).toBe(false)
    expect(isBase64String('not-valid!')).toBe(false)
    // length % 4 !== 0 must be rejected even if chars are valid base64 alphabet
    expect(isBase64String('ABC')).toBe(false)
    expect(isBase64String('ABCDE')).toBe(false)
  })

  it('bytesToBase64 handles large inputs without stack overflow', () => {
    const largeInput = new Uint8Array(256 * 1024) // 256 KB
    for (let i = 0; i < largeInput.length; i++) largeInput[i] = i % 256
    const encoded = bytesToBase64(largeInput)
    expect(encoded).toMatch(BASE64_PATTERN)
    expect(encoded.length).toBeGreaterThan(0)
    // round-trip
    const decoded = base64ToBytes(encoded)
    expect(decoded).toEqual(largeInput)
  })
})

describe('managed encryption', () => {
  it('generates a 32-byte managed encryption key as base64', () => {
    const keyB64 = generateManagedEncryptionKey()
    expect(keyB64).toMatch(BASE64_PATTERN)
    expect(keyB64).toHaveLength(44)

    const keyB = generateManagedEncryptionKey()
    expect(keyB64).not.toBe(keyB)
  })

  it('round-trips encrypt/decrypt with managed prefix', () => {
    const keyB64 = generateManagedEncryptionKey()
    const managedKey = base64ToBytes(keyB64)
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
    const keyA = base64ToBytes(generateManagedEncryptionKey())
    const keyB = base64ToBytes(generateManagedEncryptionKey())
    const encrypted = encryptFlowContentManaged('secret', keyA)

    expect(() => decryptFlowContentManaged(encrypted, keyB)).toThrowError(/decrypt/i)
  })
})
