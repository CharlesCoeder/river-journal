import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadUserEncryptionSettings = vi.fn()
const mockUpsertUserEncryptionMode = vi.fn()
const mockStartE2EEncryptionBootstrap = vi.fn()
const mockUnlockE2EEncryptionOnDevice = vi.fn()
const mockLoadMasterKey = vi.fn()

vi.mock('../../utils/userEncryption', () => ({
  readUserEncryptionSettings: (...args: unknown[]) => mockReadUserEncryptionSettings(...args),
  upsertUserEncryptionMode: (...args: unknown[]) => mockUpsertUserEncryptionMode(...args),
  startE2EEncryptionBootstrap: (...args: unknown[]) => mockStartE2EEncryptionBootstrap(...args),
  unlockE2EEncryptionOnDevice: (...args: unknown[]) => mockUnlockE2EEncryptionOnDevice(...args),
}))

vi.mock('../../utils/encryptionKeyStore', () => ({
  loadMasterKey: (...args: unknown[]) => mockLoadMasterKey(...args),
  getCachedMasterKey: vi.fn(),
  storeMasterKey: vi.fn(),
  clearStoredMasterKey: vi.fn(),
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
    mockStartE2EEncryptionBootstrap.mockResolvedValue({
      error: null,
    })
    mockUnlockE2EEncryptionOnDevice.mockResolvedValue({
      error: null,
    })
    mockLoadMasterKey.mockResolvedValue(null)
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
      hasLocalE2EKey: false,
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

  it('E2E password submission stores mode+salt+key and enables sync', async () => {
    await requestSyncEnable()
    await confirmEncryptionModeSelection()
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: {
        mode: 'e2e',
        salt: '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df',
      },
      error: null,
    })
    mockLoadMasterKey.mockResolvedValueOnce(new Uint8Array(32).fill(1))

    const didEnable = await submitE2EPassword('password123', 'password123')

    expect(didEnable).toBe(true)
    expect(mockStartE2EEncryptionBootstrap).toHaveBeenCalledWith({
      userId: 'user-1',
      password: 'password123',
    })
    expect(encryptionSetup$.currentMode.get()).toBe('e2e')
    expect(encryptionSetup$.hasLocalE2EKey.get()).toBe(true)
    expect(store$.session.syncEnabled.get()).toBe(true)
    expect(isEncryptionReadyForSync$.get()).toBe(true)
    expect(encryptionSetup$.isOpen.get()).toBe(false)
  })

  it('rehydrating E2E mode with missing local key blocks sync with key-required state', async () => {
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: {
        mode: 'e2e',
        salt: '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df',
      },
      error: null,
    })
    mockLoadMasterKey.mockResolvedValueOnce(null)

    const mode = await loadCurrentEncryptionMode()

    expect(mode).toBe('e2e')
    expect(encryptionSetup$.currentMode.get()).toBe('e2e')
    expect(encryptionSetup$.hasLocalE2EKey.get()).toBe(false)
    expect(encryptionSetup$.error.get()).toEqual({
      message: 'Encryption password required on this device before Cloud Sync can be enabled.',
      code: 'e2e_password_required',
    })
    expect(store$.session.syncEnabled.get()).toBe(false)
    expect(isEncryptionReadyForSync$.get()).toBe(false)
  })

  it('existing E2E users can unlock sync on this device without re-bootstrapping', async () => {
    encryptionSetup$.assign({
      isOpen: true,
      step: 'e2e-password',
      currentMode: 'e2e',
      currentModeSalt: '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df',
      hasLocalE2EKey: false,
      hasLoadedMode: true,
    })
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: {
        mode: 'e2e',
        salt: '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df',
      },
      error: null,
    })
    mockLoadMasterKey.mockResolvedValueOnce(new Uint8Array(32).fill(7))

    const didEnable = await submitE2EPassword('password123', 'password123')

    expect(didEnable).toBe(true)
    expect(mockUnlockE2EEncryptionOnDevice).toHaveBeenCalledWith({
      userId: 'user-1',
      password: 'password123',
      salt: '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df',
    })
    expect(mockStartE2EEncryptionBootstrap).not.toHaveBeenCalled()
    expect(store$.session.syncEnabled.get()).toBe(true)
    expect(isEncryptionReadyForSync$.get()).toBe(true)
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
