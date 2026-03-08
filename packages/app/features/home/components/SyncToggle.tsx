import { useCallback } from 'react'
import { Switch, Label, XStack, YStack, Text, Card, Separator } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import {
  clearEncryptionSetupError,
  encryptionSetup$,
  requestSyncEnable,
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
  e2e: 'Your mode choice is saved. Cloud Sync stays off until encrypted sync is available in this build.',
  managed: 'Managed encryption is saved for this account. This choice cannot be changed here.',
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
  const error = use$(encryptionSetup$.error)

  const isE2EPendingBootstrap = currentMode === 'e2e' && !currentModeSalt
  const isSwitchDisabled = isLoadingMode || isE2EPendingBootstrap

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
    : currentMode
      ? MODE_DESCRIPTIONS[currentMode]
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
