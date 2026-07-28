'use client'

/**
 * AppLockOverlay.web.tsx — the web/desktop App Lock gate.
 *
 * A root-level, fully opaque, theme-aware full-screen cover rendered while
 * `ephemeral$.isLocked` is true, so no journal content shows behind it. Prompts
 * for the app-level passcode; on submit it re-derives the key and checks the
 * stored verifier (see state/appLock.ts) — a match clears the lock, a mismatch
 * keeps the overlay with a "Try again" affordance. Fully keyboard-operable.
 *
 * Mounted at the web/desktop app root so it covers all routes. Each tab/window
 * locks/unlocks independently (per-document ephemeral state).
 */

import { useCallback, useState } from 'react'
import { Input, Text, View, ExpandingLineButton } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { ephemeral$ } from '../../state/store'
import { verifyPasscode } from '../../state/appLock'

export function AppLockOverlay() {
  const isLocked = use$(ephemeral$.isLocked)
  const [passcode, setPasscode] = useState('')
  const [failed, setFailed] = useState(false)

  const submit = useCallback(async () => {
    const ok = await verifyPasscode(passcode)
    if (ok) {
      setPasscode('')
      setFailed(false)
      ephemeral$.isLocked.set(false)
    } else {
      setFailed(true)
    }
  }, [passcode])

  if (!isLocked) return null

  return (
    <View
      testID="app-lock-overlay"
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      zIndex={1000}
      backgroundColor="$background"
      alignItems="center"
      justifyContent="center"
      gap="$5"
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
      <Input
        testID="app-lock-unlock-passcode-input"
        value={passcode}
        onChangeText={setPasscode}
        onSubmitEditing={submit}
        secureTextEntry
        placeholder="Enter passcode"
        width="100%"
        maxWidth={320}
      />
      <ExpandingLineButton
        size="cta"
        testID="app-lock-unlock-submit"
        onPress={submit}
      >
        {failed ? 'Try again' : 'Unlock'}
      </ExpandingLineButton>
    </View>
  )
}
