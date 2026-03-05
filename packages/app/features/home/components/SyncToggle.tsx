import { Switch, Label, XStack, YStack, Text, Card, Separator } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'

const EXPLANATIONS = {
  syncOn:
    'Your journal is syncing to the cloud. Disabling sync will stop future uploads — previously synced data stays safe in the cloud.',
  syncOff: 'Sync your journal to the cloud. Access your writing from any device.',
} as const

/**
 * SyncToggle — lets the authenticated user enable/disable cloud sync.
 * Reads and writes `store$.session.syncEnabled` directly.
 * The sync readiness gate (`isSyncReady$`) reacts automatically via
 * `setupSyncReadinessGate()` in initializeApp.ts.
 */
export function SyncToggle() {
  const syncEnabled = use$(store$.session.syncEnabled)

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
            onCheckedChange={(checked: boolean) => store$.session.syncEnabled.set(checked)}
            size="$4"
          >
            <Switch.Thumb animation="quick" />
          </Switch>
        </XStack>

        <Separator />

        <Text fontSize="$3" fontFamily="$body" color="$color11">
          {syncEnabled ? EXPLANATIONS.syncOn : EXPLANATIONS.syncOff}
        </Text>
      </YStack>
    </Card>
  )
}
