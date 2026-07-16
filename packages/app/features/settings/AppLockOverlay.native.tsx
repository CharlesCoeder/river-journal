/**
 * AppLockOverlay.native.tsx — the mobile App Lock gate.
 *
 * A root-level, absolutely-positioned, fully opaque, theme-aware full-screen
 * cover rendered while `ephemeral$.isLocked` is true, so no journal content is
 * visible behind or through it. On appear it prompts biometric / device-
 * credential auth; success clears the lock, failure/cancel keeps the overlay
 * with a "Try again" affordance that re-invokes the prompt. The Android
 * hardware back button / back gesture is intercepted while locked so it cannot
 * dismiss the overlay or navigate out from under it.
 *
 * Mounted in apps/mobile/app/_layout.tsx beside <PersistentEditor /> /
 * <NativeToast /> (siblings of <SliderHub>), so it covers every route.
 */

import { useCallback, useEffect, useState } from 'react'
import { BackHandler } from 'react-native'
import { Text, View, ExpandingLineButton, useTheme } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { ephemeral$ } from '../../state/store'
import { promptAppLockAuth } from 'app/utils/appLockAuth'

export function AppLockOverlay() {
  const isLocked = use$(ephemeral$.isLocked)
  const theme = useTheme()
  const [failed, setFailed] = useState(false)

  const attempt = useCallback(async () => {
    const ok = await promptAppLockAuth()
    if (ok) {
      setFailed(false)
      ephemeral$.isLocked.set(false)
    } else {
      setFailed(true)
    }
  }, [])

  // Prompt automatically whenever the overlay engages (cold start / re-lock).
  useEffect(() => {
    if (isLocked) {
      setFailed(false)
      void attempt()
    }
  }, [isLocked, attempt])

  // Intercept the hardware back button / gesture while locked: returning true
  // tells the OS the event was handled, so it never dismisses the overlay or
  // navigates out from under it.
  useEffect(() => {
    if (!isLocked) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => sub.remove()
  }, [isLocked])

  if (!isLocked) return null

  const backgroundColor = theme.background?.val ?? '#000000'

  return (
    <View
      testID="app-lock-overlay"
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      zIndex={1000}
      backgroundColor={backgroundColor}
      alignItems="center"
      justifyContent="center"
      gap="$6"
      padding="$6"
    >
      <Text
        fontFamily="$journalItalic"
        fontStyle="italic"
        fontSize={24}
        color="$color"
      >
        River Journal is locked
      </Text>
      {failed && (
        <ExpandingLineButton
          size="cta"
          onPress={attempt}
        >
          Try again
        </ExpandingLineButton>
      )}
    </View>
  )
}
