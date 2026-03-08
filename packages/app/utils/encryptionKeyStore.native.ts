import * as SecureStore from 'expo-secure-store'

type EncryptionKeyBackend = 'secure' | 'session'

interface EncryptionKeyError {
  message: string
  code: string
}

const KEY_PREFIX = 'river-journal:e2e:'
const memoryCache = new Map<string, string>()

const getStorageKey = (userId: string) => `${KEY_PREFIX}${userId}`

export async function saveEncryptionKey(
  userId: string,
  keyHex: string
): Promise<
  | { backend: EncryptionKeyBackend; error: null }
  | { backend: EncryptionKeyBackend; error: EncryptionKeyError }
> {
  const storageKey = getStorageKey(userId)

  try {
    await SecureStore.setItemAsync(storageKey, keyHex)
    memoryCache.set(storageKey, keyHex)
    return { backend: 'secure', error: null }
  } catch {
    return {
      backend: 'secure',
      error: {
        message: 'This device could not store the encryption key securely.',
        code: 'encryption_key_storage_failed',
      },
    }
  }
}

export async function loadEncryptionKey(
  userId: string
): Promise<{ keyHex: string | null; backend: EncryptionKeyBackend }> {
  const storageKey = getStorageKey(userId)
  const cached = memoryCache.get(storageKey)

  if (cached) {
    return { keyHex: cached, backend: 'secure' }
  }

  const keyHex = await SecureStore.getItemAsync(storageKey)
  if (keyHex) {
    memoryCache.set(storageKey, keyHex)
  }

  return { keyHex, backend: 'secure' }
}

export async function deleteEncryptionKey(userId: string): Promise<void> {
  const storageKey = getStorageKey(userId)
  memoryCache.delete(storageKey)
  await SecureStore.deleteItemAsync(storageKey)
}

export async function hasEncryptionKey(userId: string): Promise<boolean> {
  const { keyHex } = await loadEncryptionKey(userId)
  return !!keyHex
}
