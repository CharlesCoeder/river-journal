/**
 * UnlockNotification.tsx
 *
 * Renders inside the CelebrationScreen handoff variant when the user has
 * earned a new unlock token that hasn't been surfaced yet.
 *
 * Props-based: no observable reads, no store imports. Receives `onChooseTheme`
 * as a callback so the parent (CelebrationScreen) owns the navigation side-effect.
 *
 * Animation: entrance uses `celebrationSpring` by default (stiffness 80, damping 20).
 * Pass `enterTransition="100ms"` from the parent when prefers-reduced-motion is true,
 * so reduced-motion handling stays at the call-site and this component stays testable
 * without mocking `useReducedMotion`.
 *
 * Animation tokens degrade to `100ms` tween under prefers-reduced-motion (AC 15);
 * the parent CelebrationScreen passes the correct token via `enterTransition`.
 */

import { AnimatePresence, ExpandingLineButton, Text, YStack } from '@my/ui'

export interface UnlockNotificationProps {
  onChooseTheme: () => void
  /** Animation token for entrance. Defaults to 'celebrationSpring'. Pass '100ms' when reduced motion is on. */
  enterTransition?: string
}

export function UnlockNotification({
  onChooseTheme,
  enterTransition = 'celebrationSpring',
}: UnlockNotificationProps) {
  return (
    <AnimatePresence>
      <YStack
        key="unlock-notification"
        transition={enterTransition as any}
        enterStyle={{ opacity: 0, y: 20 }}
        opacity={1}
        y={0}
        gap="$3"
        alignItems="center"
      >
        <Text
          fontFamily="$body"
          fontSize={14}
          color="$color"
          letterSpacing={0.5}
        >
          You've earned an unlock — choose a theme.
        </Text>
        <ExpandingLineButton
          size="default"
          onPress={onChooseTheme}
        >
          Choose theme
        </ExpandingLineButton>
      </YStack>
    </AnimatePresence>
  )
}
