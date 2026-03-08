import { useCallback } from 'react'
import { Switch, Label, XStack, YStack, Text, Card, Separator } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import {
  clearEncryptionSetupError,
  encryptionSetup$,
  requestSyncEnable,
} from 'app/state/encryptionSetup'
import { syncEncryptionError$ } from 'app/state/syncConfig'

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
  e2eReady: 'End-to-end encryption is ready on this device. Journal content syncs encrypted before upload.',
  e2eKeyRequired:
    'End-to-end encryption is selected for this account, but this device still needs the encryption password before sync can turn on.',
  e2eSetupIncomplete:
    'End-to-end encryption setup is incomplete for this account. Cloud Sync stays off until setup is retried.',
  managed: 'Managed encryption is active for this account. This choice is read-only here.',
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
  const localKeyState = use$(encryptionSetup$.localKeyState)
  const localError = use$(encryptionSetup$.error)
  const syncError = use$(syncEncryptionError$)
  const error = localError ?? syncError

  const isE2ESetupIncomplete = currentMode === 'e2e' && !currentModeSalt
  const isE2EKeyRequired =
    currentMode === 'e2e' && !!currentModeSalt && localKeyState !== 'available'
  const isSwitchDisabled = isLoadingMode || isE2ESetupIncomplete || isE2EKeyRequired

  const handleCheckedChange = useCallback((checked: boolean) => {
    if (!checked) {
      clearEncryptionSetupError()
      store$.session.syncEnabled.set(false)
      return
    }

    void requestSyncEnable()
  }, [])

  const description = isLoadingMode
    ? 'Checking your encryption settings before Cloud Sync can turn on.'
    : currentMode === 'managed'
      ? MODE_DESCRIPTIONS.managed
      : currentMode === 'e2e' && isE2ESetupIncomplete
        ? MODE_DESCRIPTIONS.e2eSetupIncomplete
        : currentMode === 'e2e' && isE2EKeyRequired
          ? MODE_DESCRIPTIONS.e2eKeyRequired
          : currentMode === 'e2e'
            ? MODE_DESCRIPTIONS.e2eReady
            : syncEnabled
              ? EXPLANATIONS.syncOn
              : EXPLANATIONS.syncOff

  return (
    <Card bordered padding="$4" backgroundColor="$background" width="100%">
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
              <Text fontSize="$2" fontFamily="$body" color="$color11">
                This choice is read-only for now.
              </Text>
            </YStack>
          </>
        )}

        <Separator />

        <Text fontSize="$3" fontFamily="$body" color="$color11">
          {description}
        </Text>

        {error && (
          <Text fontSize="$3" fontFamily="$body" color="$red10">
            {error.message}
          </Text>
        )}
      </YStack>
    </Card>
  )
}
