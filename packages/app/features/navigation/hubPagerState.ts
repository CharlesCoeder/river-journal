import { makeMutable } from 'react-native-reanimated'
import { observable } from '@legendapp/state'
import type { HubPagerApi, HubPane } from './hubPagerContext'

/**
 * Shared state between the three parts of the hub pager on native:
 *
 *   HubPager        (home route)  — the pane track; owns the pane and animates it
 *   HubGestureHost  (root layout) — the pan gesture, wrapping the Stack AND the
 *                                   editor overlay so a drag on the WebView counts
 *   PersistentEditor (root layout) — follows the journal pane by a transform
 *
 * The track's position is a shared value so the gesture and the overlay move
 * with it on the UI thread; everything the gesture needs at render time comes
 * through a small observable the pager publishes while home is focused.
 */

/** The track's translateX. 0 = home on screen. */
export const hubPagerX = makeMutable(0)

/**
 * Horizontal offset that puts the persistent editor overlay on the journal
 * pane. 0 when no pager is mounted, so a journal reached as a plain route is
 * unaffected.
 */
export const hubEditorTranslateX = makeMutable(0)

export interface HubGestureConfig {
  /** The pane the track rests on. */
  pane: HubPane
  /** Pane width — one full slide. */
  width: number
  /** Resting translateX of `pane`. */
  restX: number
  /** Where a finger-right slide lands, or null when it means nothing here. */
  right: HubPane | null
  /** Where a finger-left slide lands, or null when it means nothing here. */
  left: HubPane | null
}

/**
 * What the root gesture needs to know about the mounted pager. Null when there
 * is no pager on screen — before home mounts, or while a stack screen covers
 * it — which keeps the gesture inert everywhere but the hub.
 */
export const hubGesture$ = observable<HubGestureConfig | null>(null)

/** The mounted pager, for callers outside its subtree (useNavigateHome, route redirects). */
export const hubPagerController: { current: HubPagerApi | null } = { current: null }

/**
 * A pane asked for from outside the pager. The native journal and menu routes
 * set this and pop to home (see apps/mobile/app/journal/index.tsx); the pager
 * consumes it, so there is only ever one journal on screen.
 */
export const hubPaneRequest$ = observable<HubPane | null>(null)

export function requestHubPane(pane: HubPane): void {
  hubPaneRequest$.set(pane)
}
