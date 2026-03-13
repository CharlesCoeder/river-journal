import { useCallback, useEffect } from 'react'
import { Button, Card, Separator, Text, XStack, YStack } from '@my/ui'
import { useToastController } from '@tamagui/toast'
import { use$ } from '@legendapp/state/react'
import {
  acceptBrowserTrust,
  declineBrowserTrust,
  dismissTrustBrowserPrompt,
  trustBrowserPrompt$,
  trustBrowserResult$,
} from 'app/state/encryptionSetup'

/**
 * Inline card shown after E2E password entry on web,
 * offering to persist the encryption key in this browser.
 */
export function TrustBrowserPrompt() {
  const isVisible = use$(trustBrowserPrompt$.isVisible)
  const isTrusting = use$(trustBrowserPrompt$.isTrusting)
  const trustError = use$(trustBrowserPrompt$.trustError)
  const trustSuccess = use$(trustBrowserResult$.success)
  const trustResultError = use$(trustBrowserResult$.error)
  const persistGranted = use$(trustBrowserResult$.persistGranted)

  const toast = useToastController()

  useEffect(() => {
    if (trustSuccess) {
      if (persistGranted) {
        toast.show('Browser trusted', {
          message: 'Your encryption key is saved in this browser.',
          duration: 4000,
        })
      } else {
        toast.show('Browser trusted', {
          message:
            'Your encryption key is saved, but this browser may clear it under storage pressure. You may need to re-enter your password periodically.',
          duration: 6000,
        })
      }
      trustBrowserResult$.success.set(false)
      trustBrowserResult$.persistGranted.set(false)
    }
  }, [trustSuccess, persistGranted, toast])

  useEffect(() => {
    if (trustResultError) {
      toast.show('Could not trust browser', {
        message: "You'll need to enter your password next time.",
        duration: 6000,
      })
      trustBrowserResult$.error.set(null)
    }
  }, [trustResultError, toast])

  const handleAccept = useCallback(() => {
    void acceptBrowserTrust()
  }, [])

  const handleDecline = useCallback(() => {
    declineBrowserTrust()
  }, [])

  const handleDismiss = useCallback(() => {
    dismissTrustBrowserPrompt()
  }, [])

  if (!isVisible) return null

  return (
    <Card bordered padding="$4" backgroundColor="$background" width="100%">
      <YStack gap="$3">
        <YStack gap="$1.5">
          <Text fontSize="$4" fontFamily="$body" fontWeight="700">
            Trust this browser?
          </Text>
          <Text fontSize="$3" fontFamily="$body" color="$color11">
            Your encryption key will be stored securely in this browser so you
            won't need to enter your password next time. You can revoke trust at
            any time from your account settings.
          </Text>
          <Text fontSize="$2" fontFamily="$body" color="$color10">
            If your browser data is cleared — either by you or by the browser
            itself under storage pressure — you'll need to re-enter your
            password.
          </Text>
        </YStack>

        <Separator />

        {isTrusting && (
          <Text fontSize="$3" fontFamily="$body" color="$color11">
            Securing your key…
          </Text>
        )}

        {trustError && (
          <YStack gap="$2">
            <Text fontSize="$3" fontFamily="$body" color="$red10">
              {trustError.message}
            </Text>
            <XStack gap="$3" justifyContent="flex-end">
              <Button
                testID="trust-browser-dismiss"
                variant="outlined"
                size="$3"
                onPress={handleDismiss}
                fontFamily="$body"
              >
                Dismiss
              </Button>
              <Button
                testID="trust-browser-retry"
                size="$3"
                onPress={handleAccept}
                fontFamily="$body"
              >
                Retry
              </Button>
            </XStack>
          </YStack>
        )}

        {!isTrusting && !trustError && (
          <XStack gap="$3" justifyContent="flex-end">
            <Button
              testID="trust-browser-decline"
              variant="outlined"
              size="$3"
              onPress={handleDecline}
              fontFamily="$body"
            >
              Not now
            </Button>
            <Button
              testID="trust-browser-accept"
              size="$3"
              onPress={handleAccept}
              fontFamily="$body"
            >
              Trust this browser
            </Button>
          </XStack>
        )}
      </YStack>
    </Card>
  )
}
