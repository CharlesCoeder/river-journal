import { batch, observable } from '@legendapp/state'
import type { EncryptionMode } from '../types/index'
import { store$ } from './store'
import {
  clearSyncEncryptionError,
  syncEncryptionError$,
  syncEncryptionKeyBackend$,
  syncEncryptionKeyState$,
  syncEncryptionMode$,
  syncEncryptionSalt$,
} from './syncConfig'
import {
  readUserEncryptionSettings,
  startE2EEncryptionBootstrap,
  upsertUserEncryptionMode,
} from '../utils/userEncryption'
import { loadEncryptionKey } from '../utils/encryptionKeyStore'

export type EncryptionSetupStep = 'choice' | 'e2e-password' | 'saving'
export type LocalEncryptionKeyState = 'unknown' | 'available' | 'missing'
export type EncryptionKeyBackend = 'secure' | 'session'

export interface EncryptionSetupError {
  message: string
  code: string
}

const DEFAULT_MODE: EncryptionMode = 'e2e'
const E2E_KEY_REQUIRED_ERROR: EncryptionSetupError = {
  message: 'This device still needs your encryption password before Cloud Sync can turn on.',
  code: 'encryption_key_required',
}
const E2E_SETUP_INCOMPLETE_ERROR: EncryptionSetupError = {
  message: 'End-to-end encryption setup is incomplete for this account. Cloud Sync remains off.',
  code: 'encryption_bootstrap_failed',
}

const getSyncEligibility = (
  mode: EncryptionMode | null,
  salt: string | null,
  localKeyState: LocalEncryptionKeyState
): boolean => mode === 'managed' || (mode === 'e2e' && !!salt && localKeyState === 'available')

const getBlockingError = (
  mode: EncryptionMode | null,
  salt: string | null,
  localKeyState: LocalEncryptionKeyState
): EncryptionSetupError | null => {
  if (mode !== 'e2e') return null
  if (!salt) return E2E_SETUP_INCOMPLETE_ERROR
  if (localKeyState !== 'available') return E2E_KEY_REQUIRED_ERROR
  return null
}

let loadCurrentEncryptionModePromise: Promise<EncryptionMode | null> | null = null

export const isEncryptionReadyForSync$ = observable(false)

export const encryptionSetup$ = observable({
  isOpen: false,
  selectedMode: DEFAULT_MODE as EncryptionMode,
  step: 'choice' as EncryptionSetupStep,
  error: null as EncryptionSetupError | null,
  currentMode: null as EncryptionMode | null,
  currentModeSalt: null as string | null,
  localKeyState: 'unknown' as LocalEncryptionKeyState,
  keyBackend: null as EncryptionKeyBackend | null,
  hasLoadedMode: false,
  isLoadingMode: false,
})

const resetDialogState = () => {
  batch(() => {
    encryptionSetup$.isOpen.set(false)
    encryptionSetup$.selectedMode.set(DEFAULT_MODE)
    encryptionSetup$.step.set('choice')
  })
}

const setSharedEncryptionState = (
  mode: EncryptionMode | null,
  salt: string | null,
  localKeyState: LocalEncryptionKeyState,
  keyBackend: EncryptionKeyBackend | null
) => {
  syncEncryptionMode$.set(mode)
  syncEncryptionSalt$.set(salt)
  syncEncryptionKeyState$.set(localKeyState)
  syncEncryptionKeyBackend$.set(keyBackend)
}

const applyLoadedSettings = (
  mode: EncryptionMode | null,
  salt: string | null,
  localKeyState: LocalEncryptionKeyState,
  keyBackend: EncryptionKeyBackend | null,
  options?: { preserveError?: boolean }
) => {
  const canEnableSync = getSyncEligibility(mode, salt, localKeyState)
  const blockingError = getBlockingError(mode, salt, localKeyState)

  batch(() => {
    encryptionSetup$.currentMode.set(mode)
    encryptionSetup$.currentModeSalt.set(salt)
    encryptionSetup$.localKeyState.set(localKeyState)
    encryptionSetup$.keyBackend.set(keyBackend)
    encryptionSetup$.hasLoadedMode.set(true)
    isEncryptionReadyForSync$.set(canEnableSync)
    setSharedEncryptionState(mode, salt, localKeyState, keyBackend)

    if (!options?.preserveError) {
      encryptionSetup$.error.set(blockingError)
      clearSyncEncryptionError()
    }

    if (!canEnableSync) {
      store$.session.syncEnabled.set(false)
    }
  })
}

const resolveLocalKeyState = async (
  userId: string,
  mode: EncryptionMode | null,
  salt: string | null
): Promise<{ localKeyState: LocalEncryptionKeyState; keyBackend: EncryptionKeyBackend | null }> => {
  if (mode !== 'e2e') {
    return { localKeyState: 'unknown', keyBackend: null }
  }

  if (!salt) {
    return { localKeyState: 'missing', keyBackend: null }
  }

  const { keyHex, backend } = await loadEncryptionKey(userId)
  return {
    localKeyState: keyHex ? 'available' : 'missing',
    keyBackend: backend,
  }
}

export const resetEncryptionSetupState = () => {
  batch(() => {
    resetDialogState()
    encryptionSetup$.error.set(null)
    encryptionSetup$.currentMode.set(null)
    encryptionSetup$.currentModeSalt.set(null)
    encryptionSetup$.localKeyState.set('unknown')
    encryptionSetup$.keyBackend.set(null)
    encryptionSetup$.hasLoadedMode.set(false)
    encryptionSetup$.isLoadingMode.set(false)
    isEncryptionReadyForSync$.set(false)
    setSharedEncryptionState(null, null, 'unknown', null)
    clearSyncEncryptionError()
    loadCurrentEncryptionModePromise = null
  })
}

export const clearEncryptionSetupError = () => {
  batch(() => {
    encryptionSetup$.error.set(null)
    clearSyncEncryptionError()
  })
}

export const setSelectedEncryptionMode = (mode: EncryptionMode) => {
  batch(() => {
    encryptionSetup$.selectedMode.set(mode)
    encryptionSetup$.error.set(null)
    clearSyncEncryptionError()
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
          encryptionSetup$.localKeyState.set('unknown')
          encryptionSetup$.keyBackend.set(null)
          isEncryptionReadyForSync$.set(false)
          setSharedEncryptionState(null, null, 'unknown', null)
          store$.session.syncEnabled.set(false)
        })
        return null
      }

      const { localKeyState, keyBackend } = await resolveLocalKeyState(
        userId,
        result.data.mode,
        result.data.salt
      )

      applyLoadedSettings(result.data.mode, result.data.salt, localKeyState, keyBackend)
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
    encryptionSetup$.error.set(null)
    clearSyncEncryptionError()
  })
}

export const cancelEncryptionSetup = () => {
  batch(() => {
    store$.session.syncEnabled.set(false)
    encryptionSetup$.error.set(null)
    clearSyncEncryptionError()
    resetDialogState()
  })
}

export const returnToEncryptionChoice = () => {
  batch(() => {
    encryptionSetup$.step.set('choice')
    encryptionSetup$.error.set(null)
    clearSyncEncryptionError()
  })
}

export const requestSyncEnable = async (): Promise<boolean> => {
  clearEncryptionSetupError()

  if (!encryptionSetup$.hasLoadedMode.get()) {
    await loadCurrentEncryptionMode()
  }

  const currentMode = encryptionSetup$.currentMode.get()
  const salt = encryptionSetup$.currentModeSalt.get()
  const localKeyState = encryptionSetup$.localKeyState.get()

  if (!currentMode) {
    store$.session.syncEnabled.set(false)
    openEncryptionSetup()
    return false
  }

  if (getSyncEligibility(currentMode, salt, localKeyState)) {
    store$.session.syncEnabled.set(true)
    return true
  }

  batch(() => {
    store$.session.syncEnabled.set(false)
    encryptionSetup$.error.set(getBlockingError(currentMode, salt, localKeyState))
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

  applyLoadedSettings(result.data.mode, result.data.salt, 'unknown', null)
  return true
}

export const confirmEncryptionModeSelection = async (): Promise<boolean> => {
  clearEncryptionSetupError()

  if (encryptionSetup$.selectedMode.get() === 'e2e') {
    encryptionSetup$.step.set('e2e-password')
    return false
  }

  const persisted = await persistEncryptionMode('managed')
  if (!persisted) return false

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

  if (normalizedPassword !== normalizedConfirmPassword) {
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

  clearEncryptionSetupError()
  encryptionSetup$.step.set('saving')

  const bootstrapResult = await startE2EEncryptionBootstrap({
    userId,
    password: normalizedPassword,
  })

  if (bootstrapResult.error) {
    batch(() => {
      resetDialogState()
      encryptionSetup$.step.set('choice')
      encryptionSetup$.error.set(bootstrapResult.error)
      store$.session.syncEnabled.set(false)
      applyLoadedSettings(null, null, 'unknown', null, { preserveError: true })
    })
    return false
  }

  batch(() => {
    applyLoadedSettings('e2e', bootstrapResult.data.salt, 'available', bootstrapResult.data.keyBackend)
    resetDialogState()
    encryptionSetup$.error.set(null)
    store$.session.syncEnabled.set(true)
  })
  return true
}

export const getVisibleEncryptionError = (): EncryptionSetupError | null => {
  return encryptionSetup$.error.get() ?? syncEncryptionError$.get()
}
