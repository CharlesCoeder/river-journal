import { useCallback, useState } from 'react'
import { AnimatePresence, Switch, Label, XStack, YStack, Text, Card, Separator, Button } from '@my/ui'
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

const EXPLANATIONS = {
  syncOn:
    'Your journal is syncing to the cloud. Disabling sync will stop future uploads — previously synced data stays safe in the cloud.',
  syncOff: 'Sync your journal to the cloud. Access your writing from any device.',
} as const

const MODE_LABELS = {
  e2e: 'End-to-end encryption',
  managed: 'Managed encryption',
} as const

const MODE_DESCRIPTIONS = {
  e2eReady:
    'End-to-end encryption is active on this device. Cloud Sync uploads encrypted journal content.',
  e2eNeedsKey:
    'This account uses end-to-end encryption. Enter your encryption password on this device to unlock Cloud Sync.',
  e2eSetupIncomplete:
    'End-to-end encryption setup is incomplete for this account. Cloud Sync stays off until setup is completed.',
  managed: 'Managed encryption is active for this account. This choice is read-only here.',
} as const

const PRIVACY_SUMMARIES = {
  e2e: [
    'Your data is encrypted with a password only you know',
    'We can never read your journal entries',
    'If you forget your password, cloud data is unrecoverable',
  ],
  managed: [
    'Your data is encrypted with a key we manage',
    'We could access your data for support or recovery',
    'Standard password recovery is available',
  ],
} as const

/**
 * SyncToggle — lets the authenticated user enable/disable cloud sync.
 * First-time enablement is intercepted by the shared encryption setup state.
 */
export function SyncToggle() {
  const syncEnabled = use$(store$.session.syncEnabled)
  const isLoadingMode = use$(encryptionSetup$.isLoadingMode)
  const currentMode = use$(encryptionSetup$.currentMode)
  const currentModeSalt = use$(encryptionSetup$.currentModeSalt)
  const hasLocalE2EKey = use$(encryptionSetup$.hasLocalE2EKey)
  const error = use$(encryptionSetup$.error)
  const [isRetryingManagedKey, setIsRetryingManagedKey] = useState(false)
  const [privacySummaryOpen, setPrivacySummaryOpen] = useState(false)

  const isE2EReadyOnDevice = currentMode === 'e2e' && !!currentModeSalt && hasLocalE2EKey
  const isE2EKeyRequiredOnDevice = currentMode === 'e2e' && !!currentModeSalt && !hasLocalE2EKey
  const isE2ESetupIncomplete = currentMode === 'e2e' && !currentModeSalt
  const isManagedReadyOnDevice = currentMode === 'managed' && !error
  const isSwitchDisabled = isLoadingMode || isE2EKeyRequiredOnDevice || isE2ESetupIncomplete
  const canContinueE2ESetup = isE2EKeyRequiredOnDevice || isE2ESetupIncomplete

  const handleCheckedChange = useCallback((checked: boolean) => {
    if (!checked) {
      clearEncryptionSetupError()
      store$.session.syncEnabled.set(false)
      return
    }

    void requestSyncEnable()
  }, [])

  const handleContinueE2ESetup = useCallback(() => {
    continueLockedE2ESetup()
  }, [])

  const handleRetryManagedKey = useCallback(async () => {
    setIsRetryingManagedKey(true)
    try {
      await retryFetchManagedKey()
    } finally {
      setIsRetryingManagedKey(false)
    }
  }, [])

  const handleLegacyE2EUnlock = useCallback(() => {
    openLegacyE2EUnlock()
  }, [])

  const description = isLoadingMode
    ? 'Checking your encryption settings before Cloud Sync can turn on.'
    : currentMode === 'managed'
      ? MODE_DESCRIPTIONS.managed
      : isE2EReadyOnDevice
        ? MODE_DESCRIPTIONS.e2eReady
        : isE2EKeyRequiredOnDevice
          ? MODE_DESCRIPTIONS.e2eNeedsKey
          : isE2ESetupIncomplete
            ? MODE_DESCRIPTIONS.e2eSetupIncomplete
            : syncEnabled
              ? EXPLANATIONS.syncOn
              : EXPLANATIONS.syncOff

  return (
    <Card padding="$4" backgroundColor="$color2" borderRadius="$4" borderWidth={1} borderColor="$color4" width="100%">
      <YStack gap="$3">
        <XStack alignItems="center" justifyContent="space-between" gap="$3">
          <Label htmlFor="sync-toggle" fontSize="$5" fontFamily="$body" fontWeight="600">
            Cloud Sync
          </Label>
          <Switch
            id="sync-toggle"
            testID="sync-toggle"
            checked={syncEnabled}
            onCheckedChange={handleCheckedChange}
            size="$4"
            disabled={isSwitchDisabled}
          >
            <Switch.Thumb animation="quick" />
          </Switch>
        </XStack>

        {currentMode && (
          <>
            <Separator />
            <YStack gap="$1">
              <Text fontSize="$2" fontFamily="$body" color="$color10" textTransform="uppercase">
                Encryption mode
              </Text>
              <Text fontSize="$4" fontFamily="$body" fontWeight="600">
                {MODE_LABELS[currentMode]}
              </Text>
              {currentMode === 'managed' && (
                <Text
                  fontSize="$2"
                  fontFamily="$body"
                  color={isManagedReadyOnDevice ? '$green10' : '$orange10'}
                >
                  {isManagedReadyOnDevice
                    ? 'Ready on this device'
                    : 'Managed key required on this device'}
                </Text>
              )}
              {currentMode === 'e2e' && (
                <Text
                  fontSize="$2"
                  fontFamily="$body"
                  color={isE2EReadyOnDevice ? '$green10' : '$orange10'}
                >
                  {isE2EReadyOnDevice
                    ? 'Ready on this device'
                    : isE2EKeyRequiredOnDevice
                      ? 'Encryption password required on this device'
                      : 'Setup incomplete on this account'}
                </Text>
              )}
              <Text fontSize="$2" fontFamily="$body" color="$color11">
                This choice is read-only for now.
              </Text>
              <Text
                testID="privacy-summary-toggle"
                fontSize="$2"
                fontFamily="$body"
                color="$accentColor"
                cursor="pointer"
                onPress={() => setPrivacySummaryOpen((prev) => !prev)}
                paddingTop="$1"
              >
                {privacySummaryOpen ? 'Hide details' : 'What does this mean?'}
              </Text>
              <AnimatePresence>
                {privacySummaryOpen && (
                  <YStack
                    key="privacy-summary"
                    animation="quick"
                    enterStyle={{ opacity: 0, scale: 0.97 }}
                    exitStyle={{ opacity: 0, scale: 0.97 }}
                    opacity={1}
                    scale={1}
                    gap="$1"
                    paddingTop="$1"
                  >
                    {PRIVACY_SUMMARIES[currentMode].map((bullet) => (
                      <XStack key={bullet} gap="$2" alignItems="flex-start">
                        <Text fontSize="$2" fontFamily="$body" color="$color11">
                          •
                        </Text>
                        <Text fontSize="$2" fontFamily="$body" color="$color11" flexShrink={1}>
                          {bullet}
                        </Text>
                      </XStack>
                    ))}
                  </YStack>
                )}
              </AnimatePresence>
            </YStack>
          </>
        )}

        <Separator />

        <Text fontSize="$3" fontFamily="$body" color="$color11">
          {description}
        </Text>

        {currentMode === 'managed' && error && error.code === 'e2e_password_required' && (
          <XStack justifyContent="flex-start">
            <Button
              testID="managed-e2e-unlock"
              size="$3"
              variant="outlined"
              onPress={handleLegacyE2EUnlock}
            >
              Enter old E2E password
            </Button>
          </XStack>
        )}

        {currentMode === 'managed' && error && (error.code === 'managed_key_missing' || error.code === 'managed_key_invalid') && (
          <XStack justifyContent="flex-start">
            <Button
              testID="managed-key-retry"
              size="$3"
              variant="outlined"
              onPress={handleRetryManagedKey}
              disabled={isRetryingManagedKey}
            >
              {isRetryingManagedKey ? 'Retrying key fetch...' : 'Retry key fetch'}
            </Button>
          </XStack>
        )}

        {canContinueE2ESetup && (
          <XStack justifyContent="flex-start">
            <Button
              testID="continue-e2e-setup"
              size="$3"
              variant="outlined"
              onPress={handleContinueE2ESetup}
              fontFamily="$body"
            >
              {isE2EKeyRequiredOnDevice ? 'Enter encryption password' : 'Finish encryption setup'}
            </Button>
          </XStack>
        )}

        {error && (
          <Text fontSize="$3" fontFamily="$body" color="$red10">
            {error.message}
          </Text>
        )}
      </YStack>
    </Card>
  )
}
