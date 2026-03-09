import { bytesToHex, hexToBytes } from '@noble/ciphers/utils.js'

const inMemoryMasterKeyCache = new Map<string, Uint8Array>()
const TAURI_SET_ENCRYPTION_KEY_COMMAND = 'set_encryption_key'
const TAURI_GET_ENCRYPTION_KEY_COMMAND = 'get_encryption_key'
const TAURI_DELETE_ENCRYPTION_KEY_COMMAND = 'delete_encryption_key'

const cloneBytes = (value: Uint8Array): Uint8Array => new Uint8Array(value)
const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' &&
  (Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__') ||
    Object.prototype.hasOwnProperty.call(window, '__TAURI__'))

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

const getTauriInvoke = async (): Promise<TauriInvoke | null> => {
  if (!isTauriRuntime()) return null

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke
  } catch {
    return null
  }
}

/**
 * Web stays session-only until a future explicit "Trust this browser" flow exists.
 * Desktop uses the Tauri keychain bridge when available and otherwise falls back to the same session cache.
 */
export async function storeMasterKey(userId: string, masterKey: Uint8Array): Promise<void> {
  inMemoryMasterKeyCache.set(userId, cloneBytes(masterKey))

  const invoke = await getTauriInvoke()
  if (!invoke) return

  try {
    await invoke<void>(TAURI_SET_ENCRYPTION_KEY_COMMAND, {
      userId,
      keyHex: bytesToHex(masterKey),
    })
  } catch {
    // The session cache is already warm; keep desktop usable even when the keychain bridge fails.
  }
}

export async function loadMasterKey(userId: string): Promise<Uint8Array | null> {
  const key = inMemoryMasterKeyCache.get(userId)
  if (key) return cloneBytes(key)

  const invoke = await getTauriInvoke()
  if (!invoke) return null

  try {
    const keyHex = await invoke<string | null>(TAURI_GET_ENCRYPTION_KEY_COMMAND, { userId })
    if (!keyHex) return null

    const persistedKey = hexToBytes(keyHex)
    inMemoryMasterKeyCache.set(userId, cloneBytes(persistedKey))
    return cloneBytes(persistedKey)
  } catch {
    return null
  }
}

export function getCachedMasterKey(userId: string): Uint8Array | null {
  const key = inMemoryMasterKeyCache.get(userId)
  return key ? cloneBytes(key) : null
}

export async function hasStoredMasterKey(userId: string): Promise<boolean> {
  if (inMemoryMasterKeyCache.has(userId)) return true

  const invoke = await getTauriInvoke()
  if (!invoke) return false

  try {
    return !!(await invoke<string | null>(TAURI_GET_ENCRYPTION_KEY_COMMAND, { userId }))
  } catch {
    return false
  }
}

export async function clearStoredMasterKey(userId: string): Promise<void> {
  inMemoryMasterKeyCache.delete(userId)

  const invoke = await getTauriInvoke()
  if (!invoke) return

  try {
    await invoke<void>(TAURI_DELETE_ENCRYPTION_KEY_COMMAND, { userId })
  } catch {
    // Session cleanup already happened; ignore keychain deletion errors here.
  }
}
