import { batch, observable, observe } from '@legendapp/state'
import type { EncryptionMode } from '../types/index'
import { store$ } from './store'
import { loadMasterKey } from '../utils/encryptionKeyStore'
import {
  readUserEncryptionSettings,
  startE2EEncryptionBootstrap,
  upsertUserEncryptionMode,
} from '../utils/userEncryption'
import { syncEncryptionError$, syncEncryptionMode$ } from './syncConfig'

export type EncryptionSetupStep = 'choice' | 'e2e-password' | 'saving'

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
  error: null as EncryptionSetupError | null,
  currentMode: null as EncryptionMode | null,
  currentModeSalt: null as string | null,
  hasLocalE2EKey: false,
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
): Promise<boolean> => {
  if (mode !== 'e2e' || !salt) return false
  const key = await loadMasterKey(userId)
  return !!key
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
    loadCurrentEncryptionModePromise = null
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

      const hasLocalE2EKey = await resolveLocalE2EKeyAvailability(
        userId,
        result.data.mode,
        result.data.salt
      )

      applyLoadedSettings(result.data.mode, result.data.salt, hasLocalE2EKey)
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
  syncEncryptionError$.set(null)

  encryptionSetup$.step.set('saving')

  const bootstrapResult = await startE2EEncryptionBootstrap({
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
  return true
}

observe(() => {
  const runtimeError = syncEncryptionError$.get()
  if (!runtimeError) return

  batch(() => {
    store$.session.syncEnabled.set(false)
    isEncryptionReadyForSync$.set(false)
    encryptionSetup$.error.set(runtimeError)
  })
})
