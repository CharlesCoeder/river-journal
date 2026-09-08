import { createContext, useContext, type ReactNode } from 'react'
import type { HubSpoke } from './sliderHubUtils'

/** A pane of the hub pager: '/' for home, or a spoke's route. */
export type HubPane = string

export interface HubPagerApi {
  /** The pane the pager is resting on, or heading to. */
  pane: HubPane
  /** Bring a pane on screen. Animated unless told otherwise. */
  goTo: (pane: HubPane, options?: { animated?: boolean }) => void
}

export interface HubPagerProps {
  /** The pane order: which slide opens which spoke from home. */
  spokes?: readonly HubSpoke[]
  /** Home — the centre pane. */
  home: ReactNode
  /** The spoke panes, keyed by route. */
  panes: Record<string, ReactNode>
  /** Panes the gesture may not leave (the journal once it has words). */
  lockedPanes?: readonly string[]
  /** Master switch for the gesture. Defaults to on. */
  enabled?: boolean
  /** Fires when the pager comes to rest on a pane. */
  onSettle?: (pane: HubPane) => void
  /** Fires as the pager starts to leave a pane, before the move. */
  onLeavePane?: (pane: HubPane) => void
}

/**
 * Provided by HubPager (native) around home and its spokes. Screens that live
 * both inside the pager and as plain routes — home, the journal, the menu —
 * read it to choose between sliding a pane and pushing a route. `null` means
 * "not in a pager" (web, or a stack route) and the router is the way.
 */
export const HubPagerContext = createContext<HubPagerApi | null>(null)

export function useHubPager(): HubPagerApi | null {
  return useContext(HubPagerContext)
}
