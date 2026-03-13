import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'

// Reset IndexedDB between tests
beforeEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()

  // Delete the specific database we use
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('river-journal-trust')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
})

const TEST_KEY = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1))

describe('webKeyStore', () => {
  describe('hasWebTrustCapability', () => {
    it('returns true when crypto.subtle + indexedDB available + not Tauri', async () => {
      vi.stubGlobal('window', {
        crypto: { subtle: crypto.subtle },
        indexedDB,
      })

      const { hasWebTrustCapability } = await import('../webKeyStore')
      expect(hasWebTrustCapability()).toBe(true)
    })

    it('returns false when crypto.subtle is missing', async () => {
      vi.stubGlobal('window', {
        crypto: {},
        indexedDB,
      })

      const { hasWebTrustCapability } = await import('../webKeyStore')
      expect(hasWebTrustCapability()).toBe(false)
    })

    it('returns false when Tauri runtime detected', async () => {
      vi.stubGlobal('window', {
        __TAURI__: {},
        crypto: { subtle: crypto.subtle },
        indexedDB,
      })

      const { hasWebTrustCapability } = await import('../webKeyStore')
      expect(hasWebTrustCapability()).toBe(false)
    })

    it('returns false when window is undefined (SSR/native)', async () => {
      vi.stubGlobal('window', undefined)

      const { hasWebTrustCapability } = await import('../webKeyStore')
      expect(hasWebTrustCapability()).toBe(false)
    })
  })

  describe('wrapAndStoreKey + loadWrappedKey round-trip', () => {
    it('stores entry in IndexedDB and returns device token', async () => {
      const { wrapAndStoreKey } = await import('../webKeyStore')

      const result = await wrapAndStoreKey('user-1', TEST_KEY)
      expect(result.deviceToken).toBeTruthy()
      expect(typeof result.deviceToken).toBe('string')
      expect(typeof result.persistGranted).toBe('boolean')
    })

    it('round-trip: wrap → load → compare key bytes match', async () => {
      const { wrapAndStoreKey, loadWrappedKey } = await import('../webKeyStore')

      const { deviceToken } = await wrapAndStoreKey('user-rt', TEST_KEY)
      const loaded = await loadWrappedKey('user-rt')

      expect(loaded).not.toBeNull()
      expect(loaded!.masterKey).toEqual(TEST_KEY)
      expect(loaded!.deviceToken).toBe(deviceToken)
    })

    it('concurrent tab guard — add() throws ConstraintError on duplicate, returns existing token', async () => {
      const { wrapAndStoreKey } = await import('../webKeyStore')

      const first = await wrapAndStoreKey('user-dup', TEST_KEY)
      const second = await wrapAndStoreKey('user-dup', TEST_KEY)

      // Second call should return the existing token, not a new one
      expect(second.deviceToken).toBe(first.deviceToken)
    })
  })

  describe('loadWrappedKey', () => {
    it('returns null when no entry exists', async () => {
      const { loadWrappedKey } = await import('../webKeyStore')

      expect(await loadWrappedKey('nonexistent-user')).toBeNull()
    })

    it('returns null when entry has mismatched schemaVersion and clears stale entry', async () => {
      const { wrapAndStoreKey, loadWrappedKey, getStoredDeviceToken } = await import(
        '../webKeyStore'
      )

      await wrapAndStoreKey('user-stale', TEST_KEY)

      // Manually corrupt the schemaVersion in IndexedDB
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('river-journal-trust', 1)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('trusted-keys', 'readwrite')
          const store = tx.objectStore('trusted-keys')
          const getReq = store.get('user-stale')
          getReq.onsuccess = () => {
            const entry = getReq.result
            entry.schemaVersion = 999
            store.put(entry, 'user-stale')
            tx.oncomplete = () => {
              db.close()
              resolve()
            }
          }
          getReq.onerror = () => reject(getReq.error)
        }
        req.onerror = () => reject(req.error)
      })

      // loadWrappedKey should return null and clear the entry
      expect(await loadWrappedKey('user-stale')).toBeNull()
      expect(await getStoredDeviceToken('user-stale')).toBeNull()
    })
  })

  describe('clearWebTrustData', () => {
    it('removes entry, subsequent loadWrappedKey returns null', async () => {
      const { wrapAndStoreKey, loadWrappedKey, clearWebTrustData } = await import(
        '../webKeyStore'
      )

      await wrapAndStoreKey('user-clear', TEST_KEY)
      expect(await loadWrappedKey('user-clear')).not.toBeNull()

      await clearWebTrustData('user-clear')
      expect(await loadWrappedKey('user-clear')).toBeNull()
    })
  })

  describe('getStoredDeviceToken', () => {
    it('returns token without unwrapping', async () => {
      const { wrapAndStoreKey, getStoredDeviceToken } = await import('../webKeyStore')

      const { deviceToken } = await wrapAndStoreKey('user-token', TEST_KEY)
      expect(await getStoredDeviceToken('user-token')).toBe(deviceToken)
    })

    it('returns null when no entry exists', async () => {
      const { getStoredDeviceToken } = await import('../webKeyStore')

      expect(await getStoredDeviceToken('no-user')).toBeNull()
    })
  })

  describe('hashDeviceToken', () => {
    it('produces consistent SHA-256 hex digest', async () => {
      const { hashDeviceToken } = await import('../webKeyStore')

      const hash1 = await hashDeviceToken('test-token-value')
      const hash2 = await hashDeviceToken('test-token-value')

      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^[0-9a-f]{64}$/)
    })

    it('produces different hashes for different tokens', async () => {
      const { hashDeviceToken } = await import('../webKeyStore')

      const hash1 = await hashDeviceToken('token-a')
      const hash2 = await hashDeviceToken('token-b')
      expect(hash1).not.toBe(hash2)
    })
  })

  describe('getBrowserLabel', () => {
    it('uses UA-CH navigator.userAgentData when available', async () => {
      vi.stubGlobal('navigator', {
        userAgentData: {
          brands: [
            { brand: 'Chromium', version: '124' },
            { brand: 'Not A;Brand', version: '99' },
            { brand: 'Google Chrome', version: '124' },
          ],
          platform: 'macOS',
        },
        userAgent: '',
      })

      const { getBrowserLabel } = await import('../webKeyStore')
      expect(getBrowserLabel()).toBe('Google Chrome 124 on macOS')
    })

    it('falls back to UA string parsing for Firefox', async () => {
      vi.stubGlobal('navigator', {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128',
      })

      const { getBrowserLabel } = await import('../webKeyStore')
      expect(getBrowserLabel()).toBe('Firefox 128 on macOS')
    })

    it('falls back to UA string parsing for Safari', async () => {
      vi.stubGlobal('navigator', {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15',
      })

      const { getBrowserLabel } = await import('../webKeyStore')
      expect(getBrowserLabel()).toBe('Safari 17 on macOS')
    })

    it('falls back to Web Browser when both sources fail', async () => {
      vi.stubGlobal('navigator', {
        userAgent: '',
      })

      const { getBrowserLabel } = await import('../webKeyStore')
      expect(getBrowserLabel()).toBe('Web Browser')
    })

    it('detects Edge browser correctly', async () => {
      vi.stubGlobal('navigator', {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36 Edg/124',
      })

      const { getBrowserLabel } = await import('../webKeyStore')
      expect(getBrowserLabel()).toBe('Edge 124 on Windows')
    })
  })

  describe('wrapAndStoreKey read-back verification', () => {
    it('normal path succeeds with read-back', async () => {
      const mod = await import('../webKeyStore')

      const result = await mod.wrapAndStoreKey('user-readback', TEST_KEY)
      expect(result.deviceToken).toBeTruthy()
    })
  })
})
