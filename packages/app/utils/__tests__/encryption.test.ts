import { describe, expect, it } from 'vitest'
import {
  decodeEncryptedPayload,
  decryptFlowContent,
  deriveMasterKeyFromPassword,
  encryptFlowContent,
  generateEncryptionSaltHex,
  isEncryptedFlowPayload,
} from '../encryption'

describe('encryption utils', () => {
  it('derives a deterministic key from password + salt', () => {
    const saltHex = '4a7d2a4f6f7ce932f934f01750d75e6ea27a9579fce42f8a938cb2f08f4249fb'
    const a = deriveMasterKeyFromPassword('correct horse battery staple', saltHex)
    const b = deriveMasterKeyFromPassword('correct horse battery staple', saltHex)
    const c = deriveMasterKeyFromPassword('different password', saltHex)

    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    expect(a).toHaveLength(32)
  })

  it('encrypts/decrypts flow content with a versioned payload envelope', () => {
    const key = deriveMasterKeyFromPassword(
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
