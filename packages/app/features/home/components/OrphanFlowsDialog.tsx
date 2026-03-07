import { useCallback, useEffect, useState } from 'react'
import { AlertDialog, Button, XStack, YStack, Text } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { orphanFlowsPending$ } from 'app/state/syncConfig'
import { resolveOrphanFlows } from 'app/state/store'

/**
 * OrphanFlowsDialog — shown when the user logs in and enables sync while
 * having local anonymous flows that haven't been assigned to an account.
 *
 * Visibility is driven by orphanFlowsPending$ — when null, dialog does not render.
 * The user must make an explicit choice; backdrop dismiss is not available.
 *
 * Buttons disable immediately on press to prevent double-tap race conditions.
 * resolveOrphanFlows is synchronous, so the dialog dismisses on the next
 * render frame — no loading state or spinner is needed.
 */
export function OrphanFlowsDialog() {
  const pending = use$(orphanFlowsPending$)
  const isOpen = pending !== null
  const [isResolving, setIsResolving] = useState(false)

  // Reset when new pending data arrives so buttons are enabled for the new dialog
  useEffect(() => {
    if (pending) setIsResolving(false)
  }, [pending])

  const handleResolve = useCallback(
    (adopt: boolean) => {
      if (isResolving) return
      setIsResolving(true)
      resolveOrphanFlows(adopt)
    },
    [isResolving]
  )

  if (!isOpen) return null

  const flowCount = pending?.flowCount ?? 0

  return (
    <AlertDialog open={isOpen} onOpenChange={() => {}}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          key="overlay"
          animation="quick"
          opacity={0.5}
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
        />
        <AlertDialog.Content
          key="content"
          bordered
          elevate
          animation={['quick', { opacity: { overshootClamping: true } }]}
          enterStyle={{ x: 0, y: -20, opacity: 0, scale: 0.9 }}
          exitStyle={{ x: 0, y: 10, opacity: 0, scale: 0.95 }}
          x={0}
          scale={1}
          opacity={1}
          y={0}
          backgroundColor="$background"
          maxWidth={400}
          width="90%"
        >
          <YStack gap="$4">
            <AlertDialog.Title fontFamily="$body" fontSize="$6" fontWeight="700">
              Sync local writing?
            </AlertDialog.Title>

            <AlertDialog.Description fontFamily="$body" fontSize="$4" color="$color">
              You have {flowCount} local writing session{flowCount !== 1 ? 's' : ''}. Would you like
              to sync {flowCount !== 1 ? 'them' : 'it'} to your account?
            </AlertDialog.Description>

            <Text fontFamily="$body" fontSize="$3" color="$color11">
              Local-only sessions stay on this device and are never uploaded.
            </Text>

            <XStack gap="$3" justifyContent="flex-end">
              <AlertDialog.Cancel asChild>
                <Button
                  variant="outlined"
                  onPress={() => handleResolve(false)}
                  disabled={isResolving}
                  fontFamily="$body"
                >
                  Keep local only
                </Button>
              </AlertDialog.Cancel>

              <AlertDialog.Action asChild>
                <Button
                  theme="active"
                  onPress={() => handleResolve(true)}
                  disabled={isResolving}
                  fontFamily="$body"
                >
                  Sync them
                </Button>
              </AlertDialog.Action>
            </XStack>
          </YStack>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  )
}
