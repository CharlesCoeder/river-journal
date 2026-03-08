import {
  decryptFlowContent,
  deriveMasterKey,
  EncryptedPayloadError,
  ENCRYPTION_ENVELOPE_PREFIX,
  generateEncryptionSaltWith,
  encryptFlowContentWith,
  isEncryptedFlowContent,
  bytesToKeyHex,
  keyHexToBytes,
} from './encryption.shared'

const getRandomBytes = async (length: number): Promise<Uint8Array> => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return crypto.getRandomValues(new Uint8Array(length))
  }

  throw new Error('crypto.getRandomValues is not available in this runtime.')
}

export {
  bytesToKeyHex,
  decryptFlowContent,
  deriveMasterKey,
  ENCRYPTION_ENVELOPE_PREFIX,
  EncryptedPayloadError,
  isEncryptedFlowContent,
  keyHexToBytes,
}

export const generateEncryptionSalt = async (): Promise<string> => {
  return generateEncryptionSaltWith(getRandomBytes)
}

export const encryptFlowContent = async (
  plaintext: string,
  key: Uint8Array
): Promise<string> => {
  return encryptFlowContentWith(plaintext, key, getRandomBytes)
}
