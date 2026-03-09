import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bytesToHex } from '@noble/ciphers/utils.js'

const TEST_KEY = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1))

describe('encryptionKeyStore', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('@tauri-apps/api/core')
    vi.unstubAllGlobals()
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
      if (command === 'get_encryption_key') return bytesToHex(TEST_KEY)
      return undefined
    })

    vi.stubGlobal('window', { __TAURI__: {} })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))

    let keyStore = await import('../encryptionKeyStore')
    await keyStore.storeMasterKey('user-desktop', TEST_KEY)

    expect(invoke).toHaveBeenCalledWith('set_encryption_key', {
      userId: 'user-desktop',
      keyHex: bytesToHex(TEST_KEY),
    })

    vi.resetModules()
    vi.stubGlobal('window', { __TAURI__: {} })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))

    keyStore = await import('../encryptionKeyStore')

    expect(await keyStore.hasStoredMasterKey('user-desktop')).toBe(true)
    expect(await keyStore.loadMasterKey('user-desktop')).toEqual(TEST_KEY)
    await keyStore.clearStoredMasterKey('user-desktop')
    expect(invoke).toHaveBeenCalledWith('delete_encryption_key', { userId: 'user-desktop' })
  })

  it('falls back to session-only storage when the Tauri keychain bridge fails', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'set_encryption_key') {
        throw new Error('keychain unavailable')
      }
      return null
    })

    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))

    const keyStore = await import('../encryptionKeyStore')

    await expect(keyStore.storeMasterKey('user-fallback', TEST_KEY)).resolves.toBeUndefined()
    expect(await keyStore.loadMasterKey('user-fallback')).toEqual(TEST_KEY)
    expect(await keyStore.hasStoredMasterKey('user-fallback')).toBe(true)
  })
})
