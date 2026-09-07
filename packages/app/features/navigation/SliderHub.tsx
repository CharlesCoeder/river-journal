import type { ReactNode } from 'react'
import { Platform, useWindowDimensions } from 'react-native'
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
 * Mounted on the HOME route only (`apps/mobile/app/index.tsx`). Home is the
 * hub; the two slides are its spokes. It must not wrap the root Stack: doing
 * so made every pushed screen a gesture surface, so a swipe back towards home
 * from the menu (or a stray horizontal drag over the editor) committed to the
 * *other* spoke instead of going back. On pushed screens the only horizontal
 * gesture is the native stack back-swipe.
 *
 * The route-aware `usePathname()` guard in `navigateTo` is kept as defence in
 * depth: it short-circuits a commit whose destination equals the current
 * route, so re-mounting this wrapper elsewhere can never push a duplicate.
 */
export function SliderHub({ children }: SliderHubProps) {
  const media = useMedia()
  const reduceMotion = useReducedMotion()

  // Web-mobile short-circuit:
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
  const { width: screenWidth } = useWindowDimensions()

  const translateX = useSharedValue(0)
  // Re-entrancy guard: prevent double-push on fast gesture release
  const committing = useSharedValue(false)

  const snapBack = (motion: boolean) => {
    'worklet'
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
      <Animated.View
        style={[{ flex: 1 }, animatedStyle]}
        accessible={false}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  )
}
