/**
 * DeviceAppearanceToggle — the one switch between "this device's look follows
 * my account" (default) and "keep this look on this device only". Covers
 * theme, custom theme, font pairing and focus mode. Everything else in
 * preferences always follows the account; see state/preferencesSync.ts.
 *
 * Only meaningful with an account, so it renders nothing when signed out.
 */

import { use$ } from '@legendapp/state/react'
import { Text, XStack, YStack, ExpandingLineButton } from '@my/ui'
import { store$ } from 'app/state/store'
import { setAppearanceScope } from 'app/state/preferencesSync'

const LABEL = 'Keep this look on this device only'

export function DeviceAppearanceToggle() {
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const deviceOnly = use$(store$.profile?.appearanceScope) === 'device'

  if (!isAuthenticated) return null

  return (
    <YStack gap="$2">
      <XStack
        justifyContent="space-between"
        alignItems="center"
        gap="$4"
      >
        <Text
          fontFamily="$body"
          fontSize="$4"
          color="$color"
          flexShrink={1}
        >
          {LABEL}
        </Text>
        <ExpandingLineButton
          size="default"
          accessibilityRole="switch"
          accessibilityState={{ checked: deviceOnly }}
          accessibilityLabel={LABEL}
          onPress={() => setAppearanceScope(deviceOnly ? 'account' : 'device')}
        >
          {deviceOnly ? 'On' : 'Off'}
        </ExpandingLineButton>
      </XStack>
      <Text
        fontFamily="$body"
        fontSize={13}
        color="$color8"
      >
        {deviceOnly
          ? 'Theme, font and focus mode here stay on this device. Turn off to use your account’s look again.'
          : 'Theme, font and focus mode follow your account across devices.'}
      </Text>
    </YStack>
  )
}

export default DeviceAppearanceToggle
