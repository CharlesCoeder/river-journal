import { describe, expect, it } from 'vitest'
import {
  decryptFlowContent,
  deriveMasterKey,
  ENCRYPTION_ENVELOPE_PREFIX,
  encryptFlowContent,
  EncryptedPayloadError,
  generateEncryptionSalt,
  isEncryptedFlowContent,
} from '../encryption'

describe('encryption utilities', () => {
  it('generates a 16-byte hex salt', async () => {
    const salt = await generateEncryptionSalt()
    expect(salt).toMatch(/^[0-9a-f]{32}$/)
  })

  it('derives the same key for the same password and salt', async () => {
    const salt = 'ab'.repeat(16)
    const keyOne = await deriveMasterKey('password123', salt)
    const keyTwo = await deriveMasterKey('password123', salt)

    expect(Array.from(keyOne)).toEqual(Array.from(keyTwo))
  })

  it('encrypts and decrypts flow content round-trip', async () => {
    const key = await deriveMasterKey('password123', 'cd'.repeat(16))
    const ciphertext = await encryptFlowContent('river journal', key)

    expect(ciphertext.startsWith(`${ENCRYPTION_ENVELOPE_PREFIX}:`)).toBe(true)
    expect(isEncryptedFlowContent(ciphertext)).toBe(true)
    await expect(decryptFlowContent(ciphertext, key)).resolves.toBe('river journal')
  })

  it('rejects malformed payloads', async () => {
    const key = await deriveMasterKey('password123', 'ef'.repeat(16))
    await expect(decryptFlowContent('rjenc:v1:xchacha20poly1305:abcd', key)).rejects.toBeInstanceOf(
      EncryptedPayloadError
    )
  })

  it('rejects unsupported versions and algorithms', async () => {
    const key = await deriveMasterKey('password123', '12'.repeat(16))

    await expect(
      decryptFlowContent(`rjenc:v2:xchacha20poly1305:${'aa'.repeat(24)}:${'bb'.repeat(20)}`, key)
    ).rejects.toBeInstanceOf(EncryptedPayloadError)

    await expect(
      decryptFlowContent(`rjenc:v1:aes-gcm:${'aa'.repeat(24)}:${'bb'.repeat(20)}`, key)
    ).rejects.toBeInstanceOf(EncryptedPayloadError)
  })

  it('fails decryption when the wrong key is used', async () => {
    const key = await deriveMasterKey('password123', '34'.repeat(16))
    const wrongKey = await deriveMasterKey('password456', '34'.repeat(16))
    const ciphertext = await encryptFlowContent('locked entry', key)

    await expect(decryptFlowContent(ciphertext, wrongKey)).rejects.toThrow(
      'Encrypted flow content could not be decrypted with the current key.'
    )
  })
})
