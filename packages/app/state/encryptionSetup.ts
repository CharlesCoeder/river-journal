import { batch, observable, observe } from '@legendapp/state'
import type { EncryptionMode } from '../types/index'
import { store$ } from './store'
import { clearStoredMasterKey, hasPlatformKeyring, loadMasterKey } from '../utils/encryptionKeyStore'
import {
  readUserEncryptionSettings,
  unlockE2EEncryptionOnDevice,
  startE2EEncryptionBootstrap,
  upsertUserEncryptionMode,
  validateE2EMasterKeyForUser,
  persistMasterKeyToKeyring,
  bootstrapManagedEncryption,
  clearManagedEncryptionKeyCache,
  fetchManagedEncryptionKey,
} from '../utils/userEncryption'
import { syncEncryptionError$, syncEncryptionMode$, syncManagedKeyBytes$ } from './syncConfig'
import { hexToBytes } from '@noble/ciphers/utils.js'

export type EncryptionSetupStep = 'choice' | 'e2e-password' | 'legacy-e2e-password' | 'saving'

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
  selectedMode: DEFAULT_MODE as EncryptionMode,
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

const setManagedKeyBytesFromHex = (keyHex: string | null) => {
  const normalized = keyHex ? keyHex.toLowerCase() : null
  syncManagedKeyBytes$.set(normalized ? hexToBytes(normalized) : null)
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

const resolveLocalE2EKeyAvailability = async (
  userId: string,
  mode: EncryptionMode | null,
  salt: string | null
) : Promise<{ hasLocalE2EKey: boolean; error: EncryptionSetupError | null }> => {
  if (mode !== 'e2e' || !salt) {
    return { hasLocalE2EKey: false, error: null }
  }

  const key = await loadMasterKey(userId)
  if (!key) {
    return { hasLocalE2EKey: false, error: null }
  }

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
    loadCurrentEncryptionModePromise = null
    pendingKeyringMasterKey = null
    pendingKeyringUserId = null
    setManagedKeyBytesFromHex(null)
    clearManagedEncryptionKeyCache()
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

      // Managed mode: fetch the managed key from Supabase and cache it
      if (result.data.mode === 'managed') {
        const keyResult = await fetchManagedEncryptionKey(userId)
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
        setManagedKeyBytesFromHex(keyResult.data)

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

  setManagedKeyBytesFromHex(bootstrapResult.managedKeyHex)

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
  const isUnlockingExistingE2E = currentMode === 'e2e' && !!currentModeSalt

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

  batch(() => {
    resetDialogState()
    encryptionSetup$.error.set(null)
    store$.session.syncEnabled.set(true)
    isEncryptionReadyForSync$.set(true)
  })

  // Phase 2: offer keyring persistence on platforms that support it
  if (bootstrapResult.masterKey) {
    const hasKeyring = await hasPlatformKeyring()
    if (hasKeyring) {
      pendingKeyringMasterKey = bootstrapResult.masterKey
      pendingKeyringUserId = userId
      keyringPrompt$.isVisible.set(true)
    }
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

  const keyResult = await fetchManagedEncryptionKey(userId)
  if (keyResult.error) {
    batch(() => {
      encryptionSetup$.error.set(keyResult.error)
      isEncryptionReadyForSync$.set(false)
      store$.session.syncEnabled.set(false)
    })
    return false
  }

  setManagedKeyBytesFromHex(keyResult.data)

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
  })
  return true
}
