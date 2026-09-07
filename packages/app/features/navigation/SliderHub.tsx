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
import { use$ } from '@legendapp/state/react'
import { ephemeral$, store$ } from 'app/state/store'
import {
  computeSliderHubCommit,
  DEFAULT_HUB_SPOKES,
  normalizeHubPathname,
  resolveSliderHubAction,
  sliderHubDirections,
  type HubSpoke,
} from './sliderHubUtils'

// Re-export the pure helpers so consumers can import them from SliderHub
export {
  computeSliderHubCommit,
  resolveSliderHubAction,
  sliderHubDirections,
  DEFAULT_HUB_SPOKES,
} from './sliderHubUtils'
export type { HubSpoke, SliderHubAction } from './sliderHubUtils'

// ---------------------------------------------------------------------------
// Constants — mirror values from packages/config/src/animations.ts#designEnter
// ---------------------------------------------------------------------------

/** Spring config mirroring the `designEnter` token (stiffness 120, damping 18, mass 1). */
const DESIGN_ENTER_SPRING = { stiffness: 120, damping: 18, mass: 1 }

/** Horizontal travel before the pan activates (vertical drags fail it and scroll instead). */
const ACTIVATION_OFFSET = 10

// ---------------------------------------------------------------------------
// SliderHub component
// ---------------------------------------------------------------------------

interface SliderHubProps {
  children: ReactNode
  /**
   * The destinations home can slide open, and the direction that opens each.
   * Defaults to the v2 model: slide right → /journal, slide left → /menu.
   */
  spokes?: readonly HubSpoke[]
  /** Master switch — e.g. off while the user is writing. Defaults to on. */
  enabled?: boolean
}

/**
 * Route-aware gesture wrapper for the mobile hub-and-spokes navigation.
 *
 *   on '/'        slide right → push the right-opening spoke (/journal)
 *                 slide left  → push the left-opening spoke  (/menu)
 *   on a spoke    the OPPOSITE slide → back to home
 *   anywhere else inert (the native edge back-swipe is all there is)
 *
 * The same slide that opened a screen never means anything else on it, and
 * the reverse slide always closes it — so a swipe back from the menu can no
 * longer be read as a swipe into the editor. On /journal the return slide is
 * only offered while the page is still empty; once there are words, leaving
 * is a deliberate act (Finish Session), and a horizontal drag over text is
 * left to the editor.
 *
 * Mounted at `apps/mobile/app/_layout.tsx` around BOTH the root Stack and the
 * persistent editor overlay, so the editor slides with its screen and a drag
 * that starts on the editor still reaches the hub.
 *
 * On web at the $sm breakpoint (< ~660px) or during SSR, renders a
 * passthrough with no gesture handler.
 */
export function SliderHub({
  children,
  spokes = DEFAULT_HUB_SPOKES,
  enabled = true,
}: SliderHubProps) {
  const media = useMedia()
  const reduceMotion = useReducedMotion()

  // Web-mobile short-circuit:
  // • SSR: typeof window === 'undefined' → passthrough (conservative default)
  // • Web $sm breakpoint → passthrough (tap fallbacks only)
  const hasWindow = typeof window !== 'undefined'
  if (Platform.OS === 'web' && (media.sm || !hasWindow)) {
    return <>{children}</>
  }

  return (
    <SliderHubGesture
      reduceMotion={reduceMotion}
      spokes={spokes}
      enabled={enabled}
    >
      {children}
    </SliderHubGesture>
  )
}

// Separate inner component so hooks can run unconditionally (Rules of Hooks).
function SliderHubGesture({
  children,
  reduceMotion,
  spokes,
  enabled,
}: {
  children: ReactNode
  reduceMotion: boolean
  spokes: readonly HubSpoke[]
  enabled: boolean
}) {
  const router = useRouter()
  const pathname = normalizeHubPathname(usePathname())
  const { width: screenWidth } = useWindowDimensions()

  // Which directions do anything here (see sliderHubDirections).
  const directions = sliderHubDirections(pathname, spokes)

  // Journal spoke: offer the return slide only while nothing has been written.
  // A page with words on it is left via Finish Session, and horizontal drags
  // over text belong to the editor (selection), not to navigation.
  const wordCount = use$(ephemeral$.instantWordCount)
  const activeFlow = use$(store$.activeFlow)
  const editorHasContent = wordCount > 0 || !!activeFlow?.content
  const journalGuard = pathname === '/journal' && editorHasContent

  const allowRight = enabled && !journalGuard && directions.right
  const allowLeft = enabled && !journalGuard && directions.left
  const gestureEnabled = allowRight || allowLeft

  const translateX = useSharedValue(0)
  // Re-entrancy guard: prevent double-navigation on fast gesture release
  const committing = useSharedValue(false)

  const snapBack = (motion: boolean) => {
    'worklet'
    if (motion) {
      translateX.value = withTiming(0, { duration: 100 })
    } else {
      translateX.value = withSpring(0, DESIGN_ENTER_SPRING)
    }
  }

  // JS thread: turn a committed slide into navigation for the current route.
  const commit = (decision: 'right' | 'left') => {
    const action = resolveSliderHubAction(pathname, decision, spokes)
    const settle = () => {
      // Home stays mounted under a pushed spoke, and is revealed by a pop, so
      // the container always returns to rest.
      translateX.value = withSpring(0, DESIGN_ENTER_SPRING, () => {
        committing.value = false
      })
    }

    if (!router || action.type === 'snap-back') {
      settle()
      return
    }
    if (action.type === 'back') {
      router.back()
      settle()
      return
    }
    // Route-aware no-op: never push the route we are already on
    if (pathname === action.route) {
      committing.value = false
      return
    }
    router.push(action.route)
    settle()
  }

  const pan = Gesture.Pan()
    .enabled(gestureEnabled)
    // Only activate on horizontal motion in an allowed direction; fail on
    // vertical to avoid hijacking ScrollViews and the editor's own scrolling.
    .activeOffsetX(
      allowRight && allowLeft
        ? [-ACTIVATION_OFFSET, ACTIVATION_OFFSET]
        : allowRight
          ? ACTIVATION_OFFSET
          : -ACTIVATION_OFFSET
    )
    .failOffsetY([-15, 15])
    .onUpdate((e) => {
      if (committing.value) return
      // Follow the finger, but only in a direction that means something here.
      let x = e.translationX
      if (!allowLeft && x < 0) x = 0
      if (!allowRight && x > 0) x = 0
      translateX.value = x
    })
    .onEnd((e) => {
      if (committing.value) return

      const decision = computeSliderHubCommit(e.translationX, e.velocityX, screenWidth)

      if (decision === 'snap-back') {
        snapBack(reduceMotion)
        return
      }

      committing.value = true
      runOnJS(commit)(decision)
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
