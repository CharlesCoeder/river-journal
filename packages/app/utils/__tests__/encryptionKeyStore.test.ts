import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bytesToBase64 } from '../encryption'

const TEST_KEY = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1))

describe('encryptionKeyStore', () => {
  const originalDesktopFlag = process.env.NEXT_PUBLIC_IS_DESKTOP_APP

  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('@tauri-apps/api/core')
    vi.unstubAllGlobals()
    process.env.NEXT_PUBLIC_IS_DESKTOP_APP = originalDesktopFlag

    // Default mock for webKeyStore to avoid @my/ui parse issues in non-web tests
    vi.doMock('../webKeyStore', () => ({
      hasWebTrustCapability: () => false,
      getStoredDeviceToken: vi.fn().mockResolvedValue(null),
      clearWebTrustData: vi.fn().mockResolvedValue(undefined),
      loadWrappedKey: vi.fn().mockResolvedValue(null),
    }))
  })

  it('keeps web keys in memory for the current session only', async () => {
    const keyStore = await import('../encryptionKeyStore')

    await keyStore.storeMasterKey('user-web', TEST_KEY)

    expect(await keyStore.hasStoredMasterKey('user-web')).toBe(true)
    expect(await keyStore.loadMasterKey('user-web')).toEqual(TEST_KEY)

    await keyStore.clearStoredMasterKey('user-web')

    expect(await keyStore.hasStoredMasterKey('user-web')).toBe(false)
    expect(await keyStore.loadMasterKey('user-web')).toBeNull()
  })

  it('uses the Tauri keychain bridge on desktop when available', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'get_encryption_key') return bytesToBase64(TEST_KEY)
      return undefined
    })

    vi.stubGlobal('window', { __TAURI__: {} })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))

    let keyStore = await import('../encryptionKeyStore')
    await keyStore.storeMasterKey('user-desktop', TEST_KEY)

    expect(invoke).toHaveBeenCalledWith('set_encryption_key', {
      userId: 'user-desktop',
      keyB64: bytesToBase64(TEST_KEY),
    })
    expect(invoke).toHaveBeenCalledWith('get_encryption_key', { userId: 'user-desktop' })

    vi.resetModules()
    vi.stubGlobal('window', { __TAURI__: {} })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))

    keyStore = await import('../encryptionKeyStore')

    expect(await keyStore.hasStoredMasterKey('user-desktop')).toBe(true)
    expect(await keyStore.loadMasterKey('user-desktop')).toEqual(TEST_KEY)
    await keyStore.clearStoredMasterKey('user-desktop')
    expect(invoke).toHaveBeenCalledWith('delete_encryption_key', { userId: 'user-desktop' })
  })

  it('surfaces desktop keychain failures instead of silently downgrading to session-only storage', async () => {
    process.env.NEXT_PUBLIC_IS_DESKTOP_APP = 'true'

    const invoke = vi.fn(async (command: string) => {
      if (command === 'set_encryption_key') {
        throw new Error('keychain unavailable')
      }
      return null
    })

    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))

    const keyStore = await import('../encryptionKeyStore')

    await expect(keyStore.storeMasterKey('user-fallback', TEST_KEY)).rejects.toMatchObject({
      message: 'keychain unavailable',
      code: 'desktop_keychain_store_failed',
    })
  })

  it('fails when desktop keychain write verification cannot read the stored key back', async () => {
    process.env.NEXT_PUBLIC_IS_DESKTOP_APP = 'true'

    const invoke = vi.fn(async (command: string) => {
      if (command === 'get_encryption_key') return null
      return undefined
    })

    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))

    const keyStore = await import('../encryptionKeyStore')

    await expect(keyStore.storeMasterKey('user-verify', TEST_KEY)).rejects.toMatchObject({
      message: 'Desktop keychain did not return the stored encryption key during verification.',
      code: 'desktop_keychain_store_verification_failed',
    })
  })

  it('surfaces a desktop runtime error when the desktop renderer is missing the Tauri bridge', async () => {
    process.env.NEXT_PUBLIC_IS_DESKTOP_APP = 'true'
    vi.stubGlobal('window', {})

    const keyStore = await import('../encryptionKeyStore')

    await expect(keyStore.loadMasterKey('user-desktop')).rejects.toMatchObject({
      message:
        'Desktop secure storage is unavailable because the Tauri runtime bridge is missing in this renderer.',
      code: 'desktop_runtime_unavailable',
    })
  })

  describe('web trust paths', () => {
    it('hasStoredMasterKey returns true when web trust device token exists', async () => {
      vi.doMock('../webKeyStore', () => ({
        hasWebTrustCapability: () => true,
        getStoredDeviceToken: vi.fn().mockResolvedValue('some-token'),
        clearWebTrustData: vi.fn(),
        loadWrappedKey: vi.fn(),
      }))

      const keyStore = await import('../encryptionKeyStore')

      expect(await keyStore.hasStoredMasterKey('user-web-trust')).toBe(true)
    })

    it('hasStoredMasterKey returns false when no web trust data', async () => {
      vi.doMock('../webKeyStore', () => ({
        hasWebTrustCapability: () => true,
        getStoredDeviceToken: vi.fn().mockResolvedValue(null),
        clearWebTrustData: vi.fn(),
        loadWrappedKey: vi.fn(),
      }))

      const keyStore = await import('../encryptionKeyStore')

      expect(await keyStore.hasStoredMasterKey('user-no-trust')).toBe(false)
    })

    it('clearStoredMasterKey calls clearWebTrustData when web trust is available', async () => {
      const mockClearWebTrust = vi.fn().mockResolvedValue(undefined)
      vi.doMock('../webKeyStore', () => ({
        hasWebTrustCapability: () => true,
        getStoredDeviceToken: vi.fn(),
        clearWebTrustData: mockClearWebTrust,
        loadWrappedKey: vi.fn(),
      }))

      const keyStore = await import('../encryptionKeyStore')
      await keyStore.clearStoredMasterKey('user-clear-trust')

      expect(mockClearWebTrust).toHaveBeenCalledWith('user-clear-trust')
    })

    it('clearStoredMasterKey does not call clearWebTrustData when web trust is unavailable', async () => {
      const mockClearWebTrust = vi.fn().mockResolvedValue(undefined)
      vi.doMock('../webKeyStore', () => ({
        hasWebTrustCapability: () => false,
        getStoredDeviceToken: vi.fn(),
        clearWebTrustData: mockClearWebTrust,
        loadWrappedKey: vi.fn(),
      }))

      const keyStore = await import('../encryptionKeyStore')
      await keyStore.clearStoredMasterKey('user-no-web')

      expect(mockClearWebTrust).not.toHaveBeenCalled()
    })
  })
})
