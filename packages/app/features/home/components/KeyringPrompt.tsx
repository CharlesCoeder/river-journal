import { useCallback, useEffect } from 'react'
import { Button, Card, Separator, Text, XStack, YStack } from '@my/ui'
import { useToastController } from '@tamagui/toast'
import { use$ } from '@legendapp/state/react'
import {
  acceptKeyringPersistence,
  declineKeyringPersistence,
  dismissKeyringPrompt,
  keyringPersistResult$,
  keyringPrompt$,
} from 'app/state/encryptionSetup'

/**
 * Inline card shown after password entry on platforms with a keyring,
 * offering to persist the encryption key for future sessions.
 */
export function KeyringPrompt() {
  const isVisible = use$(keyringPrompt$.isVisible)
  const isPersisting = use$(keyringPrompt$.isPersisting)
  const persistError = use$(keyringPrompt$.persistError)
  const persistSuccess = use$(keyringPersistResult$.success)
  const persistResultError = use$(keyringPersistResult$.error)

  const toast = useToastController()

  useEffect(() => {
    if (persistSuccess) {
      toast.show('Encryption key saved', {
        message: 'Your encryption key has been stored in the device keychain.',
        duration: 4000,
      })
      keyringPersistResult$.success.set(false)
    }
  }, [persistSuccess, toast])

  useEffect(() => {
    if (persistResultError) {
      toast.show('Keychain storage failed', {
        message:
          "Could not save to keychain — you'll need to enter your password next time.",
        duration: 6000,
      })
      keyringPersistResult$.error.set(null)
    }
  }, [persistResultError, toast])

  const handleAccept = useCallback(() => {
    void acceptKeyringPersistence()
  }, [])

  const handleDecline = useCallback(() => {
    declineKeyringPersistence()
  }, [])

  const handleDismiss = useCallback(() => {
    dismissKeyringPrompt()
  }, [])

  if (!isVisible) return null

  return (
    <Card padding="$4" backgroundColor="$color2" borderRadius="$4" borderWidth={1} borderColor="$color4" width="100%">
      <YStack gap="$3">
        <YStack gap="$1.5">
          <Text fontSize="$4" fontFamily="$body" fontWeight="700">
            Store encryption key in keychain?
          </Text>
          <Text fontSize="$3" fontFamily="$body" color="$color11">
            Save your encryption key so you don't have to enter your password
            every time you open the app on this device.
          </Text>
        </YStack>

        <Separator />

        {isPersisting && (
          <Text fontSize="$3" fontFamily="$body" color="$color11">
            Storing your key — please keep the app open until this completes…
          </Text>
        )}

        {persistError && (
          <YStack gap="$2">
            <Text fontSize="$3" fontFamily="$body" color="$red10">
              {persistError.message}
            </Text>
            <XStack gap="$3" justifyContent="flex-end">
              <Button
                testID="keyring-dismiss"
                variant="outlined"
                size="$3"
                onPress={handleDismiss}
                fontFamily="$body"
              >
                Dismiss
              </Button>
              <Button
                testID="keyring-retry"
                size="$3"
                onPress={handleAccept}
                fontFamily="$body"
              >
                Retry
              </Button>
            </XStack>
          </YStack>
        )}

        {!isPersisting && !persistError && (
          <XStack gap="$3" justifyContent="flex-end">
            <Button
              testID="keyring-decline"
              variant="outlined"
              size="$3"
              onPress={handleDecline}
              fontFamily="$body"
            >
              Not now
            </Button>
            <Button
              testID="keyring-accept"
              size="$3"
              onPress={handleAccept}
              fontFamily="$body"
            >
              Save to keychain
            </Button>
          </XStack>
        )}
      </YStack>
    </Card>
  )
}
