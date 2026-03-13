import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadUserEncryptionSettings = vi.fn()
const mockUpsertUserEncryptionMode = vi.fn()
const mockStartE2EEncryptionBootstrap = vi.fn()
const mockUnlockE2EEncryptionOnDevice = vi.fn()
const mockValidateE2EMasterKeyForUser = vi.fn()
const mockPersistMasterKeyToKeyring = vi.fn()
const mockBootstrapManagedEncryption = vi.fn()
const mockFetchManagedEncryptionKey = vi.fn()
const mockLoadMasterKey = vi.fn()
const mockClearStoredMasterKey = vi.fn()
const mockHasPlatformKeyring = vi.fn()
const mockRegisterTrustedBrowser = vi.fn()
const mockVerifyTrustedBrowser = vi.fn()
const mockUpdateTrustedBrowserLastUsed = vi.fn()

const mockHasWebTrustCapability = vi.fn()
const mockWrapAndStoreKey = vi.fn()
const mockLoadWrappedKey = vi.fn()
const mockGetStoredDeviceToken = vi.fn()
const mockHashDeviceToken = vi.fn()
const mockGetBrowserLabel = vi.fn()
const mockClearWebTrustData = vi.fn()

vi.mock('../../utils/webKeyStore', () => ({
  hasWebTrustCapability: (...args: unknown[]) => mockHasWebTrustCapability(...args),
  wrapAndStoreKey: (...args: unknown[]) => mockWrapAndStoreKey(...args),
  loadWrappedKey: (...args: unknown[]) => mockLoadWrappedKey(...args),
  getStoredDeviceToken: (...args: unknown[]) => mockGetStoredDeviceToken(...args),
  hashDeviceToken: (...args: unknown[]) => mockHashDeviceToken(...args),
  getBrowserLabel: (...args: unknown[]) => mockGetBrowserLabel(...args),
  clearWebTrustData: (...args: unknown[]) => mockClearWebTrustData(...args),
}))

vi.mock('../../utils/userEncryption', () => ({
  readUserEncryptionSettings: (...args: unknown[]) => mockReadUserEncryptionSettings(...args),
  upsertUserEncryptionMode: (...args: unknown[]) => mockUpsertUserEncryptionMode(...args),
  startE2EEncryptionBootstrap: (...args: unknown[]) => mockStartE2EEncryptionBootstrap(...args),
  unlockE2EEncryptionOnDevice: (...args: unknown[]) => mockUnlockE2EEncryptionOnDevice(...args),
  validateE2EMasterKeyForUser: (...args: unknown[]) => mockValidateE2EMasterKeyForUser(...args),
  persistMasterKeyToKeyring: (...args: unknown[]) => mockPersistMasterKeyToKeyring(...args),
  bootstrapManagedEncryption: (...args: unknown[]) => mockBootstrapManagedEncryption(...args),
  fetchManagedEncryptionKey: (...args: unknown[]) => mockFetchManagedEncryptionKey(...args),
  registerTrustedBrowser: (...args: unknown[]) => mockRegisterTrustedBrowser(...args),
  verifyTrustedBrowser: (...args: unknown[]) => mockVerifyTrustedBrowser(...args),
  updateTrustedBrowserLastUsed: (...args: unknown[]) => mockUpdateTrustedBrowserLastUsed(...args),
}))

vi.mock('../../utils/encryptionKeyStore', () => ({
  loadMasterKey: (...args: unknown[]) => mockLoadMasterKey(...args),
  getCachedMasterKey: vi.fn(),
  storeMasterKey: vi.fn(),
  cacheOnlyMasterKey: vi.fn(),
  clearStoredMasterKey: (...args: unknown[]) => mockClearStoredMasterKey(...args),
  hasPlatformKeyring: (...args: unknown[]) => mockHasPlatformKeyring(...args),
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
  acceptKeyringPersistence,
  cancelEncryptionSetup,
  confirmEncryptionModeSelection,
  declineKeyringPersistence,
  encryptionSetup$,
  isEncryptionReadyForSync$,
  keyringPersistResult$,
  keyringPrompt$,
  loadCurrentEncryptionMode,
  requestSyncEnable,
  resetEncryptionSetupState,
  retryFetchManagedKey,
  retryWithE2EPassword,
  setSelectedEncryptionMode,
  submitE2EPassword,
  acceptBrowserTrust,
  declineBrowserTrust,
  dismissTrustBrowserPrompt,
  trustBrowserPrompt$,
  trustBrowserResult$,
} from '../encryptionSetup'
import { syncManagedKeyBytes$ } from '../syncConfig'
import { syncEncryptionError$ } from '../syncConfig'
import { base64ToBytes } from '../../utils/encryption'

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
      data: { mode: null, salt: null, managedKeyB64: null },
      error: null,
    })
    mockUpsertUserEncryptionMode.mockResolvedValue({
      data: { mode: 'managed', salt: null, managedKeyB64: null },
      error: null,
    })
    mockStartE2EEncryptionBootstrap.mockResolvedValue({
      error: null,
      masterKey: new Uint8Array(32).fill(1),
    })
    mockUnlockE2EEncryptionOnDevice.mockResolvedValue({
      error: null,
      masterKey: new Uint8Array(32).fill(1),
    })
    mockValidateE2EMasterKeyForUser.mockResolvedValue({
      error: null,
      didVerify: false,
    })
    mockLoadMasterKey.mockResolvedValue(null)
    mockClearStoredMasterKey.mockResolvedValue(undefined)
    mockHasPlatformKeyring.mockResolvedValue(false)
    mockPersistMasterKeyToKeyring.mockResolvedValue({ error: null })
    mockBootstrapManagedEncryption.mockResolvedValue({
      error: null,
      managedKeyB64: 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=',
    })
    mockFetchManagedEncryptionKey.mockResolvedValue({
      data: 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=',
      error: null,
    })
    mockHasWebTrustCapability.mockReturnValue(false)
    mockWrapAndStoreKey.mockResolvedValue({ deviceToken: 'test-token', persistGranted: true })
    mockLoadWrappedKey.mockResolvedValue(null)
    mockGetStoredDeviceToken.mockResolvedValue(null)
    mockHashDeviceToken.mockResolvedValue('hashed-token')
    mockGetBrowserLabel.mockReturnValue('Chrome 124 on macOS')
    mockClearWebTrustData.mockResolvedValue(undefined)
    mockRegisterTrustedBrowser.mockResolvedValue({ error: null })
    mockVerifyTrustedBrowser.mockResolvedValue({ status: 'valid', id: 'browser-1' })
    mockUpdateTrustedBrowserLastUsed.mockResolvedValue(undefined)
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

  it('managed mode calls bootstrapManagedEncryption and caches the key', async () => {
    await requestSyncEnable()
    setSelectedEncryptionMode('managed')

    const didEnable = await confirmEncryptionModeSelection()

    expect(didEnable).toBe(true)
    expect(mockBootstrapManagedEncryption).toHaveBeenCalledWith({ userId: 'user-1' })
    expect(store$.session.syncEnabled.get()).toBe(true)
    expect(encryptionSetup$.currentMode.get()).toBe('managed')
    expect(isEncryptionReadyForSync$.get()).toBe(true)
    expect(encryptionSetup$.isOpen.get()).toBe(false)
    expect(syncManagedKeyBytes$.get()).toEqual(base64ToBytes('qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo='))
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

  it('managed bootstrap failure leaves sync off and surfaces an error', async () => {
    await requestSyncEnable()
    setSelectedEncryptionMode('managed')
    mockBootstrapManagedEncryption.mockResolvedValueOnce({
      error: { message: 'Key generation failed.', code: 'managed_bootstrap_failed' },
      managedKeyB64: null,
    })

    const didEnable = await confirmEncryptionModeSelection()

    expect(didEnable).toBe(false)
    expect(store$.session.syncEnabled.get()).toBe(false)
    expect(encryptionSetup$.error.get()).toEqual({
      message: 'Key generation failed.',
      code: 'managed_bootstrap_failed',
    })
  })

  it('loadCurrentEncryptionMode pre-caches managed key from initial query (no N+1)', async () => {
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: { mode: 'managed', salt: null, managedKeyB64: 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=' },
      error: null,
    })

    const mode = await loadCurrentEncryptionMode()

    expect(mode).toBe('managed')
    expect(mockFetchManagedEncryptionKey).not.toHaveBeenCalled()
    expect(syncManagedKeyBytes$.get()).toEqual(base64ToBytes('qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo='))
    expect(encryptionSetup$.currentMode.get()).toBe('managed')
    expect(isEncryptionReadyForSync$.get()).toBe(true)
  })

  it('blocks sync when managed key cannot be fetched', async () => {
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: { mode: 'managed', salt: null, managedKeyB64: null },
      error: null,
    })
    mockFetchManagedEncryptionKey.mockResolvedValueOnce({
      data: null,
      error: { message: 'Managed key missing', code: 'managed_key_missing' },
    })

    const mode = await loadCurrentEncryptionMode()

    expect(mode).toBe('managed')
    expect(encryptionSetup$.currentMode.get()).toBe('managed')
    expect(isEncryptionReadyForSync$.get()).toBe(false)
    expect(store$.session.syncEnabled.get()).toBe(false)
    expect(encryptionSetup$.error.get()).toEqual({
      message: 'Managed key missing',
      code: 'managed_key_missing',
    })
  })

  it('persistence failure leaves sync off and surfaces an error', async () => {
    await requestSyncEnable()
    setSelectedEncryptionMode('managed')
    mockBootstrapManagedEncryption.mockResolvedValueOnce({
      error: { message: 'Could not save encryption mode.', code: 'save_failed' },
      managedKeyB64: null,
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
        salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
        managedKeyB64: null,
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
        salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
        managedKeyB64: null,
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

  it('clears an invalid stored E2E key and keeps sync blocked until the password is re-entered', async () => {
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: {
        mode: 'e2e',
        salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
        managedKeyB64: null,
      },
      error: null,
    })
    mockLoadMasterKey.mockResolvedValueOnce(new Uint8Array(32).fill(9))
    mockValidateE2EMasterKeyForUser.mockResolvedValueOnce({
      error: {
        message:
          'The stored encryption key on this device could not unlock your journal. Enter your encryption password again.',
        code: 'invalid_local_encryption_key',
      },
      didVerify: true,
    })

    const mode = await loadCurrentEncryptionMode()

    expect(mode).toBe('e2e')
    expect(encryptionSetup$.hasLocalE2EKey.get()).toBe(false)
    expect(encryptionSetup$.error.get()).toEqual({
      message:
        'The stored encryption key on this device could not unlock your journal. Enter your encryption password again.',
      code: 'invalid_local_encryption_key',
    })
    expect(mockClearStoredMasterKey).toHaveBeenCalledWith('user-1')
    expect(store$.session.syncEnabled.get()).toBe(false)
    expect(isEncryptionReadyForSync$.get()).toBe(false)
  })

  it('surfaces secure-storage failures while hydrating desktop E2E state', async () => {
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: {
        mode: 'e2e',
        salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
        managedKeyB64: null,
      },
      error: null,
    })
    mockLoadMasterKey.mockRejectedValueOnce({
      message: 'Timed out while accessing the desktop keychain for the encryption key.',
      code: 'desktop_keychain_load_timeout',
    })

    const mode = await loadCurrentEncryptionMode()

    expect(mode).toBe('e2e')
    expect(encryptionSetup$.currentMode.get()).toBe('e2e')
    expect(encryptionSetup$.hasLocalE2EKey.get()).toBe(false)
    expect(encryptionSetup$.error.get()).toEqual({
      message: 'Timed out while accessing the desktop keychain for the encryption key.',
      code: 'desktop_keychain_load_timeout',
    })
    expect(store$.session.syncEnabled.get()).toBe(false)
    expect(isEncryptionReadyForSync$.get()).toBe(false)
  })

  it('existing E2E users can unlock sync on this device without re-bootstrapping', async () => {
    encryptionSetup$.assign({
      isOpen: true,
      step: 'e2e-password',
      currentMode: 'e2e',
      currentModeSalt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
      hasLocalE2EKey: false,
      hasLoadedMode: true,
    })
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: {
        mode: 'e2e',
        salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
        managedKeyB64: null,
      },
      error: null,
    })
    mockLoadMasterKey.mockResolvedValueOnce(new Uint8Array(32).fill(7))

    const didEnable = await submitE2EPassword('password123', '')

    expect(didEnable).toBe(true)
    expect(mockUnlockE2EEncryptionOnDevice).toHaveBeenCalledWith({
      userId: 'user-1',
      password: 'password123',
      salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
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

  it('shows keyring prompt after successful E2E submit when platform has keyring', async () => {
    mockHasPlatformKeyring.mockResolvedValueOnce(true)
    await requestSyncEnable()
    await confirmEncryptionModeSelection()
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: {
        mode: 'e2e',
        salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
        managedKeyB64: null,
      },
      error: null,
    })
    mockLoadMasterKey.mockResolvedValueOnce(new Uint8Array(32).fill(1))

    const didEnable = await submitE2EPassword('password123', 'password123')

    expect(didEnable).toBe(true)
    expect(store$.session.syncEnabled.get()).toBe(true)
    expect(keyringPrompt$.isVisible.get()).toBe(true)
  })

  it('does not show keyring prompt when platform has no keyring', async () => {
    mockHasPlatformKeyring.mockResolvedValueOnce(false)
    await requestSyncEnable()
    await confirmEncryptionModeSelection()
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: {
        mode: 'e2e',
        salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
        managedKeyB64: null,
      },
      error: null,
    })
    mockLoadMasterKey.mockResolvedValueOnce(new Uint8Array(32).fill(1))

    const didEnable = await submitE2EPassword('password123', 'password123')

    expect(didEnable).toBe(true)
    expect(keyringPrompt$.isVisible.get()).toBe(false)
  })

  it('acceptKeyringPersistence calls persistMasterKeyToKeyring and reports success', async () => {
    mockHasPlatformKeyring.mockResolvedValueOnce(true)
    await requestSyncEnable()
    await confirmEncryptionModeSelection()
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: {
        mode: 'e2e',
        salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
        managedKeyB64: null,
      },
      error: null,
    })
    mockLoadMasterKey.mockResolvedValueOnce(new Uint8Array(32).fill(1))
    await submitE2EPassword('password123', 'password123')

    await acceptKeyringPersistence()

    expect(mockPersistMasterKeyToKeyring).toHaveBeenCalled()
    expect(keyringPrompt$.isVisible.get()).toBe(false)
    expect(keyringPersistResult$.success.get()).toBe(true)
  })

  it('declineKeyringPersistence hides prompt without writing to keyring', async () => {
    mockHasPlatformKeyring.mockResolvedValueOnce(true)
    await requestSyncEnable()
    await confirmEncryptionModeSelection()
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: {
        mode: 'e2e',
        salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
        managedKeyB64: null,
      },
      error: null,
    })
    mockLoadMasterKey.mockResolvedValueOnce(new Uint8Array(32).fill(1))
    await submitE2EPassword('password123', 'password123')

    declineKeyringPersistence()

    expect(keyringPrompt$.isVisible.get()).toBe(false)
    expect(mockPersistMasterKeyToKeyring).not.toHaveBeenCalled()
  })

  it('retryFetchManagedKey refetches the key and enables sync', async () => {
    store$.session.userId.set('user-1')
    mockFetchManagedEncryptionKey.mockResolvedValueOnce({
      data: 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=',
      error: null,
    })

    const result = await retryFetchManagedKey()

    expect(result).toBe(true)
    expect(mockFetchManagedEncryptionKey).toHaveBeenCalledWith('user-1')
    expect(syncManagedKeyBytes$.get()).toEqual(base64ToBytes('qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo='))
    expect(isEncryptionReadyForSync$.get()).toBe(true)
    expect(encryptionSetup$.error.get()).toBeNull()
  })

  it('retryFetchManagedKey clears stale cached bytes so getManagedKeyBytes actually hits Supabase', async () => {
    store$.session.userId.set('user-1')
    // Pre-seed stale cache — without the null-reset, getManagedKeyBytes would return this immediately
    syncManagedKeyBytes$.set(base64ToBytes('u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s='))

    const freshKeyB64 = 'zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMw='
    mockFetchManagedEncryptionKey.mockResolvedValueOnce({
      data: freshKeyB64,
      error: null,
    })

    const result = await retryFetchManagedKey()

    expect(result).toBe(true)
    expect(mockFetchManagedEncryptionKey).toHaveBeenCalledWith('user-1')
    expect(syncManagedKeyBytes$.get()).toEqual(base64ToBytes(freshKeyB64))
  })

  it('retryFetchManagedKey returns false and updates error state on failure', async () => {
    store$.session.userId.set('user-1')
    mockFetchManagedEncryptionKey.mockResolvedValueOnce({
      data: null,
      error: { message: 'Network error', code: 'fetch_failed' },
    })

    const result = await retryFetchManagedKey()

    expect(result).toBe(false)
    expect(encryptionSetup$.error.get()).toEqual({ message: 'Network error', code: 'fetch_failed' })
    expect(isEncryptionReadyForSync$.get()).toBe(false)
    expect(store$.session.syncEnabled.get()).toBe(false)
  })

  it('retryWithE2EPassword derives local E2E key and stores it in memory without changing mode', async () => {
    store$.session.userId.set('user-1')
    encryptionSetup$.currentModeSalt.set('somesalt')
    mockUnlockE2EEncryptionOnDevice.mockResolvedValueOnce({
      error: null,
      masterKey: new Uint8Array(32).fill(7),
    })

    const result = await retryWithE2EPassword('mypassword')

    expect(result).toBe(true)
    expect(mockUnlockE2EEncryptionOnDevice).toHaveBeenCalledWith({
      userId: 'user-1',
      password: 'mypassword',
      salt: 'somesalt',
    })
    expect(encryptionSetup$.hasLocalE2EKey.get()).toBe(true)
    expect(encryptionSetup$.error.get()).toBeNull()
  })

  it('retryWithE2EPassword handles failures correctly', async () => {
    store$.session.userId.set('user-1')
    encryptionSetup$.currentModeSalt.set('somesalt')
    mockUnlockE2EEncryptionOnDevice.mockResolvedValueOnce({
      error: { message: 'Wrong password', code: 'invalid_password' },
      masterKey: null,
    })

    const result = await retryWithE2EPassword('wrongpassword')

    expect(result).toBe(false)
    expect(encryptionSetup$.error.get()).toEqual({ message: 'Wrong password', code: 'invalid_password' })
  })

  it('E2E mode pre-caches managed key for historical managed payloads', async () => {
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: {
        mode: 'e2e',
        salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
        managedKeyB64: 'u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s=',
      },
      error: null,
    })
    mockLoadMasterKey.mockResolvedValueOnce(new Uint8Array(32).fill(1))

    const mode = await loadCurrentEncryptionMode()

    expect(mode).toBe('e2e')
    expect(syncManagedKeyBytes$.get()).toEqual(base64ToBytes('u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s='))
    expect(encryptionSetup$.currentMode.get()).toBe('e2e')
    expect(isEncryptionReadyForSync$.get()).toBe(true)
  })

  it('re-enabling E2E from managed mode unlocks with existing salt instead of bootstrapping', async () => {
    encryptionSetup$.assign({
      isOpen: true,
      step: 'e2e-password',
      currentMode: 'managed',
      currentModeSalt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
      hasLocalE2EKey: false,
      hasLoadedMode: true,
    })
    mockUpsertUserEncryptionMode.mockResolvedValueOnce({
      data: { mode: 'e2e', salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=', managedKeyB64: null },
      error: null,
    })
    mockReadUserEncryptionSettings.mockResolvedValueOnce({
      data: {
        mode: 'e2e',
        salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
        managedKeyB64: null,
      },
      error: null,
    })
    mockLoadMasterKey.mockResolvedValueOnce(new Uint8Array(32).fill(7))

    const didEnable = await submitE2EPassword('password123', '')

    expect(didEnable).toBe(true)
    expect(mockUnlockE2EEncryptionOnDevice).toHaveBeenCalledWith({
      userId: 'user-1',
      password: 'password123',
      salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
    })
    expect(mockStartE2EEncryptionBootstrap).not.toHaveBeenCalled()
    expect(mockUpsertUserEncryptionMode).toHaveBeenCalledWith({ userId: 'user-1', mode: 'e2e' })
    expect(store$.session.syncEnabled.get()).toBe(true)
    expect(isEncryptionReadyForSync$.get()).toBe(true)
  })

  it('keeps sync enabled when managed mode encounters legacy E2E unlock requirement', async () => {
    store$.session.syncEnabled.set(true)
    isEncryptionReadyForSync$.set(true)
    encryptionSetup$.assign({
      currentMode: 'managed',
      currentModeSalt: 'somesalt',
      hasLoadedMode: true,
    })

    syncEncryptionError$.set({
      message: 'Encryption password required on this device before encrypted flows can sync.',
      code: 'e2e_password_required',
    })

    expect(store$.session.syncEnabled.get()).toBe(true)
    expect(isEncryptionReadyForSync$.get()).toBe(true)
    expect(encryptionSetup$.error.get()).toEqual({
      message: 'Encryption password required on this device before encrypted flows can sync.',
      code: 'e2e_password_required',
    })
  })

  describe('trust browser (web E2E key persistence)', () => {
    it('shows trust browser prompt after E2E submit when web trust is available', async () => {
      mockHasWebTrustCapability.mockReturnValue(true)
      await requestSyncEnable()
      await confirmEncryptionModeSelection()
      mockReadUserEncryptionSettings.mockResolvedValueOnce({
        data: {
          mode: 'e2e',
          salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
          managedKeyB64: null,
        },
        error: null,
      })
      mockLoadMasterKey.mockResolvedValueOnce(new Uint8Array(32).fill(1))

      const didEnable = await submitE2EPassword('password123', 'password123')

      expect(didEnable).toBe(true)
      expect(trustBrowserPrompt$.isVisible.get()).toBe(true)
      expect(keyringPrompt$.isVisible.get()).toBe(false)
    })

    it('does not show trust browser prompt when web trust is unavailable', async () => {
      mockHasWebTrustCapability.mockReturnValue(false)
      await requestSyncEnable()
      await confirmEncryptionModeSelection()
      mockReadUserEncryptionSettings.mockResolvedValueOnce({
        data: {
          mode: 'e2e',
          salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
          managedKeyB64: null,
        },
        error: null,
      })
      mockLoadMasterKey.mockResolvedValueOnce(new Uint8Array(32).fill(1))

      await submitE2EPassword('password123', 'password123')

      expect(trustBrowserPrompt$.isVisible.get()).toBe(false)
      expect(keyringPrompt$.isVisible.get()).toBe(false)
    })

    it('acceptBrowserTrust wraps key, registers server-side, and reports success', async () => {
      // Set up trust state by triggering the prompt
      mockHasWebTrustCapability.mockReturnValue(true)
      await requestSyncEnable()
      await confirmEncryptionModeSelection()
      mockReadUserEncryptionSettings.mockResolvedValueOnce({
        data: {
          mode: 'e2e',
          salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
          managedKeyB64: null,
        },
        error: null,
      })
      mockLoadMasterKey.mockResolvedValueOnce(new Uint8Array(32).fill(1))
      await submitE2EPassword('password123', 'password123')

      expect(trustBrowserPrompt$.isVisible.get()).toBe(true)

      await acceptBrowserTrust()

      expect(mockWrapAndStoreKey).toHaveBeenCalled()
      expect(mockHashDeviceToken).toHaveBeenCalledWith('test-token')
      expect(mockGetBrowserLabel).toHaveBeenCalled()
      expect(mockRegisterTrustedBrowser).toHaveBeenCalledWith('user-1', 'hashed-token', 'Chrome 124 on macOS')
      expect(trustBrowserPrompt$.isVisible.get()).toBe(false)
      expect(trustBrowserResult$.success.get()).toBe(true)
      expect(trustBrowserResult$.persistGranted.get()).toBe(true)
    })

    it('acceptBrowserTrust rolls back IndexedDB on server failure', async () => {
      mockHasWebTrustCapability.mockReturnValue(true)
      mockRegisterTrustedBrowser.mockResolvedValueOnce({
        error: { message: 'Server error', code: 'server_error' },
      })
      await requestSyncEnable()
      await confirmEncryptionModeSelection()
      mockReadUserEncryptionSettings.mockResolvedValueOnce({
        data: {
          mode: 'e2e',
          salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
          managedKeyB64: null,
        },
        error: null,
      })
      mockLoadMasterKey.mockResolvedValueOnce(new Uint8Array(32).fill(1))
      await submitE2EPassword('password123', 'password123')

      await acceptBrowserTrust()

      expect(mockClearWebTrustData).toHaveBeenCalledWith('user-1')
      expect(trustBrowserPrompt$.trustError.get()).toEqual({
        message: 'Server error',
        code: 'server_error',
      })
    })

    it('acceptBrowserTrust treats timeout as success when verify confirms row exists', async () => {
      mockHasWebTrustCapability.mockReturnValue(true)
      mockRegisterTrustedBrowser.mockResolvedValueOnce({
        error: { message: 'Failed to fetch', code: 'timeout' },
      })
      mockVerifyTrustedBrowser.mockResolvedValueOnce({ status: 'valid', id: 'browser-1' })

      await requestSyncEnable()
      await confirmEncryptionModeSelection()
      mockReadUserEncryptionSettings.mockResolvedValueOnce({
        data: {
          mode: 'e2e',
          salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
          managedKeyB64: null,
        },
        error: null,
      })
      mockLoadMasterKey.mockResolvedValueOnce(new Uint8Array(32).fill(1))
      await submitE2EPassword('password123', 'password123')

      await acceptBrowserTrust()

      expect(mockClearWebTrustData).not.toHaveBeenCalled()
      expect(trustBrowserPrompt$.isVisible.get()).toBe(false)
      expect(trustBrowserResult$.success.get()).toBe(true)
    })

    it('declineBrowserTrust hides prompt without storing key', () => {
      trustBrowserPrompt$.isVisible.set(true)

      declineBrowserTrust()

      expect(trustBrowserPrompt$.isVisible.get()).toBe(false)
      expect(mockWrapAndStoreKey).not.toHaveBeenCalled()
    })

    it('dismissTrustBrowserPrompt clears error state', () => {
      trustBrowserPrompt$.isVisible.set(true)
      trustBrowserPrompt$.trustError.set({ message: 'Some error', code: 'err' })

      dismissTrustBrowserPrompt()

      expect(trustBrowserPrompt$.isVisible.get()).toBe(false)
      expect(trustBrowserPrompt$.trustError.get()).toBeNull()
    })

    it('web trust return visit: caches key when verification succeeds', async () => {
      mockHasWebTrustCapability.mockReturnValue(true)
      mockGetStoredDeviceToken.mockResolvedValueOnce('stored-token')
      mockLoadWrappedKey.mockResolvedValueOnce({
        masterKey: new Uint8Array(32).fill(5),
        deviceToken: 'stored-token',
      })
      mockHashDeviceToken.mockResolvedValueOnce('hashed-stored-token')
      mockVerifyTrustedBrowser.mockResolvedValueOnce({ status: 'valid', id: 'browser-1' })

      mockReadUserEncryptionSettings.mockResolvedValueOnce({
        data: {
          mode: 'e2e',
          salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
          managedKeyB64: null,
        },
        error: null,
      })

      const mode = await loadCurrentEncryptionMode()

      expect(mode).toBe('e2e')
      expect(encryptionSetup$.hasLocalE2EKey.get()).toBe(true)
      expect(isEncryptionReadyForSync$.get()).toBe(true)
      expect(mockUpdateTrustedBrowserLastUsed).toHaveBeenCalledWith('browser-1')
    })

    it('web trust return visit: clears trust data when token is revoked', async () => {
      mockHasWebTrustCapability.mockReturnValue(true)
      mockGetStoredDeviceToken.mockResolvedValueOnce('stored-token')
      mockLoadWrappedKey.mockResolvedValueOnce({
        masterKey: new Uint8Array(32).fill(5),
        deviceToken: 'stored-token',
      })
      mockHashDeviceToken.mockResolvedValueOnce('hashed-stored-token')
      mockVerifyTrustedBrowser.mockResolvedValueOnce({ status: 'revoked' })

      mockReadUserEncryptionSettings.mockResolvedValueOnce({
        data: {
          mode: 'e2e',
          salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
          managedKeyB64: null,
        },
        error: null,
      })

      const mode = await loadCurrentEncryptionMode()

      expect(mode).toBe('e2e')
      expect(encryptionSetup$.hasLocalE2EKey.get()).toBe(false)
      expect(mockClearWebTrustData).toHaveBeenCalledWith('user-1')
    })

    it('web trust return visit: preserves trust data on network error (AC 12)', async () => {
      mockHasWebTrustCapability.mockReturnValue(true)
      mockGetStoredDeviceToken.mockResolvedValueOnce('stored-token')
      mockLoadWrappedKey.mockResolvedValueOnce({
        masterKey: new Uint8Array(32).fill(5),
        deviceToken: 'stored-token',
      })
      mockHashDeviceToken.mockResolvedValueOnce('hashed-stored-token')
      // Both initial and retry return network_error
      mockVerifyTrustedBrowser
        .mockResolvedValueOnce({ status: 'network_error' })
        .mockResolvedValueOnce({ status: 'network_error' })

      mockReadUserEncryptionSettings.mockResolvedValueOnce({
        data: {
          mode: 'e2e',
          salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
          managedKeyB64: null,
        },
        error: null,
      })

      const mode = await loadCurrentEncryptionMode()

      expect(mode).toBe('e2e')
      expect(encryptionSetup$.hasLocalE2EKey.get()).toBe(false)
      // CRITICAL: trust data must NOT be cleared on network error
      expect(mockClearWebTrustData).not.toHaveBeenCalled()
    })

    it('web trust return visit: retries once on network error, succeeds on retry', async () => {
      mockHasWebTrustCapability.mockReturnValue(true)
      mockGetStoredDeviceToken.mockResolvedValueOnce('stored-token')
      mockLoadWrappedKey.mockResolvedValueOnce({
        masterKey: new Uint8Array(32).fill(5),
        deviceToken: 'stored-token',
      })
      mockHashDeviceToken.mockResolvedValueOnce('hashed-stored-token')
      // First call: network error, second call: valid
      mockVerifyTrustedBrowser
        .mockResolvedValueOnce({ status: 'network_error' })
        .mockResolvedValueOnce({ status: 'valid', id: 'browser-1' })

      mockReadUserEncryptionSettings.mockResolvedValueOnce({
        data: {
          mode: 'e2e',
          salt: 'V7Ywzw624E8kIp99sTidT8QPg/qet/T85LJgX4wvht8=',
          managedKeyB64: null,
        },
        error: null,
      })

      const mode = await loadCurrentEncryptionMode()

      expect(mode).toBe('e2e')
      expect(encryptionSetup$.hasLocalE2EKey.get()).toBe(true)
      expect(mockVerifyTrustedBrowser).toHaveBeenCalledTimes(2)
    })
  })
})
