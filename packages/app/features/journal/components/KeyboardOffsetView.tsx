import type { ReactNode } from 'react'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { useKeyboardHandler } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * Absolute overlay that translates upward in sync with the keyboard,
 * driven entirely on the UI thread via Reanimated shared values.
 *
 * Children using position:absolute will position relative to this
 * overlay (which fills its parent), so they move with the keyboard.
 */
export function KeyboardOffsetView({ children }: { children: ReactNode }) {
  const keyboardHeight = useSharedValue(0)
  const insets = useSafeAreaInsets()

  useKeyboardHandler(
    {
      onMove: (e) => {
        'worklet'
        keyboardHeight.value = e.height
      },
    },
    []
  )

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboardHeight.value - insets.bottom) }],
  }))

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          pointerEvents: 'box-none',
        },
        animatedStyle,
      ]}
    >
      {children}
    </Animated.View>
  )
}
