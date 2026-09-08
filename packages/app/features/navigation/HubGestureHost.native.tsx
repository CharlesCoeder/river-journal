import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import {
  cancelAnimation,
  runOnJS,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useReducedMotion } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { hubGesture$, hubPagerController, hubPagerX } from './hubPagerState'
import {
  computeSliderHubCommit,
  HUB_ACTIVATION_OFFSET,
  HUB_FAIL_OFFSET_Y,
  HUB_SPRING,
  hubPagerDragX,
} from './sliderHubUtils'

/**
 * The hub pager's pan, mounted at the root layout around BOTH the Stack and
 * the persistent editor overlay, so a drag that starts on the WebView still
 * moves the hub. It only follows the finger toward a pane that exists from
 * where the track rests, and on release either commits to that pane or
 * springs back — HubPager (in the home route) owns the pane and the track.
 *
 * Inert whenever HubPager is not on screen (nothing published), so screens
 * pushed above home keep their own gestures.
 */
export function HubGestureHost({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion()
  const config = use$(hubGesture$)
  const startX = useSharedValue(0)

  const allowRight = config?.right != null
  const allowLeft = config?.left != null
  const enabled = allowRight || allowLeft
  const width = config?.width ?? 1
  const restX = config?.restX ?? 0
  const rightPane = config?.right ?? null
  const leftPane = config?.left ?? null

  // JS thread: turn a committed slide into the pane it lands on.
  const commit = (decision: 'right' | 'left') => {
    const next = decision === 'right' ? rightPane : leftPane
    if (next) hubPagerController.current?.goTo(next)
  }

  const pan = Gesture.Pan()
    .enabled(enabled)
    // Only activate on horizontal motion in a direction that means something
    // here; fail on vertical so scroll views and the editor keep their drags.
    .activeOffsetX(
      allowRight && allowLeft
        ? [-HUB_ACTIVATION_OFFSET, HUB_ACTIVATION_OFFSET]
        : allowRight
          ? HUB_ACTIVATION_OFFSET
          : -HUB_ACTIVATION_OFFSET
    )
    .failOffsetY([-HUB_FAIL_OFFSET_Y, HUB_FAIL_OFFSET_Y])
    .onStart(() => {
      // A finger landing mid-spring takes over from wherever the track is.
      cancelAnimation(hubPagerX)
      startX.value = hubPagerX.value
    })
    .onUpdate((e) => {
      hubPagerX.value = hubPagerDragX(
        startX.value,
        e.translationX,
        restX,
        { right: allowRight, left: allowLeft },
        width
      )
    })
    .onEnd((e) => {
      // Decide on where the track IS relative to rest, not on this gesture's
      // travel alone, so a slide picked up mid-spring commits sensibly.
      const decision = computeSliderHubCommit(hubPagerX.value - restX, e.velocityX, width)
      if (decision === 'snap-back') {
        hubPagerX.value = reduceMotion
          ? withTiming(restX, { duration: 100 })
          : withSpring(restX, HUB_SPRING)
        return
      }
      runOnJS(commit)(decision)
    })

  return (
    <GestureDetector gesture={pan}>
      <View
        style={styles.host}
        accessible={false}
      >
        {children}
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  host: { flex: 1 },
})
