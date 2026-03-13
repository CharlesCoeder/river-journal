import { bytesToBase64, base64ToBytes } from './encryption'
import { loadWrappedKey, getStoredDeviceToken, clearWebTrustData, hasWebTrustCapability } from './webKeyStore'

const inMemoryMasterKeyCache = new Map<string, Uint8Array>()
const TAURI_SET_ENCRYPTION_KEY_COMMAND = 'set_encryption_key'
const TAURI_GET_ENCRYPTION_KEY_COMMAND = 'get_encryption_key'
const TAURI_DELETE_ENCRYPTION_KEY_COMMAND = 'delete_encryption_key'
const TAURI_KEYCHAIN_TIMEOUT_MS = 4000

const cloneBytes = (value: Uint8Array): Uint8Array => new Uint8Array(value)
const isDesktopAppBuild = (): boolean => process.env.NEXT_PUBLIC_IS_DESKTOP_APP === 'true'
const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' &&
  (Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__') ||
    Object.prototype.hasOwnProperty.call(window, '__TAURI__'))

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export class EncryptionKeyStoreError extends Error {
  code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'EncryptionKeyStoreError'
    this.code = code
  }
}

const logKeyStoreDiagnostic = (message: string, details?: Record<string, unknown>) => {
  if (process.env.NODE_ENV !== 'development') return

  // Truncate userId to avoid logging full identifiers alongside key-storage operations.
  const sanitized = details
    ? Object.fromEntries(
        Object.entries(details).map(([k, v]) =>
          k === 'userId' && typeof v === 'string' ? [k, `${v.slice(0, 8)}…`] : [k, v]
        )
      )
    : undefined

  // eslint-disable-next-line no-console
  console.info('[encryptionKeyStore]', message, {
    isDesktopAppBuild: isDesktopAppBuild(),
    hasWindow: typeof window !== 'undefined',
    hasTauriRuntime: typeof window !== 'undefined' ? isTauriRuntime() : false,
    protocol: typeof window !== 'undefined' ? window.location?.protocol : null,
    userAgent:
      typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
        ? navigator.userAgent
        : null,
    ...sanitized,
  })
}

const getTauriInvoke = async (): Promise<TauriInvoke | null> => {
  if (typeof window === 'undefined') return null

  if (!isTauriRuntime()) {
    if (isDesktopAppBuild()) {
      const error = new EncryptionKeyStoreError(
        'Desktop secure storage is unavailable because the Tauri runtime bridge is missing in this renderer.',
        'desktop_runtime_unavailable'
      )
      logKeyStoreDiagnostic('missing Tauri runtime bridge', { code: error.code })
      throw error
    }

    logKeyStoreDiagnostic('Tauri runtime not detected; using web/session-only key storage')
    return null
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    logKeyStoreDiagnostic('loaded Tauri invoke bridge')
    return invoke
  } catch (error) {
    if (isDesktopAppBuild()) {
      const wrappedError = toKeyStoreError(
        error,
        'Desktop secure storage is unavailable because the Tauri API bridge could not be loaded.',
        'desktop_tauri_api_unavailable'
      )
      logKeyStoreDiagnostic('failed to load Tauri invoke bridge', {
        code: wrappedError.code,
        message: wrappedError.message,
      })
      throw wrappedError
    }

    logKeyStoreDiagnostic('failed to load Tauri API in non-desktop runtime; using session storage')
    return null
  }
}

const withKeychainTimeout = async <T>(
  operation: Promise<T>,
  timeoutMessage: string,
  timeoutCode: string
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new EncryptionKeyStoreError(timeoutMessage, timeoutCode))
        }, TAURI_KEYCHAIN_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

const toKeyStoreError = (error: unknown, fallbackMessage: string, fallbackCode: string) => {
  if (error instanceof EncryptionKeyStoreError) return error

  const message =
    error instanceof Error && error.message ? error.message : fallbackMessage

  return new EncryptionKeyStoreError(message, fallbackCode)
}

/**
 * Stores the master key in memory and (on desktop) in the Tauri keychain.
 * Web trust persistence is handled separately via webKeyStore.ts.
 */
export async function storeMasterKey(userId: string, masterKey: Uint8Array): Promise<void> {
  inMemoryMasterKeyCache.set(userId, cloneBytes(masterKey))

  const invoke = await getTauriInvoke()
  if (!invoke) return

  const expectedKeyB64 = bytesToBase64(masterKey)

  try {
    logKeyStoreDiagnostic('storing master key via Tauri keychain', { userId })
    await withKeychainTimeout(
      invoke<void>(TAURI_SET_ENCRYPTION_KEY_COMMAND, {
        userId,
        keyB64: expectedKeyB64,
      }),
      'Timed out while storing the encryption key in the desktop keychain.',
      'desktop_keychain_store_timeout'
    )

    const persistedKeyB64 = await withKeychainTimeout(
      invoke<string | null>(TAURI_GET_ENCRYPTION_KEY_COMMAND, { userId }),
      'Timed out while verifying the desktop keychain after storing the encryption key.',
      'desktop_keychain_store_verify_timeout'
    )

    if (persistedKeyB64 !== expectedKeyB64) {
      throw new EncryptionKeyStoreError(
        'Desktop keychain did not return the stored encryption key during verification.',
        'desktop_keychain_store_verification_failed'
      )
    }

    logKeyStoreDiagnostic('verified stored master key via Tauri keychain', { userId })
  } catch (error) {
    inMemoryMasterKeyCache.delete(userId)
    logKeyStoreDiagnostic('failed to store master key via Tauri keychain', {
      userId,
      message: error instanceof Error ? error.message : null,
    })
    throw toKeyStoreError(
      error,
      'Failed to store the encryption key in the desktop keychain.',
      'desktop_keychain_store_failed'
    )
  }
}

export async function loadMasterKey(userId: string): Promise<Uint8Array | null> {
  const key = inMemoryMasterKeyCache.get(userId)
  if (key) {
    logKeyStoreDiagnostic('loaded master key from in-memory cache', { userId })
    return cloneBytes(key)
  }

  const invoke = await getTauriInvoke()
  if (!invoke) return null

  try {
    logKeyStoreDiagnostic('loading master key via Tauri keychain', { userId })
    const keyB64 = await withKeychainTimeout(
      invoke<string | null>(TAURI_GET_ENCRYPTION_KEY_COMMAND, { userId }),
      'Timed out while accessing the desktop keychain for the encryption key.',
      'desktop_keychain_load_timeout'
    )
    if (!keyB64) {
      logKeyStoreDiagnostic('no persisted master key returned from Tauri keychain', { userId })
      return null
    }

    const persistedKey = base64ToBytes(keyB64)
    inMemoryMasterKeyCache.set(userId, cloneBytes(persistedKey))
    logKeyStoreDiagnostic('loaded master key from Tauri keychain', { userId })
    return cloneBytes(persistedKey)
  } catch (error) {
    logKeyStoreDiagnostic('failed to load master key via Tauri keychain', {
      userId,
      message: error instanceof Error ? error.message : null,
    })
    throw toKeyStoreError(
      error,
      'Failed to access the desktop keychain for the encryption key.',
      'desktop_keychain_load_failed'
    )
  }
}

export function getCachedMasterKey(userId: string): Uint8Array | null {
  const key = inMemoryMasterKeyCache.get(userId)
  return key ? cloneBytes(key) : null
}

export async function hasStoredMasterKey(userId: string): Promise<boolean> {
  if (inMemoryMasterKeyCache.has(userId)) return true

  try {
    if (await loadMasterKey(userId)) return true
  } catch {
    // Tauri keychain failed — check web trust below
  }

  // Check web trust (presence check only, no unwrap, no network)
  if (hasWebTrustCapability()) {
    try {
      const token = await getStoredDeviceToken(userId)
      if (token) return true
    } catch {
      // Best-effort
    }
  }

  return false
}

export async function clearStoredMasterKey(userId: string): Promise<void> {
  inMemoryMasterKeyCache.delete(userId)

  // Clear web trust data if on web
  if (hasWebTrustCapability()) {
    try {
      await clearWebTrustData(userId)
    } catch {
      // Best-effort
    }
  }

  let invoke: TauriInvoke | null = null
  try {
    invoke = await getTauriInvoke()
  } catch (error) {
    logKeyStoreDiagnostic('failed to initialize Tauri bridge during key cleanup', {
      userId,
      message: error instanceof Error ? error.message : null,
    })
    return
  }
  if (!invoke) return

  try {
    logKeyStoreDiagnostic('clearing master key via Tauri keychain', { userId })
    await invoke<void>(TAURI_DELETE_ENCRYPTION_KEY_COMMAND, { userId })
  } catch (error) {
    logKeyStoreDiagnostic('failed to clear master key via Tauri keychain', {
      userId,
      message: error instanceof Error ? error.message : null,
    })
  }
}

/**
 * Cache the master key in memory only, without touching any platform keyring.
 * Used during Phase 1 of the deferred keyring flow so the app can enable sync
 * immediately after key derivation without waiting for keyring I/O.
 */
export function cacheOnlyMasterKey(userId: string, masterKey: Uint8Array): void {
  inMemoryMasterKeyCache.set(userId, cloneBytes(masterKey))
}

/**
 * Returns true when the current platform has a durable keyring backend
 * (Tauri desktop with OS keychain). Web session-only storage is not
 * considered a platform keyring.
 */
export async function hasPlatformKeyring(): Promise<boolean> {
  try {
    const invoke = await getTauriInvoke()
    return invoke !== null
  } catch {
    return false
  }
}

