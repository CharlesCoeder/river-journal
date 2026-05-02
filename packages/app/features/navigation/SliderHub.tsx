import type { ReactNode } from 'react'
import { Dimensions, Platform } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useRouter, usePathname } from 'solito/navigation'
import { useMedia } from '@my/ui'
import { useReducedMotion } from '@my/ui'
import { computeSliderHubCommit } from './sliderHubUtils'

// Re-export the pure function so consumers can import it from SliderHub
export { computeSliderHubCommit } from './sliderHubUtils'

// ---------------------------------------------------------------------------
// Constants — mirror values from packages/config/src/animations.ts#designEnter
// ---------------------------------------------------------------------------

/** Spring config mirroring the `designEnter` token (stiffness 120, damping 18, mass 1). */
const DESIGN_ENTER_SPRING = { stiffness: 120, damping: 18, mass: 1 }

// ---------------------------------------------------------------------------
// SliderHub component
// ---------------------------------------------------------------------------

interface SliderHubProps {
  children: ReactNode
}

/**
 * Gesture wrapper that intercepts horizontal pan gestures on mobile and
 * dispatches navigation:
 *   - slide right (commit) → router.push('/journal')
 *   - slide left  (commit) → router.push('/menu')
 *
 * On web at the $sm breakpoint (< ~660px) or during SSR, renders a
 * passthrough with no gesture handler.
 *
 * Mounted at `apps/mobile/app/_layout.tsx` (root layout) so every route
 * inherits the gesture wrapper. The route-aware `usePathname()` guard in
 * `navigateTo` short-circuits same-route commits to prevent loops when the
 * current route equals the destination.
 */
export function SliderHub({ children }: SliderHubProps) {
  const media = useMedia()
  const reduceMotion = useReducedMotion()

  // Web-mobile short-circuit (AC #5):
  // • SSR: typeof window === 'undefined' → passthrough (conservative default)
  // • Web $sm breakpoint → passthrough (tap fallbacks only)
  const hasWindow = typeof window !== 'undefined'
  if (Platform.OS === 'web' && (media.sm || !hasWindow)) {
    return <>{children}</>
  }

  return <SliderHubGesture reduceMotion={reduceMotion}>{children}</SliderHubGesture>
}

// Separate inner component so hooks can run unconditionally (Rules of Hooks).
function SliderHubGesture({
  children,
  reduceMotion,
}: {
  children: ReactNode
  reduceMotion: boolean
}) {
  const router = useRouter()
  const currentPathname = usePathname()

  const translateX = useSharedValue(0)
  // Re-entrancy guard: prevent double-push on fast gesture release
  const committing = useSharedValue(false)

  const snapBack = (motion: boolean) => {
    if (motion) {
      translateX.value = withTiming(0, { duration: 100 })
    } else {
      translateX.value = withSpring(0, DESIGN_ENTER_SPRING)
    }
  }

  const navigateTo = (target: '/journal' | '/menu') => {
    if (!router) return
    // Route-aware no-op: if we're already on the target, skip the push
    if (currentPathname === target) {
      committing.value = false
      return
    }
    router.push(target)
    // Reset translateX after navigation (home stays mounted under the pushed screen)
    translateX.value = withSpring(0, DESIGN_ENTER_SPRING, () => {
      committing.value = false
    })
  }

  const pan = Gesture.Pan()
    // Only activate on horizontal motion; fail on vertical to avoid hijacking ScrollView
    .activeOffsetX([-10, 10])
    .failOffsetY([-15, 15])
    .onUpdate((e) => {
      if (committing.value) return
      translateX.value = e.translationX
    })
    .onEnd((e) => {
      if (committing.value) return

      const screenWidth = Dimensions.get('window').width
      const decision = computeSliderHubCommit(e.translationX, e.velocityX, screenWidth)

      if (decision === 'snap-back') {
        snapBack(reduceMotion)
        return
      }

      committing.value = true
      const target = decision === 'right' ? '/journal' : '/menu'
      runOnJS(navigateTo)(target)
    })

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }))

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ flex: 1 }, animatedStyle]} accessible={false}>
        {children}
      </Animated.View>
    </GestureDetector>
  )
}
