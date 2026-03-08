import { batch, observable } from '@legendapp/state'
import type { EncryptionMode } from '../types/index'
import { store$ } from './store'
import {
  readUserEncryptionSettings,
  startE2EEncryptionBootstrap,
  upsertUserEncryptionMode,
} from '../utils/userEncryption'

export type EncryptionSetupStep = 'choice' | 'e2e-password' | 'saving'

export interface EncryptionSetupError {
  message: string
  code: string
}

const DEFAULT_MODE: EncryptionMode = 'e2e'
const E2E_BOOTSTRAP_PENDING_ERROR: EncryptionSetupError = {
  message:
    'End-to-end encryption is selected for this account, but encrypted cloud sync is not available in this build yet.',
  code: 'e2e_bootstrap_pending',
}

const getSyncEligibility = (mode: EncryptionMode | null, salt: string | null): boolean =>
  mode === 'managed' || (mode === 'e2e' && !!salt)

let loadCurrentEncryptionModePromise: Promise<EncryptionMode | null> | null = null

export const isEncryptionReadyForSync$ = observable(false)

export const encryptionSetup$ = observable({
  isOpen: false,
  selectedMode: DEFAULT_MODE as EncryptionMode,
  step: 'choice' as EncryptionSetupStep,
  error: null as EncryptionSetupError | null,
  currentMode: null as EncryptionMode | null,
  currentModeSalt: null as string | null,
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

const applyLoadedSettings = (mode: EncryptionMode | null, salt: string | null) => {
  const canEnableSync = getSyncEligibility(mode, salt)
  const pendingE2E = mode === 'e2e' && !salt

  batch(() => {
    encryptionSetup$.currentMode.set(mode)
    encryptionSetup$.currentModeSalt.set(salt)
    encryptionSetup$.hasLoadedMode.set(true)
    isEncryptionReadyForSync$.set(canEnableSync)
    encryptionSetup$.error.set(pendingE2E ? E2E_BOOTSTRAP_PENDING_ERROR : null)

    if (!canEnableSync) {
      store$.session.syncEnabled.set(false)
    }
  })
}

export const resetEncryptionSetupState = () => {
  batch(() => {
    resetDialogState()
    encryptionSetup$.error.set(null)
    encryptionSetup$.currentMode.set(null)
    encryptionSetup$.currentModeSalt.set(null)
    encryptionSetup$.hasLoadedMode.set(false)
    encryptionSetup$.isLoadingMode.set(false)
    isEncryptionReadyForSync$.set(false)
    loadCurrentEncryptionModePromise = null
  })
}

export const clearEncryptionSetupError = () => {
  encryptionSetup$.error.set(null)
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

      applyLoadedSettings(result.data.mode, result.data.salt)
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

  if (!currentMode) {
    store$.session.syncEnabled.set(false)
    openEncryptionSetup()
    return false
  }

  if (getSyncEligibility(currentMode, salt)) {
    store$.session.syncEnabled.set(true)
    return true
  }

  batch(() => {
    store$.session.syncEnabled.set(false)
    encryptionSetup$.error.set(E2E_BOOTSTRAP_PENDING_ERROR)
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

  applyLoadedSettings(result.data.mode, result.data.salt)
  return true
}

export const confirmEncryptionModeSelection = async (): Promise<boolean> => {
  encryptionSetup$.error.set(null)

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

  encryptionSetup$.error.set(null)

  const persisted = await persistEncryptionMode('e2e')
  if (!persisted) return false

  const bootstrapResult = await startE2EEncryptionBootstrap({
    userId,
    password: normalizedPassword,
  })

  if (bootstrapResult.error) {
    batch(() => {
      resetDialogState()
      encryptionSetup$.error.set(bootstrapResult.error)
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
  return true
}
