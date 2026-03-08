import * as ExpoCrypto from 'expo-crypto'
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
  return ExpoCrypto.getRandomBytesAsync(length)
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
