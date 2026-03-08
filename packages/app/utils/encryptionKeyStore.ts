type EncryptionKeyBackend = 'secure' | 'session'

interface EncryptionKeyError {
  message: string
  code: string
}

const KEY_PREFIX = 'river-journal:e2e:'
const memoryCache = new Map<string, { backend: EncryptionKeyBackend; keyHex: string }>()

const getStorageKey = (userId: string) => `${KEY_PREFIX}${userId}`

const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' &&
  (Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__') ||
    Object.prototype.hasOwnProperty.call(window, '__TAURI__'))

const getTauriInvoke = async () => {
  if (!isTauriRuntime()) return null

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke
  } catch {
    return null
  }
}

export async function saveEncryptionKey(
  userId: string,
  keyHex: string
): Promise<
  | { backend: EncryptionKeyBackend; error: null }
  | { backend: EncryptionKeyBackend; error: EncryptionKeyError }
> {
  const storageKey = getStorageKey(userId)
  const invoke = await getTauriInvoke()

  if (invoke) {
    try {
      await invoke('set_encryption_key', { userId, keyHex })
      memoryCache.set(storageKey, { backend: 'secure', keyHex })
      return { backend: 'secure', error: null }
    } catch {
      memoryCache.set(storageKey, { backend: 'session', keyHex })
      return { backend: 'session', error: null }
    }
  }

  memoryCache.set(storageKey, { backend: 'session', keyHex })
  return { backend: 'session', error: null }
}

export async function loadEncryptionKey(
  userId: string
): Promise<{ keyHex: string | null; backend: EncryptionKeyBackend }> {
  const storageKey = getStorageKey(userId)
  const cached = memoryCache.get(storageKey)

  if (cached) {
    return { keyHex: cached.keyHex, backend: cached.backend }
  }

  const invoke = await getTauriInvoke()

  if (invoke) {
    try {
      const keyHex = await invoke<string | null>('get_encryption_key', { userId })
      if (keyHex) {
        memoryCache.set(storageKey, { backend: 'secure', keyHex })
        return { keyHex, backend: 'secure' }
      }
    } catch {
      // Session-only fallback remains valid when the desktop bridge is unavailable.
    }
  }

  return { keyHex: null, backend: 'session' }
}

export async function deleteEncryptionKey(userId: string): Promise<void> {
  const storageKey = getStorageKey(userId)
  memoryCache.delete(storageKey)

  const invoke = await getTauriInvoke()
  if (!invoke) return

  try {
    await invoke('delete_encryption_key', { userId })
  } catch {
    // Session fallback may be the only available backend.
  }
}

export async function hasEncryptionKey(userId: string): Promise<boolean> {
  const { keyHex } = await loadEncryptionKey(userId)
  return !!keyHex
}
