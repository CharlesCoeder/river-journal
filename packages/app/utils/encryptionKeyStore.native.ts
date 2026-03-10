import * as SecureStore from 'expo-secure-store'
import { bytesToHex, hexToBytes } from '@noble/ciphers/utils.js'

const MASTER_KEY_PREFIX = 'river-journal.e2e.master-key.'
const inMemoryMasterKeyCache = new Map<string, Uint8Array>()

const cloneBytes = (value: Uint8Array): Uint8Array => new Uint8Array(value)
const getMasterKeyId = (userId: string): string => `${MASTER_KEY_PREFIX}${userId}`

export async function storeMasterKey(userId: string, masterKey: Uint8Array): Promise<void> {
  inMemoryMasterKeyCache.set(userId, cloneBytes(masterKey))

  await SecureStore.setItemAsync(getMasterKeyId(userId), bytesToHex(masterKey), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
}

export async function loadMasterKey(userId: string): Promise<Uint8Array | null> {
  const cachedKey = inMemoryMasterKeyCache.get(userId)
  if (cachedKey) return cloneBytes(cachedKey)

  const hexValue = await SecureStore.getItemAsync(getMasterKeyId(userId))
  if (!hexValue) return null

  const key = hexToBytes(hexValue)
  inMemoryMasterKeyCache.set(userId, cloneBytes(key))
  return key
}

export function getCachedMasterKey(userId: string): Uint8Array | null {
  const key = inMemoryMasterKeyCache.get(userId)
  return key ? cloneBytes(key) : null
}

export async function hasStoredMasterKey(userId: string): Promise<boolean> {
  if (inMemoryMasterKeyCache.has(userId)) return true
  const value = await SecureStore.getItemAsync(getMasterKeyId(userId))
  return !!value
}

export async function clearStoredMasterKey(userId: string): Promise<void> {
  inMemoryMasterKeyCache.delete(userId)
  await SecureStore.deleteItemAsync(getMasterKeyId(userId))
}

/**
 * Cache the master key in memory only, without touching Expo SecureStore.
 * Used during Phase 1 of the deferred keyring flow.
 */
export function cacheOnlyMasterKey(userId: string, masterKey: Uint8Array): void {
  inMemoryMasterKeyCache.set(userId, cloneBytes(masterKey))
}

/**
 * Native platforms always have a durable keyring (Expo SecureStore).
 */
export async function hasPlatformKeyring(): Promise<boolean> {
  return true
}
