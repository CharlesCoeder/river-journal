const inMemoryMasterKeyCache = new Map<string, Uint8Array>()

const cloneBytes = (value: Uint8Array): Uint8Array => new Uint8Array(value)

/**
 * Web/Desktop fallback for Story 4.2:
 * keep E2E keys only in memory for the current session and require password re-entry on reload.
 */
export async function storeMasterKey(userId: string, masterKey: Uint8Array): Promise<void> {
  inMemoryMasterKeyCache.set(userId, cloneBytes(masterKey))
}

export async function loadMasterKey(userId: string): Promise<Uint8Array | null> {
  const key = inMemoryMasterKeyCache.get(userId)
  return key ? cloneBytes(key) : null
}

export function getCachedMasterKey(userId: string): Uint8Array | null {
  const key = inMemoryMasterKeyCache.get(userId)
  return key ? cloneBytes(key) : null
}

export async function hasStoredMasterKey(userId: string): Promise<boolean> {
  return inMemoryMasterKeyCache.has(userId)
}

export async function clearStoredMasterKey(userId: string): Promise<void> {
  inMemoryMasterKeyCache.delete(userId)
}
