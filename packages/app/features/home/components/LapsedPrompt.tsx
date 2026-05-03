/**
 * LapsedPrompt.tsx
 *
 * Inline lapsed-user prompt — "Want to start again?"
 *
 * Renders nothing when shouldShow === false.
 * When visible: calm Newsreader serif body text, dismissible on tap.
 *
 * AC4: mounted as third child of inner YStack gap={96} on HomeScreen,
 * between the date block and the action XStack.
 *
 * AC7: NO modal, dialog, sheet, toast, badge, icon, or animation token.
 * Pure typography only.
 *
 * AC8: accessibilityRole="button", accessibilityLabel includes dismissal affordance.
 */
// Stub — renders nothing, so tests for the visible state will fail meaningfully.
// Full implementation will replace this in the green phase.

import { Text } from '@my/ui'
import { useLapsedPrompt } from '../useLapsedPrompt'

export function LapsedPrompt() {
  const { shouldShow, dismiss } = useLapsedPrompt()

  if (!shouldShow) {
    return null
  }

  return (
    <Text
      fontFamily="$journal"
      fontSize={20}
      $sm={{ fontSize: 18 }}
      color="$color"
      cursor="pointer"
      onPress={dismiss}
      role="button"
      aria-label="Want to start again? Tap to dismiss."
      testID="lapsed-prompt"
    >
      Want to start again?
    </Text>
  )
}
