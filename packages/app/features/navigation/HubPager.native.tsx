import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BackHandler,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native'
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useFocusEffect } from 'expo-router'
import { useReducedMotion } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import {
  HubPagerContext,
  type HubPagerApi,
  type HubPagerProps,
  type HubPane,
} from './hubPagerContext'
import {
  hubEditorTranslateX,
  hubGesture$,
  hubPagerController,
  hubPagerX,
  hubPaneRequest$,
} from './hubPagerState'
import {
  DEFAULT_HUB_SPOKES,
  HUB_SPRING,
  hubPagerDestination,
  hubPagerTargetX,
  hubPaneSlot,
  sliderHubDirections,
} from './sliderHubUtils'

export type { HubPagerProps } from './hubPagerContext'

/**
 * The hub as one horizontal surface: home in the middle, each spoke mounted
 * one pane to the side it slides in from. A slide moves the real screens, so
 * the neighbour is under the finger from the first pixel and letting go only
 * settles the track — nothing is created after the gesture.
 *
 *   on home     finger right → the journal pane (left of home) slides in
 *               finger left  → the menu pane (right of home) slides in
 *   on a spoke  the reverse slide returns home; the same slide is inert
 *
 * Everything deeper — settings, past entries, the celebration — is still a
 * stack push above the whole pager, and popping lands on whichever pane you
 * left, as a stack should.
 *
 * The pan itself lives in HubGestureHost at the root layout, wrapping the
 * Stack and the persistent editor overlay, so a drag that starts on the
 * WebView still moves the hub. This component owns the pane, animates the
 * track, and publishes what the gesture needs while home is focused.
 */
export function HubPager({
  spokes = DEFAULT_HUB_SPOKES,
  home,
  panes,
  lockedPanes,
  enabled = true,
  onSettle,
  onLeavePane,
}: HubPagerProps) {
  const reduceMotion = useReducedMotion()
  const { width: windowWidth } = useWindowDimensions()
  const [measuredWidth, setMeasuredWidth] = useState(0)
  const width = measuredWidth || windowWidth
  const widthRef = useRef(width)
  widthRef.current = width

  const [pane, setPane] = useState<HubPane>('/')
  const paneRef = useRef(pane)
  const [focused, setFocused] = useState(false)

  const onSettleRef = useRef(onSettle)
  onSettleRef.current = onSettle
  const onLeavePaneRef = useRef(onLeavePane)
  onLeavePaneRef.current = onLeavePane

  const settle = useCallback((settled: HubPane) => {
    onSettleRef.current?.(settled)
  }, [])

  const goTo = useCallback(
    (next: HubPane, options?: { animated?: boolean }) => {
      const animated = options?.animated ?? true
      const current = paneRef.current
      if (current !== next) onLeavePaneRef.current?.(current)
      paneRef.current = next
      setPane(next)

      const target = hubPagerTargetX(next, spokes, widthRef.current)
      cancelAnimation(hubPagerX)
      if (!animated) {
        hubPagerX.value = target
        settle(next)
        return
      }
      const finish = (finished?: boolean) => {
        'worklet'
        if (finished) runOnJS(settle)(next)
      }
      hubPagerX.value = reduceMotion
        ? withTiming(target, { duration: 100 }, finish)
        : withSpring(target, HUB_SPRING, finish)
    },
    [spokes, reduceMotion, settle]
  )

  const api = useMemo<HubPagerApi>(() => ({ pane, goTo }), [pane, goTo])

  // Reachable from outside the subtree: useNavigateHome, the route redirects.
  useEffect(() => {
    hubPagerController.current = api
    return () => {
      if (hubPagerController.current === api) hubPagerController.current = null
    }
  }, [api])

  // A pane asked for by a native route that now lives here (deep links, the
  // "write" links on other screens): jump there under the closing screen.
  const requested = use$(hubPaneRequest$)
  useEffect(() => {
    if (!requested) return
    hubPaneRequest$.set(null)
    goTo(requested, { animated: false })
  }, [requested, goTo])

  // Only a focused hub answers to the gesture and the Android back button —
  // a screen pushed above home must get both.
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        if (paneRef.current === '/') return false
        goTo('/')
        return true
      })
      return () => {
        setFocused(false)
        back.remove()
      }
    }, [goTo])
  )

  // Publish what the root gesture needs for this pane.
  const locked = !enabled || (lockedPanes?.includes(pane) ?? false)
  useEffect(() => {
    if (!focused) {
      hubGesture$.set(null)
      return
    }
    const directions = sliderHubDirections(pane, spokes)
    hubGesture$.set({
      pane,
      width,
      restX: hubPagerTargetX(pane, spokes, width),
      right: !locked && directions.right ? hubPagerDestination(pane, 'right', spokes) : null,
      left: !locked && directions.left ? hubPagerDestination(pane, 'left', spokes) : null,
    })
  }, [focused, pane, spokes, width, locked])
  useEffect(() => () => hubGesture$.set(null), [])

  // The editor overlay belongs to the journal pane: keep its offset in step
  // with the track. With no journal spoke the slot is 0 and it rides with
  // home. Only while home is focused — a screen pushed above it (a journal
  // reached from Past Entries, say) owns the overlay then and must find it
  // at rest.
  const journalSlot = hubPaneSlot('/journal', spokes)
  useAnimatedReaction(
    () => hubPagerX.value,
    (x) => {
      hubEditorTranslateX.value = focused ? journalSlot * width + x : 0
    },
    [journalSlot, width, focused]
  )
  useEffect(() => {
    hubEditorTranslateX.value = focused ? journalSlot * width + hubPagerX.value : 0
    return () => {
      hubEditorTranslateX.value = 0
    }
  }, [journalSlot, width, focused])

  // A width change (rotation) moves every resting position: re-seat the track.
  useEffect(() => {
    cancelAnimation(hubPagerX)
    hubPagerX.value = hubPagerTargetX(paneRef.current, spokes, width)
  }, [width, spokes])

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: hubPagerX.value }],
  }))

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width)
    if (next > 0) setMeasuredWidth(next)
  }, [])

  const slots: Array<{ route: HubPane; node: React.ReactNode }> = [
    { route: '/', node: home },
    ...spokes.map((spoke) => ({ route: spoke.route, node: panes[spoke.route] ?? null })),
  ]

  return (
    <HubPagerContext.Provider value={api}>
      <View
        style={styles.viewport}
        onLayout={handleLayout}
      >
        <Animated.View style={[StyleSheet.absoluteFill, trackStyle]}>
          {slots.map(({ route, node }) => {
            const offscreen = route !== pane
            return (
              <View
                key={route}
                style={[styles.pane, { left: hubPaneSlot(route, spokes) * width, width }]}
                // Off-screen panes stay mounted but out of the accessibility tree.
                accessibilityElementsHidden={offscreen}
                importantForAccessibility={offscreen ? 'no-hide-descendants' : 'auto'}
              >
                {node}
              </View>
            )
          })}
        </Animated.View>
      </View>
    </HubPagerContext.Provider>
  )
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    overflow: 'hidden',
  },
  pane: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
})
