/**
 * PreviousAccountBanner
 *
 * Surfaces "data from a previous account is on this device" when the current
 * authenticated user differs from `deviceState$.lastAuthedUserId` AND there
 * is local data still owned by that previous user. Three explicit actions —
 * never destructive on first tap.
 *
 * Wiring contract (see spec-fix-cross-user-data-defense.md):
 *  - "Sign in as previous account" → sign out + route to /auth.
 *  - "Delete from this device" → confirm modal → wipe the previous user's
 *    rows; advance lastAuthedUserId to current.
 *  - "Keep local" → record the (prev → current) transition as acknowledged
 *    and advance lastAuthedUserId to current.
 */

import { useCallback, useState } from 'react'
import {
  AlertDialog,
  Button,
  ExpandingLineButton,
  Text,
  XStack,
  YStack,
} from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { useRouter } from 'solito/navigation'
import { store$, deletePreviousUserData, previousAccountBanner$ } from 'app/state/store'
import { deviceState$ } from 'app/state/syncConfig'
import { signOut } from 'app/utils'

export function PreviousAccountBanner() {
  const router = useRouter()
  const banner = use$(previousAccountBanner$)
  const currentUserId = use$(store$.session.userId)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleSignInAsPrevious = useCallback(async () => {
    setBusy(true)
    try {
      const { error } = await signOut()
      if (error) {
        setBusy(false)
        return
      }
      // Only navigate on successful sign-out — and after, since signOut clears
      // session.userId which unmounts this banner. Skip the finally-setBusy to
      // avoid React's "set state on unmounted component" warning.
      router.push('/auth')
    } catch {
      setBusy(false)
    }
  }, [router])

  const handleConfirmDelete = useCallback(() => {
    if (!banner || !currentUserId || busy) {
      setConfirmOpen(false)
      return
    }
    // Defense against a fast account-swap race (banner.previousUserId latched
    // to a session that is no longer current). deletePreviousUserData also
    // refuses self-delete, but bail early so we don't advance lastAuthedUserId
    // on a no-op delete.
    if (banner.previousUserId === currentUserId) {
      setConfirmOpen(false)
      return
    }
    setBusy(true)
    try {
      deletePreviousUserData(banner.previousUserId)
      deviceState$.lastAuthedUserId.set(currentUserId)
      setConfirmOpen(false)
    } finally {
      setBusy(false)
    }
  }, [banner, currentUserId, busy])

  const handleKeepLocal = useCallback(() => {
    if (!banner || !currentUserId) return
    // Per spec matrix row 10: "Keep local" persists acknowledgment keyed on
    // (previousId, currentId). It does NOT advance lastAuthedUserId — only
    // "Delete from this device" (row 11) does. A future different-user sign-in
    // (current → C) produces a new transition key "prev->C" and re-opens the
    // banner; same-user re-sign-in matches the existing ack and stays hidden.
    const transitionKey = `${banner.previousUserId}->${currentUserId}`
    // Legend-State proxy index always resolves to a writable child observable.
    deviceState$.acknowledgedAccountTransitions[transitionKey]!.set(true)
  }, [banner, currentUserId])

  if (!banner) return null

  const { entryCount, flowCount } = banner
  const summary = `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'} and ${flowCount} ${flowCount === 1 ? 'flow' : 'flows'}`

  return (
    <YStack
      testID="previous-account-banner"
      gap="$3"
      padding="$4"
      borderWidth={1}
      borderColor="$color5"
      borderRadius="$4"
      backgroundColor="$color2"
    >
      <Text fontFamily="$body" fontSize={11} textTransform="uppercase" letterSpacing={2} color="$color8">
        Previous Account on This Device
      </Text>
      <Text fontFamily="$body" fontSize={14} color="$color" lineHeight={20}>
        We found {summary} from a different account still stored on this device. Choose what you want to do:
      </Text>
      <YStack gap="$2" alignItems="flex-start">
        <ExpandingLineButton
          size="default"
          disabled={busy}
          onPress={handleSignInAsPrevious}
          accessibilityLabel="Sign out and sign in as the previous account"
        >
          Sign in as previous account
        </ExpandingLineButton>
        <ExpandingLineButton
          size="default"
          disabled={busy}
          onPress={() => setConfirmOpen(true)}
          accessibilityLabel="Delete the previous account's data from this device"
        >
          Delete from this device
        </ExpandingLineButton>
        <ExpandingLineButton
          size="default"
          disabled={busy}
          onPress={handleKeepLocal}
          accessibilityLabel="Keep the previous account's data on this device for now"
        >
          Keep local
        </ExpandingLineButton>
      </YStack>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay
            key="overlay"
            transition="quick"
            opacity={0.4}
            enterStyle={{ opacity: 0 }}
            exitStyle={{ opacity: 0 }}
          />
          <AlertDialog.Content
            key="content"
            testID="previous-account-delete-confirm"
            transition={['medium', { opacity: { overshootClamping: true } }]}
            enterStyle={{ y: -10, opacity: 0 }}
            exitStyle={{ y: 10, opacity: 0 }}
            y={0}
            opacity={1}
            backgroundColor="$background"
            borderRadius="$6"
            borderWidth={1}
            borderColor="$color5"
            padding="$5"
            maxWidth={440}
            width="90%"
          >
            <YStack gap="$4">
              <AlertDialog.Title fontFamily="$body" fontSize="$6" fontWeight="700">
                Delete previous account&apos;s data?
              </AlertDialog.Title>
              <AlertDialog.Description fontFamily="$body" fontSize="$4" color="$color">
                This will permanently remove {summary} from this device. The data will not be uploaded or transferred. This cannot be undone.
              </AlertDialog.Description>
              <XStack gap="$3" justifyContent="flex-end">
                <AlertDialog.Cancel asChild>
                  <Button variant="outlined" fontFamily="$body">
                    Cancel
                  </Button>
                </AlertDialog.Cancel>
                <AlertDialog.Action asChild>
                  <Button
                    onPress={handleConfirmDelete}
                    fontFamily="$body"
                    testID="previous-account-confirm-delete"
                  >
                    Delete
                  </Button>
                </AlertDialog.Action>
              </XStack>
            </YStack>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog>
    </YStack>
  )
}
