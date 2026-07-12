/**
 * StreakReminderPermissionGate — the calm, once-ever streak-reminder permission
 * prompt (mobile only).
 *
 * Mounted in the shared `HomeScreen` alongside `ModerationReceiptGate`, so it
 * re-evaluates on every home landing — including the one the CelebrationScreen
 * handoff routes back to after the user's first >=500-word flow of the day.
 * Renders `null` on any non-native platform (web/desktop get the no-op stub and
 * the web/desktop in-app reminder fallback instead).
 *
 * Trigger (all must hold, via the pure `shouldShowStreakReminderPrompt`):
 * native, `currentStreak === 1`, prompt not yet answered, no live token, and OS
 * permission not already granted. The "OS already granted, no live token" edge
 * is handled separately here — silently register (no modal), then mark the
 * prompt seen — keeping the pure decision modal-only.
 *
 * Enable → request+register, always mark seen; set the deny cooldown ONLY on a
 * `denied` outcome (never on `granted` / `granted-no-token`). Not now → mark
 * seen only (no native call, no cooldown). Enable is guarded against a fast
 * double-tap firing two registrations.
 */

import { useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { use$ } from '@legendapp/state/react'
import { Dialog, Text, XStack, YStack, ExpandingLineButton, useReducedMotion } from '@my/ui'
import { store$ } from 'app/state/store'
import { pushTokens$ } from 'app/state/push_tokens'
import type { StreakState } from 'app/state/streak'
import { getPushPermissionStatus, requestAndRegisterPushToken } from 'app/utils/pushTokens'
import { shouldShowStreakReminderPrompt } from './streakReminderPrompt'
import {
  hasSeenStreakPrompt,
  markStreakPromptSeen,
  setPushPermissionDenied,
} from './reminderPreferences'

const PROMPT_COPY = 'Want a daily reminder to write? You can change this anytime in Preferences.'

function isNativePlatform(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android'
}

function currentUserHasLiveToken(userId: string | null): boolean {
  if (!userId) return false
  const rows = pushTokens$.peek() ?? {}
  return Object.values(rows).some((row: { userId?: string } | undefined) => row?.userId === userId)
}

export function StreakReminderPermissionGate() {
  // Subscribe to the whole function-shaped streak computed (sub-field
  // subscriptions on function-shaped computeds are unsupported).
  const streak = use$(store$.views.streak) as StreakState | undefined
  const currentStreak = streak?.currentStreak ?? 0

  const [showModal, setShowModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    // No async work off-native — the whole surface is mobile-only.
    if (!isNativePlatform()) return
    // Synchronous pre-gates (cheap, avoid an async permission read when the
    // prompt clearly should not fire).
    if (currentStreak !== 1) return
    if (hasSeenStreakPrompt()) return
    const userId = store$.session.userId.peek()
    const hasLiveToken = currentUserHasLiveToken(userId)
    if (hasLiveToken) return

    let cancelled = false
    void (async () => {
      const status = await getPushPermissionStatus()
      if (cancelled) return
      const permissionAlreadyGranted = status === 'granted'

      if (permissionAlreadyGranted) {
        // Silent-register edge: nothing to ask (OS already granted) but no live
        // token — register directly, no modal, then mark the prompt answered.
        await requestAndRegisterPushToken()
        if (cancelled) return
        markStreakPromptSeen()
        return
      }

      if (
        shouldShowStreakReminderPrompt({
          platform: Platform.OS,
          currentStreak,
          promptSeenAt: undefined,
          hasLiveToken,
          permissionAlreadyGranted,
        })
      ) {
        setShowModal(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [currentStreak])

  const handleEnable = async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const result = await requestAndRegisterPushToken()
      markStreakPromptSeen()
      if (result.outcome === 'denied') {
        setPushPermissionDenied()
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
      setShowModal(false)
    }
  }

  const handleNotNow = () => {
    markStreakPromptSeen()
    setShowModal(false)
  }

  if (!showModal) return null

  const animationToken = reducedMotion ? undefined : 'quick'

  return (
    <Dialog
      open
      onOpenChange={() => {
        // No-op: the prompt is answered via the explicit Enable / Not now
        // buttons, never a tap-outside / Esc dismiss.
      }}
      modal
    >
      <Dialog.Portal>
        <Dialog.Overlay
          key="overlay"
          backgroundColor="$shadow6"
          animation={animationToken}
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
        />
        <Dialog.Content
          key="content"
          gap="$3"
          padding="$4"
          maxWidth={420}
          width="90%"
          backgroundColor="$background"
          borderColor="$color3"
          borderWidth={1}
          animation={animationToken}
        >
          <Dialog.Title
            fontSize="$5"
            fontFamily="$body"
          >
            Daily reminder
          </Dialog.Title>

          <YStack gap="$2">
            <Text
              fontSize="$3"
              color="$color12"
            >
              {PROMPT_COPY}
            </Text>
          </YStack>

          <XStack
            gap="$3"
            justifyContent="flex-end"
            marginTop="$3"
          >
            <ExpandingLineButton
              size="cta"
              onPress={handleNotNow}
              disabled={submitting}
            >
              Not now
            </ExpandingLineButton>
            <ExpandingLineButton
              size="cta"
              onPress={handleEnable}
              disabled={submitting}
            >
              Enable
            </ExpandingLineButton>
          </XStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export default StreakReminderPermissionGate
