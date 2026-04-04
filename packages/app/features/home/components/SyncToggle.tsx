import { useCallback, useState } from 'react'
import { Text, YStack } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import {
  clearEncryptionSetupError,
  continueLockedE2ESetup,
  encryptionSetup$,
  openLegacyE2EUnlock,
  requestSyncEnable,
  retryFetchManagedKey,
} from 'app/state/encryptionSetup'

type SyncDisplayStatus = 'off' | 'syncing' | 'e2e_needed' | 'e2e_incomplete' | 'managed_unavailable' | 'loading'

/**
 * SyncToggle — minimal text-based sync status display in the settings Data & Sync section.
 */
export function SyncToggle() {
  const syncEnabled = use$(store$.session.syncEnabled)
  const isLoadingMode = use$(encryptionSetup$.isLoadingMode)
  const currentMode = use$(encryptionSetup$.currentMode)
  const currentModeSalt = use$(encryptionSetup$.currentModeSalt)
  const hasLocalE2EKey = use$(encryptionSetup$.hasLocalE2EKey)
  const error = use$(encryptionSetup$.error)
  const [isRetryingManagedKey, setIsRetryingManagedKey] = useState(false)

  const isE2EReadyOnDevice = currentMode === 'e2e' && !!currentModeSalt && hasLocalE2EKey
  const isE2EKeyRequiredOnDevice = currentMode === 'e2e' && !!currentModeSalt && !hasLocalE2EKey
  const isE2ESetupIncomplete = currentMode === 'e2e' && !currentModeSalt
  const isManagedReadyOnDevice = currentMode === 'managed' && !error

  const isManagedKeyError =
    currentMode === 'managed' &&
    error &&
    (error.code === 'managed_key_missing' || error.code === 'managed_key_invalid')

  let status: SyncDisplayStatus
  if (isLoadingMode) status = 'loading'
  else if (syncEnabled && (isE2EReadyOnDevice || isManagedReadyOnDevice)) status = 'syncing'
  else if (isE2EKeyRequiredOnDevice) status = 'e2e_needed'
  else if (isE2ESetupIncomplete) status = 'e2e_incomplete'
  else if (isManagedKeyError) status = 'managed_unavailable'
  else status = 'off'

  const handleEnableSync = useCallback(() => {
    void requestSyncEnable()
  }, [])

  const handleDisableSync = useCallback(() => {
    clearEncryptionSetupError()
    store$.session.syncEnabled.set(false)
  }, [])

  const handleUnlockSync = useCallback(() => {
    if (currentMode === 'managed' && error?.code === 'e2e_password_required') {
      openLegacyE2EUnlock()
    } else {
      continueLockedE2ESetup()
    }
  }, [currentMode, error])

  const handleRetrySync = useCallback(async () => {
    setIsRetryingManagedKey(true)
    try {
      await retryFetchManagedKey()
    } finally {
      setIsRetryingManagedKey(false)
    }
  }, [])

  const handleResumeSetup = useCallback(() => {
    void requestSyncEnable()
  }, [])

  return (
    <YStack gap="$2" alignItems="flex-start">
      {status === 'loading' && (
        <Text
          testID="sync-status-loading"
          fontFamily="$journal"
          fontSize={20}
          color="$color8"
        >
          Checking Sync...
        </Text>
      )}

      {status === 'off' && (
        <>
          <Text
            testID="sync-toggle"
            fontFamily="$journal"
            fontSize={20}
            color="$color8"
            borderBottomWidth={1}
            borderColor="$color5"
            paddingBottom={4}
            cursor="pointer"
            hoverStyle={{ color: '$color' }}
            onPress={handleEnableSync}
          >
            Enable Cloud Sync
          </Text>
          <Text fontFamily="$body" fontSize={13} color="$color8">
            Entries remain on this device only.
          </Text>
        </>
      )}

      {status === 'syncing' && (
        <>
          <Text
            testID="sync-toggle"
            fontFamily="$journal"
            fontSize={20}
            color="$color"
            borderBottomWidth={1}
            borderColor="$color5"
            paddingBottom={4}
            cursor="pointer"
            hoverStyle={{ opacity: 0.7 }}
            onPress={handleDisableSync}
          >
            Cloud Sync Active
          </Text>
          <Text fontFamily="$body" fontSize={13} color="$color8">
            Everything is securely backed up and up to date.
          </Text>
        </>
      )}

      {status === 'e2e_needed' && (
        <>
          <Text
            testID="sync-status-locked"
            fontFamily="$journal"
            fontSize={20}
            color="$color"
          >
            Cloud Sync Locked
          </Text>
          <Text fontFamily="$body" fontSize={13} color="$color8">
            Cannot sync until your password is entered.
          </Text>
          <Text
            testID="continue-e2e-setup"
            fontFamily="$body"
            fontSize={11}
            letterSpacing={2}
            textTransform="uppercase"
            color="$color"
            borderBottomWidth={1}
            borderColor="$color5"
            paddingBottom={2}
            marginTop="$2"
            cursor="pointer"
            hoverStyle={{ opacity: 0.7 }}
            onPress={handleUnlockSync}
          >
            Unlock Now
          </Text>
        </>
      )}

      {status === 'e2e_incomplete' && (
        <>
          <Text
            testID="sync-status-incomplete"
            fontFamily="$journal"
            fontSize={20}
            color="$color"
          >
            Setup Incomplete
          </Text>
          <Text fontFamily="$body" fontSize={13} color="$color8">
            Encryption setup was started but not finished.
          </Text>
          <Text
            testID="continue-e2e-setup"
            fontFamily="$body"
            fontSize={11}
            letterSpacing={2}
            textTransform="uppercase"
            color="$color"
            borderBottomWidth={1}
            borderColor="$color5"
            paddingBottom={2}
            marginTop="$2"
            cursor="pointer"
            hoverStyle={{ opacity: 0.7 }}
            onPress={handleResumeSetup}
          >
            Resume Setup
          </Text>
        </>
      )}

      {status === 'managed_unavailable' && (
        <>
          <Text
            testID="sync-status-unavailable"
            fontFamily="$journal"
            fontSize={20}
            color="$color"
          >
            Sync Unavailable
          </Text>
          <Text fontFamily="$body" fontSize={13} color="$color8">
            We couldn't fetch your managed encryption key.
          </Text>
          <Text
            testID="managed-key-retry"
            fontFamily="$body"
            fontSize={11}
            letterSpacing={2}
            textTransform="uppercase"
            color="$color"
            borderBottomWidth={1}
            borderColor="$color5"
            paddingBottom={2}
            marginTop="$2"
            cursor="pointer"
            hoverStyle={{ opacity: 0.7 }}
            opacity={isRetryingManagedKey ? 0.4 : 1}
            onPress={() => void handleRetrySync()}
            disabled={isRetryingManagedKey}
          >
            {isRetryingManagedKey ? 'Retrying...' : 'Retry Connection'}
          </Text>
        </>
      )}

      {error && status !== 'managed_unavailable' && (
        <Text fontFamily="$body" fontSize={13} color="$red10" marginTop="$1">
          {error.message}
        </Text>
      )}
    </YStack>
  )
}
