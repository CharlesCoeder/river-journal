import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils'
import { scryptAsync } from '@noble/hashes/scrypt'

const ENVELOPE_PREFIX = 'rjenc'
const ENVELOPE_VERSION = 'v1'
const ENVELOPE_ALGORITHM = 'xchacha20poly1305'
const ENVELOPE_SEPARATOR = ':'
const SALT_BYTES = 16
const NONCE_BYTES = 24
const KEY_BYTES = 32

export class EncryptedPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EncryptedPayloadError'
  }
}

const formatEnvelope = (nonce: Uint8Array, ciphertext: Uint8Array) =>
  [
    ENVELOPE_PREFIX,
    ENVELOPE_VERSION,
    ENVELOPE_ALGORITHM,
    bytesToHex(nonce),
    bytesToHex(ciphertext),
  ].join(ENVELOPE_SEPARATOR)

const parseEnvelope = (
  payload: string
): {
  nonce: Uint8Array
  ciphertext: Uint8Array
} => {
  const [prefix, version, algorithm, nonceHex, ciphertextHex, extra] = payload.split(ENVELOPE_SEPARATOR)

  if (prefix !== ENVELOPE_PREFIX || version !== ENVELOPE_VERSION || algorithm !== ENVELOPE_ALGORITHM) {
    throw new EncryptedPayloadError('Unsupported encrypted payload format.')
  }

  if (!nonceHex || !ciphertextHex || extra !== undefined) {
    throw new EncryptedPayloadError('Encrypted payload is malformed.')
  }

  let nonce: Uint8Array
  let ciphertext: Uint8Array

  try {
    nonce = hexToBytes(nonceHex)
    ciphertext = hexToBytes(ciphertextHex)
  } catch {
    throw new EncryptedPayloadError('Encrypted payload contains invalid hex.')
  }

  if (nonce.length !== NONCE_BYTES) {
    throw new EncryptedPayloadError('Encrypted payload nonce length is invalid.')
  }

  if (ciphertext.length <= 16) {
    throw new EncryptedPayloadError('Encrypted payload ciphertext is invalid.')
  }

  return { nonce, ciphertext }
}

export const ENCRYPTION_ENVELOPE_PREFIX = [
  ENVELOPE_PREFIX,
  ENVELOPE_VERSION,
  ENVELOPE_ALGORITHM,
].join(ENVELOPE_SEPARATOR)

export const bytesToKeyHex = (bytes: Uint8Array): string => bytesToHex(bytes)

export const keyHexToBytes = (keyHex: string): Uint8Array => hexToBytes(keyHex)

export const isEncryptedFlowContent = (value: string): boolean =>
  value.startsWith(`${ENCRYPTION_ENVELOPE_PREFIX}${ENVELOPE_SEPARATOR}`)

export async function generateEncryptionSaltWith(
  getRandomBytes: (length: number) => Promise<Uint8Array>
): Promise<string> {
  return bytesToHex(await getRandomBytes(SALT_BYTES))
}

export async function deriveMasterKey(password: string, saltHex: string): Promise<Uint8Array> {
  return scryptAsync(password, hexToBytes(saltHex), {
    N: 2 ** 17,
    r: 8,
    p: 1,
    dkLen: KEY_BYTES,
  })
}

export async function encryptFlowContentWith(
  plaintext: string,
  key: Uint8Array,
  getRandomBytes: (length: number) => Promise<Uint8Array>
): Promise<string> {
  const nonce = await getRandomBytes(NONCE_BYTES)
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(plaintext))
  return formatEnvelope(nonce, ciphertext)
}

export async function decryptFlowContent(payload: string, key: Uint8Array): Promise<string> {
  const { nonce, ciphertext } = parseEnvelope(payload)

  try {
    return bytesToUtf8(xchacha20poly1305(key, nonce).decrypt(ciphertext))
  } catch {
    throw new Error('Encrypted flow content could not be decrypted with the current key.')
  }
}
