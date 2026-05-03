import { batch, observable, observe } from '@legendapp/state'
import type { EncryptionMode } from '../types/index'
import { store$ } from './store'
import { clearStoredMasterKey, hasPlatformKeyring, loadMasterKey, cacheOnlyMasterKey } from '../utils/encryptionKeyStore'
import {
  readUserEncryptionSettings,
  unlockE2EEncryptionOnDevice,
  startE2EEncryptionBootstrap,
  upsertUserEncryptionMode,
  validateE2EMasterKeyForUser,
  persistMasterKeyToKeyring,
  bootstrapManagedEncryption,
  registerTrustedBrowser,
  verifyTrustedBrowser,
  updateTrustedBrowserLastUsed,
  type TrustedBrowserVerification,
} from '../utils/userEncryption'
import {
  hasWebTrustCapability,
  wrapAndStoreKey,
  loadWrappedKey,
  getStoredDeviceToken,
  hashDeviceToken,
  getBrowserLabel,
  clearWebTrustData,
} from '../utils/webKeyStore'
import { syncEncryptionError$, syncEncryptionMode$, syncManagedKeyBytes$, getManagedKeyBytes, supabase, dbFlowToLocal } from './syncConfig'
import { flows$ } from './flows'
import { base64ToBytes } from '../utils/encryption'

export type EncryptionSetupStep = 'choice' | 'e2e-password' | 'legacy-e2e-password' | 'saving' | 'trust-browser'

export interface EncryptionSetupError {
  message: string
  code: string
}

const DEFAULT_MODE: EncryptionMode = 'e2e'
const E2E_SALT_REQUIRED_ERROR: EncryptionSetupError = {
  message: 'End-to-end encryption setup is incomplete for this account. Please finish setup again.',
  code: 'e2e_salt_missing',
}
const E2E_PASSWORD_REQUIRED_ERROR: EncryptionSetupError = {
  message: 'Encryption password required on this device before Cloud Sync can be enabled.',
  code: 'e2e_password_required',
}

const toEncryptionSetupError = (
  error: unknown,
  fallbackMessage: string,
  fallbackCode: string
): EncryptionSetupError => {
  if (error && typeof error === 'object') {
    const message = 'message' in error && typeof error.message === 'string' ? error.message : null
    const code = 'code' in error && typeof error.code === 'string' ? error.code : null

    if (message || code) {
      return {
        message: message ?? fallbackMessage,
        code: code ?? fallbackCode,
      }
    }
  }

  return {
    message: fallbackMessage,
    code: fallbackCode,
  }
}

const getSyncEligibility = (
  mode: EncryptionMode | null,
  salt: string | null,
  hasLocalE2EKey: boolean
): {
  canEnableSync: boolean
  blockingError: EncryptionSetupError | null
} => {
  if (mode === 'managed') {
    return { canEnableSync: true, blockingError: null }
  }

  if (mode !== 'e2e') {
    return { canEnableSync: false, blockingError: null }
  }

  if (!salt) {
    return { canEnableSync: false, blockingError: E2E_SALT_REQUIRED_ERROR }
  }

  if (!hasLocalE2EKey) {
    return { canEnableSync: false, blockingError: E2E_PASSWORD_REQUIRED_ERROR }
  }

  return { canEnableSync: true, blockingError: null }
}

let loadCurrentEncryptionModePromise: Promise<EncryptionMode | null> | null = null

export const isEncryptionReadyForSync$ = observable(false)

export const encryptionSetup$ = observable({
  isOpen: false,
  selectedMode: null as EncryptionMode | null,
  step: 'choice' as EncryptionSetupStep,
  isModeLocked: false,
  error: null as EncryptionSetupError | null,
  currentMode: null as EncryptionMode | null,
  currentModeSalt: null as string | null,
  hasLocalE2EKey: false,
  hasLoadedMode: false,
  isLoadingMode: false,
})

export const keyringPrompt$ = observable({
  isVisible: false,
  isPersisting: false,
  persistError: null as EncryptionSetupError | null,
})

/** Observable for components to react to keyring persist outcomes (toast trigger). */
export const keyringPersistResult$ = observable({
  success: false,
  error: null as EncryptionSetupError | null,
})

/** Pending master key for Phase 2 keyring persistence (never observable/persisted). */
let pendingKeyringMasterKey: Uint8Array | null = null
let pendingKeyringUserId: string | null = null

// Trust Browser (web E2E key persistence) observables
export const trustBrowserPrompt$ = observable({
  isVisible: false,
  isTrusting: false,
  trustError: null as EncryptionSetupError | null,
})

export const trustBrowserResult$ = observable({
  success: false,
  persistGranted: false,
  error: null as EncryptionSetupError | null,
})

let pendingTrustMasterKey: Uint8Array | null = null
let pendingTrustUserId: string | null = null

const setManagedKeyBytesFromB64 = (keyB64: string | null) => {
  syncManagedKeyBytes$.set(keyB64 ? base64ToBytes(keyB64) : null)
}

const resetDialogState = () => {
  batch(() => {
    encryptionSetup$.isOpen.set(false)
    encryptionSetup$.selectedMode.set(DEFAULT_MODE)
    encryptionSetup$.step.set('choice')
    encryptionSetup$.isModeLocked.set(false)
  })
}

const applyLoadedSettings = (
  mode: EncryptionMode | null,
  salt: string | null,
  hasLocalE2EKey: boolean
) => {
  const eligibility = getSyncEligibility(mode, salt, hasLocalE2EKey)

  batch(() => {
    syncEncryptionMode$.set(mode)
    encryptionSetup$.currentMode.set(mode)
    encryptionSetup$.currentModeSalt.set(salt)
    encryptionSetup$.hasLocalE2EKey.set(hasLocalE2EKey)
    encryptionSetup$.hasLoadedMode.set(true)
    isEncryptionReadyForSync$.set(eligibility.canEnableSync)
    encryptionSetup$.error.set(eligibility.blockingError)

    if (!eligibility.canEnableSync) {
      store$.session.syncEnabled.set(false)
    }
  })
}

const isTimeoutOrNetworkError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
  return (
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('Failed to fetch') ||
    message.includes('NetworkError')
  )
}

const resolveLocalE2EKeyAvailability = async (
  userId: string,
  mode: EncryptionMode | null,
  salt: string | null
) : Promise<{ hasLocalE2EKey: boolean; error: EncryptionSetupError | null }> => {
  if (mode !== 'e2e' || !salt) {
    return { hasLocalE2EKey: false, error: null }
  }

  // First try platform keyring / in-memory cache
  const key = await loadMasterKey(userId)
  if (key) {
    const validation = await validateE2EMasterKeyForUser({
      masterKey: key,
      invalidKeyMessage:
        'The stored encryption key on this device could not unlock your journal. Enter your encryption password again.',
      invalidKeyCode: 'invalid_local_encryption_key',
    })

    if (!validation.error) {
      return { hasLocalE2EKey: true, error: null }
    }

    if (validation.error.code === 'invalid_local_encryption_key') {
      await clearStoredMasterKey(userId)
    }

    return {
      hasLocalE2EKey: false,
      error: validation.error,
    }
  }

  // Web trust return-visit: try IndexedDB-wrapped key with server verification
  if (hasWebTrustCapability()) {
    const webTrustResult = await resolveWebTrustKey(userId)
    if (webTrustResult) return webTrustResult
  }

  return { hasLocalE2EKey: false, error: null }
}

/**
 * Web trust return-visit flow:
 * 1. Attempt local unwrap first (proves KEK is present in this browser)
 * 2. Hash token and verify server-side (proves not revoked)
 * 3. Cache key in memory on success
 */
const resolveWebTrustKey = async (
  userId: string
): Promise<{ hasLocalE2EKey: boolean; error: EncryptionSetupError | null } | null> => {
  // Step 1: Check for stored device token (presence check without unwrap)
  const storedToken = await getStoredDeviceToken(userId)
  if (!storedToken) return null

  // Step 2: Attempt local unwrap first
  const unwrapResult = await loadWrappedKey(userId)
  if (!unwrapResult) {
    // Missing, schema mismatch, or tampered — fall back to password re-entry
    return null
  }

  // Step 3: Hash the token and verify server-side
  let hashedToken: string
  try {
    hashedToken = await hashDeviceToken(storedToken)
  } catch {
    return null
  }

  // Verify with retry-once on network error
  let verification: TrustedBrowserVerification = await verifyTrustedBrowser(userId, hashedToken)

  if (verification.status === 'network_error') {
    // Retry once
    verification = await verifyTrustedBrowser(userId, hashedToken)
  }

  if (verification.status === 'network_error') {
    // Network error after retry: discard unwrapped key, DON'T clear trust data (AC 12)
    return { hasLocalE2EKey: false, error: null }
  }

  if (verification.status === 'revoked') {
    // Token revoked: clear local trust data
    await clearWebTrustData(userId)
    return { hasLocalE2EKey: false, error: null }
  }

  // Valid: cache key in memory
  cacheOnlyMasterKey(userId, unwrapResult.masterKey)

  // Update last_used_at (fire-and-forget)
  void updateTrustedBrowserLastUsed(verification.id)

  return { hasLocalE2EKey: true, error: null }
}

export const resetEncryptionSetupState = () => {
  batch(() => {
    resetDialogState()
    syncEncryptionMode$.set(null)
    syncEncryptionError$.set(null)
    encryptionSetup$.error.set(null)
    encryptionSetup$.currentMode.set(null)
    encryptionSetup$.currentModeSalt.set(null)
    encryptionSetup$.hasLocalE2EKey.set(false)
    encryptionSetup$.hasLoadedMode.set(false)
    encryptionSetup$.isLoadingMode.set(false)
    isEncryptionReadyForSync$.set(false)
    keyringPrompt$.isVisible.set(false)
    keyringPrompt$.isPersisting.set(false)
    keyringPrompt$.persistError.set(null)
    keyringPersistResult$.success.set(false)
    keyringPersistResult$.error.set(null)
    trustBrowserPrompt$.isVisible.set(false)
    trustBrowserPrompt$.isTrusting.set(false)
    trustBrowserPrompt$.trustError.set(null)
    trustBrowserResult$.success.set(false)
    trustBrowserResult$.persistGranted.set(false)
    trustBrowserResult$.error.set(null)
    loadCurrentEncryptionModePromise = null
    pendingKeyringMasterKey = null
    pendingKeyringUserId = null
    pendingTrustMasterKey = null
    pendingTrustUserId = null
    setManagedKeyBytesFromB64(null)
  })
}

export const clearEncryptionSetupError = () => {
  batch(() => {
    encryptionSetup$.error.set(null)
    syncEncryptionError$.set(null)
  })
}

export const setSelectedEncryptionMode = (mode: EncryptionMode) => {
  batch(() => {
    encryptionSetup$.selectedMode.set(mode)
    encryptionSetup$.error.set(null)
  })
}

export const loadCurrentEncryptionMode = async (): Promise<EncryptionMode | null> => {
  const userId = store$.session.userId.get()

  if (!userId) {
    resetEncryptionSetupState()
    return null
  }

  if (loadCurrentEncryptionModePromise) {
    return loadCurrentEncryptionModePromise
  }

  encryptionSetup$.isLoadingMode.set(true)

  loadCurrentEncryptionModePromise = (async () => {
    try {
      const result = await readUserEncryptionSettings(userId)

      if (result.error) {
        batch(() => {
          encryptionSetup$.error.set(result.error)
          encryptionSetup$.hasLoadedMode.set(false)
          encryptionSetup$.currentMode.set(null)
          encryptionSetup$.currentModeSalt.set(null)
          isEncryptionReadyForSync$.set(false)
          store$.session.syncEnabled.set(false)
        })
        return null
      }

      // Pre-cache managed key from the initial query when available.
      // This eliminates a second round-trip and ensures both managed-mode
      // and E2E-mode users can decrypt historical managed payloads.
      const rawManagedKeyB64 = result.data.managedKeyB64
      if (rawManagedKeyB64 && rawManagedKeyB64.length === 44) {
        try {
          setManagedKeyBytesFromB64(rawManagedKeyB64)
        } catch {
          // Invalid key format — getManagedKeyBytes will re-fetch as fallback
        }
      }

      // Managed mode: ensure the managed key is available before sync opens
      if (result.data.mode === 'managed') {
        const keyResult = await getManagedKeyBytes(userId)
        if (keyResult.error) {
          batch(() => {
            encryptionSetup$.error.set(keyResult.error)
            encryptionSetup$.hasLoadedMode.set(true)
            encryptionSetup$.currentMode.set('managed')
            isEncryptionReadyForSync$.set(false)
            store$.session.syncEnabled.set(false)
          })
          syncEncryptionMode$.set('managed')
          return 'managed'
        }

        // C1: Also check for E2E local key availability so historical E2E
        // encrypted flows can still be decrypted even in managed mode.
        const salt = result.data.salt
        if (salt) {
          try {
            const localKeyState = await resolveLocalE2EKeyAvailability(userId, 'e2e', salt)
            applyLoadedSettings('managed', salt, localKeyState.hasLocalE2EKey)
          } catch {
            applyLoadedSettings('managed', salt, false)
          }
        } else {
          applyLoadedSettings('managed', null, false)
        }
        return 'managed'
      }

      // E2E mode: resolve local key availability
      try {
        const localKeyState = await resolveLocalE2EKeyAvailability(
          userId,
          result.data.mode,
          result.data.salt
        )
        applyLoadedSettings(result.data.mode, result.data.salt, localKeyState.hasLocalE2EKey)
        if (localKeyState.error) {
          encryptionSetup$.error.set(localKeyState.error)
        }
      } catch (error) {
        applyLoadedSettings(result.data.mode, result.data.salt, false)
        encryptionSetup$.error.set(
          toEncryptionSetupError(
            error,
            'Failed to access secure key storage on this device. Cloud Sync remains off.',
            'local_key_store_unavailable'
          )
        )
      }
      return result.data.mode
    } finally {
      encryptionSetup$.isLoadingMode.set(false)
      loadCurrentEncryptionModePromise = null
    }
  })()

  return loadCurrentEncryptionModePromise
}

const openEncryptionSetup = () => {
  batch(() => {
    encryptionSetup$.isOpen.set(true)
    encryptionSetup$.selectedMode.set(DEFAULT_MODE)
    encryptionSetup$.step.set('choice')
    encryptionSetup$.isModeLocked.set(false)
    encryptionSetup$.error.set(null)
  })
}

export const continueLockedE2ESetup = () => {
  batch(() => {
    encryptionSetup$.isOpen.set(true)
    encryptionSetup$.selectedMode.set('e2e')
    encryptionSetup$.step.set('e2e-password')
    encryptionSetup$.isModeLocked.set(true)
    encryptionSetup$.error.set(null)
  })
}

export const openLegacyE2EUnlock = () => {
  batch(() => {
    encryptionSetup$.isOpen.set(true)
    encryptionSetup$.selectedMode.set('e2e')
    encryptionSetup$.step.set('legacy-e2e-password')
    encryptionSetup$.isModeLocked.set(true)
    encryptionSetup$.error.set(null)
  })
}

export const cancelEncryptionSetup = () => {
  batch(() => {
    store$.session.syncEnabled.set(false)
    encryptionSetup$.error.set(null)
    resetDialogState()
  })
}

export const returnToEncryptionChoice = () => {
  if (encryptionSetup$.isModeLocked.get()) {
    cancelEncryptionSetup()
    return
  }

  batch(() => {
    encryptionSetup$.step.set('choice')
    encryptionSetup$.error.set(null)
  })
}

export const requestSyncEnable = async (): Promise<boolean> => {
  clearEncryptionSetupError()

  if (!encryptionSetup$.hasLoadedMode.get()) {
    await loadCurrentEncryptionMode()
  }

  const currentMode = encryptionSetup$.currentMode.get()
  const salt = encryptionSetup$.currentModeSalt.get()
  const hasLocalE2EKey = encryptionSetup$.hasLocalE2EKey.get()

  if (!currentMode) {
    store$.session.syncEnabled.set(false)
    openEncryptionSetup()
    return false
  }

  const eligibility = getSyncEligibility(currentMode, salt, hasLocalE2EKey)

  if (eligibility.canEnableSync) {
    store$.session.syncEnabled.set(true)
    return true
  }

  batch(() => {
    store$.session.syncEnabled.set(false)
    encryptionSetup$.error.set(eligibility.blockingError)
  })
  return false
}

const persistEncryptionMode = async (mode: EncryptionMode): Promise<boolean> => {
  const userId = store$.session.userId.get()

  if (!userId) {
    encryptionSetup$.error.set({
      message: 'You must be signed in before Cloud Sync can be configured.',
      code: 'missing_user',
    })
    return false
  }

  encryptionSetup$.step.set('saving')
  const result = await upsertUserEncryptionMode({ userId, mode })

  if (result.error) {
    batch(() => {
      encryptionSetup$.error.set(result.error)
      encryptionSetup$.step.set(mode === 'e2e' ? 'e2e-password' : 'choice')
      store$.session.syncEnabled.set(false)
    })
    return false
  }

  applyLoadedSettings(result.data.mode, result.data.salt, false)
  return true
}

export const confirmEncryptionModeSelection = async (): Promise<boolean> => {
  encryptionSetup$.error.set(null)

  if (encryptionSetup$.selectedMode.get() === 'e2e') {
    encryptionSetup$.step.set('e2e-password')
    return false
  }

  // Managed mode: persist mode, then generate + store the managed key
  const userId = store$.session.userId.get()
  if (!userId) {
    encryptionSetup$.error.set({
      message: 'You must be signed in before Cloud Sync can be configured.',
      code: 'missing_user',
    })
    return false
  }

  encryptionSetup$.step.set('saving')

  const bootstrapResult = await bootstrapManagedEncryption({ userId })

  if (bootstrapResult.error) {
    batch(() => {
      encryptionSetup$.error.set(bootstrapResult.error)
      encryptionSetup$.step.set('choice')
      store$.session.syncEnabled.set(false)
    })
    return false
  }

  setManagedKeyBytesFromB64(bootstrapResult.managedKeyB64)

  applyLoadedSettings('managed', null, false)

  batch(() => {
    resetDialogState()
    encryptionSetup$.error.set(null)
    store$.session.syncEnabled.set(true)
  })
  return true
}

export const submitE2EPassword = async (
  password: string,
  confirmPassword: string
): Promise<boolean> => {
  const normalizedPassword = password.trim()
  const normalizedConfirmPassword = confirmPassword.trim()
  const currentMode = encryptionSetup$.currentMode.get()
  const currentModeSalt = encryptionSetup$.currentModeSalt.get()
  const isUnlockingExistingE2E = !!currentModeSalt

  if (!normalizedPassword) {
    encryptionSetup$.error.set({
      message: 'Encryption password is required.',
      code: 'missing_password',
    })
    return false
  }

  if (normalizedPassword.length < 8) {
    encryptionSetup$.error.set({
      message: 'Encryption password must be at least 8 characters.',
      code: 'weak_password',
    })
    return false
  }

  if (!isUnlockingExistingE2E && normalizedPassword !== normalizedConfirmPassword) {
    encryptionSetup$.error.set({
      message: 'Encryption passwords do not match.',
      code: 'password_mismatch',
    })
    return false
  }

  const userId = store$.session.userId.get()
  if (!userId) {
    encryptionSetup$.error.set({
      message: 'You must be signed in before Cloud Sync can be configured.',
      code: 'missing_user',
    })
    return false
  }

  encryptionSetup$.error.set(null)
  syncEncryptionError$.set(null)

  encryptionSetup$.step.set('saving')

  const bootstrapResult =
    isUnlockingExistingE2E
      ? await unlockE2EEncryptionOnDevice({
          userId,
          password: normalizedPassword,
          salt: currentModeSalt,
        })
      : await startE2EEncryptionBootstrap({
          userId,
          password: normalizedPassword,
        })

  if (bootstrapResult.error) {
    batch(() => {
      encryptionSetup$.step.set('e2e-password')
      encryptionSetup$.error.set(bootstrapResult.error)
      store$.session.syncEnabled.set(false)
    })
    return false
  }

  if (isUnlockingExistingE2E && currentMode !== 'e2e') {
    const modeResult = await upsertUserEncryptionMode({ userId, mode: 'e2e' })
    if (modeResult.error) {
      batch(() => {
        encryptionSetup$.step.set('e2e-password')
        encryptionSetup$.error.set(modeResult.error)
        store$.session.syncEnabled.set(false)
      })
      return false
    }
  }

  await loadCurrentEncryptionMode()

  const eligibility = getSyncEligibility(
    encryptionSetup$.currentMode.get(),
    encryptionSetup$.currentModeSalt.get(),
    encryptionSetup$.hasLocalE2EKey.get()
  )

  if (!eligibility.canEnableSync) {
    batch(() => {
      encryptionSetup$.step.set('e2e-password')
      encryptionSetup$.error.set(eligibility.blockingError)
      store$.session.syncEnabled.set(false)
    })
    return false
  }

  // Phase 2: offer keyring/browser trust persistence
  if (bootstrapResult.masterKey) {
    const hasKeyring = await hasPlatformKeyring()
    if (hasKeyring) {
      // Native: close dialog, show inline keyring prompt
      batch(() => {
        resetDialogState()
        encryptionSetup$.error.set(null)
        store$.session.syncEnabled.set(true)
        isEncryptionReadyForSync$.set(true)
      })
      pendingKeyringMasterKey = bootstrapResult.masterKey
      pendingKeyringUserId = userId
      keyringPrompt$.isVisible.set(true)
    } else if (hasWebTrustCapability()) {
      // Web: keep dialog open, transition to trust-browser step
      pendingTrustMasterKey = bootstrapResult.masterKey
      pendingTrustUserId = userId
      batch(() => {
        encryptionSetup$.step.set('trust-browser')
        encryptionSetup$.error.set(null)
        store$.session.syncEnabled.set(true)
        isEncryptionReadyForSync$.set(true)
        trustBrowserPrompt$.isVisible.set(true)
      })
    } else {
      batch(() => {
        resetDialogState()
        encryptionSetup$.error.set(null)
        store$.session.syncEnabled.set(true)
        isEncryptionReadyForSync$.set(true)
      })
    }
  } else {
    batch(() => {
      resetDialogState()
      encryptionSetup$.error.set(null)
      store$.session.syncEnabled.set(true)
      isEncryptionReadyForSync$.set(true)
    })
  }

  return true
}

observe(() => {
  const runtimeError = syncEncryptionError$.get()
  if (!runtimeError) return

  batch(() => {
    const currentMode = encryptionSetup$.currentMode.get()
    const allowManagedLegacyE2E =
      currentMode === 'managed' && runtimeError.code === 'e2e_password_required'
    if (!allowManagedLegacyE2E) {
      store$.session.syncEnabled.set(false)
      isEncryptionReadyForSync$.set(false)
    }
    encryptionSetup$.error.set(runtimeError)
  })
})

/**
 * Phase 2: User accepted keyring persistence — runs the keyring write in the
 * background and updates `keyringPersistResult$` so UI can react (toast).
 */
export const acceptKeyringPersistence = async (): Promise<void> => {
  if (!pendingKeyringMasterKey || !pendingKeyringUserId) {
    keyringPrompt$.isVisible.set(false)
    return
  }

  batch(() => {
    keyringPrompt$.isPersisting.set(true)
    keyringPrompt$.persistError.set(null)
    keyringPersistResult$.success.set(false)
    keyringPersistResult$.error.set(null)
  })

  const result = await persistMasterKeyToKeyring({
    userId: pendingKeyringUserId,
    masterKey: pendingKeyringMasterKey,
  })

  pendingKeyringMasterKey = null
  pendingKeyringUserId = null

  if (result.error) {
    batch(() => {
      keyringPrompt$.isPersisting.set(false)
      keyringPrompt$.persistError.set(result.error)
      keyringPersistResult$.error.set(result.error)
    })
    return
  }

  batch(() => {
    keyringPrompt$.isVisible.set(false)
    keyringPrompt$.isPersisting.set(false)
    keyringPrompt$.persistError.set(null)
    keyringPersistResult$.success.set(true)
  })
}

/** User declined keyring persistence — key remains in memory only for this session. */
export const declineKeyringPersistence = (): void => {
  pendingKeyringMasterKey = null
  pendingKeyringUserId = null
  batch(() => {
    keyringPrompt$.isVisible.set(false)
    keyringPrompt$.isPersisting.set(false)
    keyringPrompt$.persistError.set(null)
  })
}

/** Dismiss a keyring persistence error — hides the prompt. */
export const dismissKeyringPrompt = (): void => {
  pendingKeyringMasterKey = null
  pendingKeyringUserId = null
  batch(() => {
    keyringPrompt$.isVisible.set(false)
    keyringPrompt$.isPersisting.set(false)
    keyringPrompt$.persistError.set(null)
  })
}

// =================================================================
// TRUST BROWSER (Web E2E Key Persistence)
// =================================================================

/**
 * User accepted browser trust — atomic dual-write flow:
 * 1. IndexedDB first, then server registration, with rollback on failure.
 */
export const acceptBrowserTrust = async (): Promise<void> => {
  const wasInDialog = encryptionSetup$.step.get() === 'trust-browser'

  if (!pendingTrustMasterKey || !pendingTrustUserId) {
    trustBrowserPrompt$.isVisible.set(false)
    if (wasInDialog) resetDialogState()
    return
  }

  const masterKey = pendingTrustMasterKey
  const userId = pendingTrustUserId
  batch(() => {
    trustBrowserPrompt$.isTrusting.set(true)
    trustBrowserPrompt$.trustError.set(null)
    trustBrowserResult$.success.set(false)
    trustBrowserResult$.error.set(null)
  })

  try {
    // Step 1: Write to IndexedDB
    const { deviceToken, persistGranted } = await wrapAndStoreKey(userId, masterKey)

    // Step 2: Hash token for server-side storage
    const hashedToken = await hashDeviceToken(deviceToken)

    // Step 3: Derive browser label
    const label = getBrowserLabel()

    // Step 4: Register server-side
    const registerResult = await registerTrustedBrowser(userId, hashedToken, label)

    if (registerResult.error) {
      // Step 5: Handle server failure
      if (isTimeoutOrNetworkError(registerResult.error)) {
        // Lost-response edge case: check if server row was actually created
        const verification = await verifyTrustedBrowser(userId, hashedToken)
        if (verification.status === 'valid') {
          // Server row exists — treat as success
          pendingTrustMasterKey = null
          pendingTrustUserId = null
          batch(() => {
            trustBrowserPrompt$.isVisible.set(false)
            trustBrowserPrompt$.isTrusting.set(false)
            trustBrowserPrompt$.trustError.set(null)
            trustBrowserResult$.success.set(true)
            trustBrowserResult$.persistGranted.set(persistGranted)
            if (wasInDialog) resetDialogState()
          })
          return
        }
      }

      // Rollback: clear IndexedDB entry
      try {
        await clearWebTrustData(userId)
      } catch {
        // Retry rollback once
        try {
          await clearWebTrustData(userId)
        } catch {
          // Orphaned IndexedDB entry is harmless — will self-heal on next visit
        }
      }

      batch(() => {
        trustBrowserPrompt$.isTrusting.set(false)
        trustBrowserPrompt$.trustError.set(registerResult.error)
        trustBrowserResult$.error.set(registerResult.error)
      })
      return
    }

    // Full success
    pendingTrustMasterKey = null
    pendingTrustUserId = null
    batch(() => {
      trustBrowserPrompt$.isVisible.set(false)
      trustBrowserPrompt$.isTrusting.set(false)
      trustBrowserPrompt$.trustError.set(null)
      trustBrowserResult$.success.set(true)
      trustBrowserResult$.persistGranted.set(persistGranted)
      if (wasInDialog) resetDialogState()
    })
  } catch (error) {
    const setupError = toEncryptionSetupError(
      error,
      'Failed to trust this browser.',
      'trust_browser_failed'
    )

    batch(() => {
      trustBrowserPrompt$.isTrusting.set(false)
      trustBrowserPrompt$.trustError.set(setupError)
      trustBrowserResult$.error.set(setupError)
    })
  }
}

/** User declined browser trust — key remains in memory only. */
export const declineBrowserTrust = (): void => {
  const wasInDialog = encryptionSetup$.step.get() === 'trust-browser'
  pendingTrustMasterKey = null
  pendingTrustUserId = null
  batch(() => {
    trustBrowserPrompt$.isVisible.set(false)
    trustBrowserPrompt$.isTrusting.set(false)
    trustBrowserPrompt$.trustError.set(null)
    if (wasInDialog) resetDialogState()
  })
}

/** Dismiss a trust browser error — hides the prompt. */
export const dismissTrustBrowserPrompt = (): void => {
  const wasInDialog = encryptionSetup$.step.get() === 'trust-browser'
  pendingTrustMasterKey = null
  pendingTrustUserId = null
  batch(() => {
    trustBrowserPrompt$.isVisible.set(false)
    trustBrowserPrompt$.isTrusting.set(false)
    trustBrowserPrompt$.trustError.set(null)
    if (wasInDialog) resetDialogState()
  })
}

/**
 * M1 (AC#6): Retry fetching the managed encryption key from Supabase.
 * Useful when the initial fetch failed due to a transient network error.
 */
export const retryFetchManagedKey = async (): Promise<boolean> => {
  const userId = store$.session.userId.get()
  if (!userId) return false

  batch(() => {
    encryptionSetup$.error.set(null)
    syncEncryptionError$.set(null)
  })

  syncManagedKeyBytes$.set(null)

  const keyResult = await getManagedKeyBytes(userId)
  if (keyResult.error) {
    batch(() => {
      encryptionSetup$.error.set(keyResult.error)
      isEncryptionReadyForSync$.set(false)
      store$.session.syncEnabled.set(false)
    })
    return false
  }

  batch(() => {
    encryptionSetup$.error.set(null)
    isEncryptionReadyForSync$.set(true)
  })
  return true
}

/**
 * C1: Allow managed-mode users to supply their old E2E password so historical
 * E2E-encrypted flows can be decrypted. This derives the E2E master key and
 * caches it in memory without changing the user's current encryption mode.
 */
export const retryWithE2EPassword = async (password: string): Promise<boolean> => {
  const normalizedPassword = password.trim()
  if (!normalizedPassword) {
    encryptionSetup$.error.set({
      message: 'Encryption password is required.',
      code: 'missing_password',
    })
    return false
  }

  const userId = store$.session.userId.get()
  if (!userId) {
    encryptionSetup$.error.set({
      message: 'You must be signed in.',
      code: 'missing_user',
    })
    return false
  }

  const salt = encryptionSetup$.currentModeSalt.get()
  if (!salt) {
    encryptionSetup$.error.set({
      message: 'No E2E encryption salt on file for this account.',
      code: 'e2e_salt_missing',
    })
    return false
  }

  batch(() => {
    encryptionSetup$.error.set(null)
    syncEncryptionError$.set(null)
  })

  const result = await unlockE2EEncryptionOnDevice({
    userId,
    password: normalizedPassword,
    salt,
  })

  if (result.error) {
    encryptionSetup$.error.set(result.error)
    return false
  }

  batch(() => {
    encryptionSetup$.hasLocalE2EKey.set(true)
    encryptionSetup$.error.set(null)
    syncEncryptionError$.set(null)
    resetDialogState()
  })

  // Re-fetch flows that Legend-State already downloaded but couldn't decrypt
  // (they were dropped as null before the E2E key was available).
  void refetchUndecryptedFlows()

  return true
}

/**
 * Re-fetches all flows from Supabase and merges any that are missing from
 * local state. Called after the E2E key becomes available to recover flows
 * that were dropped during the initial sync (decryption failed without the key).
 */
const refetchUndecryptedFlows = async (): Promise<void> => {
  const { data, error } = await supabase
    .from('flows')
    .select('id, daily_entry_id, content, word_count, created_at, updated_at, is_deleted')

  if (error || !data) return

  const localFlows = flows$.peek() ?? {}
  let recovered = 0

  for (const row of data) {
    if (localFlows[row.id]) continue
    if (row.is_deleted) continue

    try {
      const flow = dbFlowToLocal(row)
      flows$[flow.id].set(flow)
      recovered++
    } catch {
      // Still can't decrypt — skip silently
    }
  }

  if (process.env.NODE_ENV === 'development' && recovered > 0) {
    // eslint-disable-next-line no-console
    console.log(`🔓 [retryWithE2EPassword] recovered ${recovered} previously undecryptable flows`)
  }
}
