import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadUserEncryptionSettings = vi.fn()
const mockUpsertUserEncryptionMode = vi.fn()
const mockStartE2EEncryptionBootstrap = vi.fn()
const mockLoadEncryptionKey = vi.fn()

vi.mock('../../utils/userEncryption', () => ({
  readUserEncryptionSettings: (...args: unknown[]) => mockReadUserEncryptionSettings(...args),
  upsertUserEncryptionMode: (...args: unknown[]) => mockUpsertUserEncryptionMode(...args),
  startE2EEncryptionBootstrap: (...args: unknown[]) => mockStartE2EEncryptionBootstrap(...args),
}))

vi.mock('../../utils/encryptionKeyStore', () => ({
  loadEncryptionKey: (...args: unknown[]) => mockLoadEncryptionKey(...args),
}))

vi.mock('../../utils/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    })),
  },
}))

vi.mock('../persistConfig', () => ({
  persistPlugin: {
    getTable: vi.fn(() => ({})),
    setTable: vi.fn(),
    deleteTable: vi.fn(),
    getMetadata: vi.fn(),
    setMetadata: vi.fn(),
    deleteMetadata: vi.fn(),
    loadTable: vi.fn(),
    saveTable: vi.fn(),
    set: vi.fn(),
  },
  configurePersistence: vi.fn(),
}))

import { store$ } from '../store'
import {
  cancelEncryptionSetup,
  confirmEncryptionModeSelection,
  encryptionSetup$,
  isEncryptionReadyForSync$,
  loadCurrentEncryptionMode,
  requestSyncEnable,
  resetEncryptionSetupState,
  setSelectedEncryptionMode,
  submitE2EPassword,
} from '../encryptionSetup'

describe('encryption setup orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEncryptionSetupState()
    store$.session.assign({
      localSessionId: 'sess-1',
      userId: 'user-1',
      email: 'charlie@example.com',
      isAuthenticated: true,
      syncEnabled: false,
    })

    mockReadUserEncryptionSettings.mockResolvedValue({
      data: { mode: null, salt: null },
      error: null,
    })
    mockUpsertUserEncryptionMode.mockResolvedValue({
      data: { mode: 'managed', salt: null },
      error: null,
    })
    mockLoadEncryptionKey.mockResolvedValue({
      keyHex: null,
      backend: 'session',
    })
    mockStartE2EEncryptionBootstrap.mockResolvedValue({
      data: {
        mode: 'e2e',
        salt: 'ab'.repeat(16),
        keyBackend: 'secure',
      },
      error: null,
    })
  })

  it('first-time enable opens the chooser instead of enabling sync', async () => {
    const didEnable = await requestSyncEnable()

    expect(didEnable).toBe(false)
    expect(mockReadUserEncryptionSettings).toHaveBeenCalledWith('user-1')
    expect(store$.session.syncEnabled.get()).toBe(false)
    expect(encryptionSetup$.isOpen.get()).toBe(true)
    expect(encryptionSetup$.selectedMode.get()).toBe('e2e')
  })

  it('cancel leaves sync disabled and closes the dialog', async () => {
    await requestSyncEnable()

    cancelEncryptionSetup()

    expect(store$.session.syncEnabled.get()).toBe(false)
    expect(encryptionSetup$.isOpen.get()).toBe(false)
    expect(encryptionSetup$.step.get()).toBe('choice')
  })

  it('managed mode persists encryption_mode and enables sync', async () => {
    await requestSyncEnable()
    setSelectedEncryptionMode('managed')

    const didEnable = await confirmEncryptionModeSelection()

    expect(didEnable).toBe(true)
    expect(mockUpsertUserEncryptionMode).toHaveBeenCalledWith({
      userId: 'user-1',
      mode: 'managed',
    })
    expect(store$.session.syncEnabled.get()).toBe(true)
    expect(encryptionSetup$.currentMode.get()).toBe('managed')
    expect(isEncryptionReadyForSync$.get()).toBe(true)
    expect(encryptionSetup$.isOpen.get()).toBe(false)
  })

  it('E2E selection advances to the password step and keeps sync blocked', async () => {
    await requestSyncEnable()

    const didEnable = await confirmEncryptionModeSelection()

    expect(didEnable).toBe(false)
    expect(encryptionSetup$.step.get()).toBe('e2e-password')
    expect(store$.session.syncEnabled.get()).toBe(false)
    expect(mockUpsertUserEncryptionMode).not.toHaveBeenCalled()
  })

  it('existing managed-mode users bypass the chooser', async () => {
    encryptionSetup$.assign({
      hasLoadedMode: true,
      currentMode: 'managed',
      currentModeSalt: null,
      localKeyState: 'unknown',
      error: null,
    })
    isEncryptionReadyForSync$.set(true)

    const didEnable = await requestSyncEnable()

    expect(didEnable).toBe(true)
    expect(encryptionSetup$.isOpen.get()).toBe(false)
    expect(store$.session.syncEnabled.get()).toBe(true)
    expect(mockReadUserEncryptionSettings).not.toHaveBeenCalled()
  })

  it('persistence failure leaves sync off and surfaces an error', async () => {
    await requestSyncEnable()
    setSelectedEncryptionMode('managed')
    mockUpsertUserEncryptionMode.mockResolvedValueOnce({
      data: null,
      error: { message: 'Could not save encryption mode.', code: 'save_failed' },
    })

    const didEnable = await confirmEncryptionModeSelection()

    expect(didEnable).toBe(false)
    expect(store$.session.syncEnabled.get()).toBe(false)
    expect(encryptionSetup$.error.get()).toEqual({
      message: 'Could not save encryption mode.',
      code: 'save_failed',
    })
  })

  it('E2E password submission persists mode and keeps sync off until bootstrap exists', async () => {
    await requestSyncEnable()
    await confirmEncryptionModeSelection()

    const didEnable = await submitE2EPassword('password123', 'password123')

    expect(didEnable).toBe(true)
    expect(mockStartE2EEncryptionBootstrap).toHaveBeenCalledWith({
      userId: 'user-1',
      password: 'password123',
    })
    expect(encryptionSetup$.currentMode.get()).toBe('e2e')
    expect(encryptionSetup$.currentModeSalt.get()).toBe('ab'.repeat(16))
    expect(encryptionSetup$.localKeyState.get()).toBe('available')
    expect(encryptionSetup$.isOpen.get()).toBe(false)
    expect(store$.session.syncEnabled.get()).toBe(true)
    expect(isEncryptionReadyForSync$.get()).toBe(true)
    expect(encryptionSetup$.error.get()).toBeNull()
  })

  it('rehydrating salt-only E2E keeps sync blocked and requires the key', async () => {
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: { mode: 'e2e', salt: 'cd'.repeat(16) },
      error: null,
    })

    const mode = await loadCurrentEncryptionMode()

    expect(mode).toBe('e2e')
    expect(encryptionSetup$.currentMode.get()).toBe('e2e')
    expect(encryptionSetup$.localKeyState.get()).toBe('missing')
    expect(encryptionSetup$.error.get()).toEqual({
      message: 'This device still needs your encryption password before Cloud Sync can turn on.',
      code: 'encryption_key_required',
    })
    expect(store$.session.syncEnabled.get()).toBe(false)
  })

  it('existing E2E users become ready when the local key is available', async () => {
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: { mode: 'e2e', salt: 'ef'.repeat(16) },
      error: null,
    })
    mockLoadEncryptionKey.mockResolvedValueOnce({
      keyHex: 'aa'.repeat(32),
      backend: 'secure',
    })

    const mode = await loadCurrentEncryptionMode()

    expect(mode).toBe('e2e')
    expect(encryptionSetup$.localKeyState.get()).toBe('available')
    expect(encryptionSetup$.keyBackend.get()).toBe('secure')
    expect(isEncryptionReadyForSync$.get()).toBe(true)
  })

  it('bootstrap rollback failure keeps sync off and resets the chosen mode', async () => {
    await requestSyncEnable()
    await confirmEncryptionModeSelection()
    mockStartE2EEncryptionBootstrap.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'This device could not store the encryption key securely.',
        code: 'encryption_key_storage_failed',
      },
    })

    const didEnable = await submitE2EPassword('password123', 'password123')

    expect(didEnable).toBe(false)
    expect(encryptionSetup$.currentMode.get()).toBeNull()
    expect(encryptionSetup$.currentModeSalt.get()).toBeNull()
    expect(store$.session.syncEnabled.get()).toBe(false)
    expect(isEncryptionReadyForSync$.get()).toBe(false)
    expect(encryptionSetup$.error.get()).toEqual({
      message: 'This device could not store the encryption key securely.',
      code: 'encryption_key_storage_failed',
    })
  })

  it('deduplicates concurrent encryption-mode loads', async () => {
    let resolveRead: ((value: { data: { mode: null; salt: null }; error: null }) => void) | null = null
    mockReadUserEncryptionSettings.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveRead = resolve
        })
    )

    const pendingOne = loadCurrentEncryptionMode()
    const pendingTwo = loadCurrentEncryptionMode()

    expect(mockReadUserEncryptionSettings).toHaveBeenCalledTimes(1)

    const resolveReadFn = resolveRead as unknown as (value: {
      data: { mode: null; salt: null }
      error: null
    }) => void
    resolveReadFn({
      data: { mode: null, salt: null },
      error: null,
    })

    await Promise.all([pendingOne, pendingTwo])
  })
})
