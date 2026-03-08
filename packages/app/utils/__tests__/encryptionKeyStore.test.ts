import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalWindow = globalThis.window

const setWindow = (value: unknown) => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value,
    writable: true,
  })
}

describe('encryptionKeyStore (web/desktop)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unmock('@tauri-apps/api/core')
    delete (globalThis as { window?: Window }).window
  })

  afterEach(() => {
    vi.resetModules()
    if (originalWindow) {
      globalThis.window = originalWindow
    } else {
      delete (globalThis as { window?: Window }).window
    }
  })

  it('uses session storage when Tauri is unavailable', async () => {
    const store = await import('../encryptionKeyStore')

    await expect(store.saveEncryptionKey('user-1', 'aa'.repeat(32))).resolves.toEqual({
      backend: 'session',
      error: null,
    })
    await expect(store.loadEncryptionKey('user-1')).resolves.toEqual({
      keyHex: 'aa'.repeat(32),
      backend: 'session',
    })

    await store.deleteEncryptionKey('user-1')
    await expect(store.loadEncryptionKey('user-1')).resolves.toEqual({
      keyHex: null,
      backend: 'session',
    })
  })

  it('uses the desktop keychain bridge when Tauri is available', async () => {
    const mockInvoke = vi.fn(async (command: string) => {
      if (command === 'get_encryption_key') return 'bb'.repeat(32)
      return null
    })

    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: mockInvoke,
    }))

    setWindow({ __TAURI_INTERNALS__: {} })

    const store = await import('../encryptionKeyStore')

    await expect(store.saveEncryptionKey('user-2', 'bb'.repeat(32))).resolves.toEqual({
      backend: 'secure',
      error: null,
    })
    await expect(store.loadEncryptionKey('user-2')).resolves.toEqual({
      keyHex: 'bb'.repeat(32),
      backend: 'secure',
    })

    expect(mockInvoke).toHaveBeenCalledWith('set_encryption_key', {
      userId: 'user-2',
      keyHex: 'bb'.repeat(32),
    })
  })

  it('falls back to session memory if the Tauri bridge fails', async () => {
    const mockInvoke = vi.fn(async (command: string) => {
      if (command === 'set_encryption_key') throw new Error('bridge unavailable')
      return null
    })

    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: mockInvoke,
    }))

    setWindow({ __TAURI_INTERNALS__: {} })

    const store = await import('../encryptionKeyStore')

    await expect(store.saveEncryptionKey('user-3', 'cc'.repeat(32))).resolves.toEqual({
      backend: 'session',
      error: null,
    })
    await expect(store.loadEncryptionKey('user-3')).resolves.toEqual({
      keyHex: 'cc'.repeat(32),
      backend: 'session',
    })
  })
})

describe('encryptionKeyStore.native', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('uses secure storage on native platforms', async () => {
    const secureStore = {
      setItemAsync: vi.fn(async () => undefined),
      getItemAsync: vi.fn(async () => 'dd'.repeat(32)),
      deleteItemAsync: vi.fn(async () => undefined),
    }

    vi.doMock('expo-secure-store', () => secureStore)

    const store = await import('../encryptionKeyStore.native')

    await expect(store.saveEncryptionKey('user-4', 'dd'.repeat(32))).resolves.toEqual({
      backend: 'secure',
      error: null,
    })
    await expect(store.loadEncryptionKey('user-4')).resolves.toEqual({
      keyHex: 'dd'.repeat(32),
      backend: 'secure',
    })

    await store.deleteEncryptionKey('user-4')
    expect(secureStore.deleteItemAsync).toHaveBeenCalled()
  })
})
