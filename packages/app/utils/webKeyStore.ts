import { bytesToBase64 } from './encryption'

const WEB_TRUST_DB_NAME = 'river-journal-trust'
const WEB_TRUST_STORE_NAME = 'trusted-keys'
const WEB_TRUST_DB_VERSION = 1
const CURRENT_SCHEMA_VERSION = 1

interface TrustEntry {
  schemaVersion: number
  kek: CryptoKey
  wrappedDek: ArrayBuffer
  iv: Uint8Array
  deviceToken: string
  userId: string
}

const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' &&
  (Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__') ||
    Object.prototype.hasOwnProperty.call(window, '__TAURI__'))

/**
 * Returns true if the current platform supports web browser trust
 * (crypto.subtle + indexedDB available, browser context, not Tauri desktop).
 * Guards against React Native by checking for document (RN has window but not document).
 */
export function hasWebTrustCapability(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof document === 'undefined') return false
  if (!window.crypto?.subtle) return false
  if (!window.indexedDB) return false
  if (isTauriRuntime()) return false
  return true
}

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WEB_TRUST_DB_NAME, WEB_TRUST_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(WEB_TRUST_STORE_NAME)) {
        db.createObjectStore(WEB_TRUST_STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const withDB = async <T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> => {
  let db: IDBDatabase | null = null
  try {
    db = await openDB()
    return await fn(db)
  } finally {
    db?.close()
  }
}

const idbGet = (db: IDBDatabase, key: string): Promise<TrustEntry | undefined> => {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WEB_TRUST_STORE_NAME, 'readonly')
    const store = tx.objectStore(WEB_TRUST_STORE_NAME)
    const request = store.get(key)
    request.onsuccess = () => resolve(request.result as TrustEntry | undefined)
    request.onerror = () => reject(request.error)
  })
}

const idbAdd = (db: IDBDatabase, key: string, value: TrustEntry): Promise<void> => {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WEB_TRUST_STORE_NAME, 'readwrite')
    const store = tx.objectStore(WEB_TRUST_STORE_NAME)
    const request = store.add(value, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

const idbDelete = (db: IDBDatabase, key: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WEB_TRUST_STORE_NAME, 'readwrite')
    const store = tx.objectStore(WEB_TRUST_STORE_NAME)
    const request = store.delete(key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * Wraps the master key (DEK) with a non-extractable KEK, stores in IndexedDB.
 * Uses add() for concurrent tab guard — ConstraintError on duplicate returns existing token.
 */
export async function wrapAndStoreKey(
  userId: string,
  masterKey: Uint8Array
): Promise<{ deviceToken: string; persistGranted: boolean }> {
  return withDB(async (db) => {
    // Generate non-extractable KEK
    const kek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'wrapKey',
      'unwrapKey',
    ])

    // Generate random IV (12 bytes for AES-GCM)
    const iv = crypto.getRandomValues(new Uint8Array(12))

    // Import DEK as extractable CryptoKey for wrapping
    // Note: Uint8Array is a valid BufferSource at runtime; the cast works around
    // a TS 5.8 type-narrowing issue with Uint8Array<ArrayBufferLike>.
    const importedDEK = await crypto.subtle.importKey(
      'raw',
      masterKey as BufferSource,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    )

    // Wrap DEK with KEK
    const wrappedDek = await crypto.subtle.wrapKey('raw', importedDEK, kek, {
      name: 'AES-GCM',
      iv: iv as BufferSource,
    })

    // Generate device token (32 random bytes, base64)
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32))
    const deviceToken = bytesToBase64(tokenBytes)

    const entry: TrustEntry = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kek,
      wrappedDek,
      iv,
      deviceToken,
      userId,
    }

    try {
      await idbAdd(db, userId, entry)
    } catch (error: unknown) {
      // Concurrent tab guard: if entry already exists, return existing token
      if (error instanceof DOMException && error.name === 'ConstraintError') {
        const existing = await idbGet(db, userId)
        if (existing) {
          return { deviceToken: existing.deviceToken, persistGranted: false }
        }
      }
      throw error
    }

    // Write-then-read verification (catches private/incognito ephemeral storage)
    const readBack = await idbGet(db, userId)
    if (!readBack) {
      throw new Error('IndexedDB write-read verification failed. Browser may be in private mode.')
    }

    // Request persistent storage to reduce eviction risk
    let persistGranted = false
    try {
      if (navigator.storage?.persist) {
        persistGranted = await navigator.storage.persist()
      }
    } catch {
      // Best-effort — not critical
    }

    return { deviceToken, persistGranted }
  })
}

/**
 * Loads and unwraps the master key from IndexedDB.
 * Returns null if no entry, schema mismatch, or unwrap fails.
 */
export async function loadWrappedKey(
  userId: string
): Promise<{ masterKey: Uint8Array; deviceToken: string } | null> {
  try {
    return await withDB(async (db) => {
      const entry = await idbGet(db, userId)
      if (!entry) return null

      // Schema version check — stale entries are cleared
      if (entry.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        await idbDelete(db, userId).catch(() => {})
        return null
      }

      try {
        // Unwrap DEK using KEK
        const unwrappedKey = await crypto.subtle.unwrapKey(
          'raw',
          entry.wrappedDek,
          entry.kek,
          { name: 'AES-GCM', iv: entry.iv as BufferSource },
          { name: 'AES-GCM' },
          true,
          ['encrypt', 'decrypt']
        )

        const masterKey = new Uint8Array(await crypto.subtle.exportKey('raw', unwrappedKey))
        return { masterKey, deviceToken: entry.deviceToken }
      } catch {
        // Tampered data or schema issue — clear and fall back
        await idbDelete(db, userId).catch(() => {})
        return null
      }
    })
  } catch {
    return null
  }
}

/**
 * Clears IndexedDB trust data for a user.
 */
export async function clearWebTrustData(userId: string): Promise<void> {
  try {
    await withDB(async (db) => {
      await idbDelete(db, userId)
    })
  } catch {
    // Best-effort — web trust is a convenience feature
  }
}

/**
 * Reads only the device token from IndexedDB without unwrapping.
 */
export async function getStoredDeviceToken(userId: string): Promise<string | null> {
  try {
    return await withDB(async (db) => {
      const entry = await idbGet(db, userId)
      return entry?.deviceToken ?? null
    })
  } catch {
    return null
  }
}

/**
 * Computes SHA-256 hex digest of a raw device token.
 */
export async function hashDeviceToken(rawToken: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(rawToken)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

interface NavigatorUAData {
  brands?: Array<{ brand: string; version: string }>
  platform?: string
}

/**
 * Derives a human-readable browser label from the user agent.
 * Uses UA-CH API when available, falls back to legacy UA string parsing.
 */
export function getBrowserLabel(): string {
  try {
    // Primary: User-Agent Client Hints API
    const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData
    if (uaData?.brands && uaData.brands.length > 0) {
      const noisePatterns = /^(chromium|not.a.brand)$/i
      const realBrand = uaData.brands.find((b) => !noisePatterns.test(b.brand))
      if (realBrand) {
        const platform = uaData.platform || 'Unknown OS'
        return `${realBrand.brand} ${realBrand.version} on ${platform}`
      }
    }

    // Fallback: legacy UA string parsing
    const ua = navigator.userAgent
    if (!ua) return 'Web Browser'

    let browser = 'Web Browser'
    let os = ''

    // Detect browser (order matters — Edge/Chrome both contain "Chrome")
    if (ua.includes('Edg/')) {
      const match = ua.match(/Edg\/(\d+)/)
      browser = match ? `Edge ${match[1]}` : 'Edge'
    } else if (ua.includes('Firefox/')) {
      const match = ua.match(/Firefox\/(\d+)/)
      browser = match ? `Firefox ${match[1]}` : 'Firefox'
    } else if (ua.includes('Safari/') && !ua.includes('Chrome/')) {
      const match = ua.match(/Version\/(\d+)/)
      browser = match ? `Safari ${match[1]}` : 'Safari'
    } else if (ua.includes('Chrome/')) {
      const match = ua.match(/Chrome\/(\d+)/)
      browser = match ? `Chrome ${match[1]}` : 'Chrome'
    }

    // Detect OS
    if (ua.includes('Mac OS X') || ua.includes('Macintosh')) os = 'macOS'
    else if (ua.includes('Windows')) os = 'Windows'
    else if (ua.includes('Android')) os = 'Android'
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'
    else if (ua.includes('Linux')) os = 'Linux'

    return os ? `${browser} on ${os}` : browser
  } catch {
    return 'Web Browser'
  }
}
