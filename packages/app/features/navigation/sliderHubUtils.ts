/**
 * Commit threshold: fraction of screen width that constitutes a committed pan gesture.
 */
export const COMMIT_THRESHOLD_RATIO = 0.25

/**
 * Velocity escape hatch: px/s above which a pan commits regardless of displacement.
 */
export const VELOCITY_THRESHOLD = 500

/**
 * Decides the outcome of a pan gesture release.
 *
 * Commit conditions (both use >= inclusive for left/right symmetry):
 *   Math.abs(translationX) >= screenWidth * COMMIT_THRESHOLD_RATIO  (displacement)
 *   Math.abs(velocityX)    >= VELOCITY_THRESHOLD                    (velocity escape)
 *
 * Direction rules:
 *   - If displacement commits → direction follows sign of translationX (finger's
 *     final position is the canonical intent signal, even when velocity opposes it).
 *   - If only velocity commits → direction follows sign of velocityX.
 *   - Otherwise → 'snap-back'.
 */
export function computeSliderHubCommit(
  translationX: number,
  velocityX: number,
  screenWidth: number
): 'right' | 'left' | 'snap-back' {
  'worklet'
  const displacementThreshold = screenWidth * COMMIT_THRESHOLD_RATIO
  const displacementCommits = Math.abs(translationX) >= displacementThreshold
  const velocityCommits = Math.abs(velocityX) >= VELOCITY_THRESHOLD

  if (displacementCommits) {
    return translationX > 0 ? 'right' : 'left'
  }

  if (velocityCommits) {
    return velocityX > 0 ? 'right' : 'left'
  }

  return 'snap-back'
}

// ---------------------------------------------------------------------------
// Route-aware hub — home is the hub, the two slides are its spokes.
// ---------------------------------------------------------------------------

/**
 * A destination reachable from home by a horizontal slide. `open` is the
 * finger direction that opens it from home; the opposite direction, performed
 * on the spoke itself, returns home. Spatially: a spoke opened by sliding
 * right lives "to the left" of home, and vice versa.
 */
export interface HubSpoke {
  readonly route: string
  readonly open: 'right' | 'left'
}

/** v2 model: slide right = write, slide left = menu. */
export const DEFAULT_HUB_SPOKES: readonly HubSpoke[] = [
  { route: '/journal', open: 'right' },
  { route: '/menu', open: 'left' },
]

export type SliderHubAction =
  | { type: 'push'; route: string }
  | { type: 'back' }
  | { type: 'snap-back' }

const opposite = (direction: 'right' | 'left'): 'right' | 'left' =>
  direction === 'right' ? 'left' : 'right'

/** Strip a trailing slash so '/menu/' and '/menu' are the same spoke. */
export function normalizeHubPathname(pathname: string | null | undefined): string {
  if (!pathname) return '/'
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

/**
 * Which finger directions mean something on this route:
 *   home  → the directions that open a configured spoke
 *   spoke → only the return direction (opposite of the one that opened it)
 *   other → none (the hub is inert; the native back-swipe is all there is)
 */
export function sliderHubDirections(
  pathname: string | null | undefined,
  spokes: readonly HubSpoke[] = DEFAULT_HUB_SPOKES
): { right: boolean; left: boolean } {
  const path = normalizeHubPathname(pathname)
  if (path === '/') {
    return {
      right: spokes.some((s) => s.open === 'right'),
      left: spokes.some((s) => s.open === 'left'),
    }
  }
  const spoke = spokes.find((s) => s.route === path)
  if (!spoke) return { right: false, left: false }
  const back = opposite(spoke.open)
  return { right: back === 'right', left: back === 'left' }
}

/**
 * Resolves a committed slide on `pathname` into navigation. Home opens the
 * matching spoke; a spoke returns home on the opposite slide; anything else
 * (including the "wrong" direction on a spoke) snaps back and does nothing.
 * The two gestures never gain a third meaning.
 */
export function resolveSliderHubAction(
  pathname: string | null | undefined,
  decision: 'right' | 'left' | 'snap-back',
  spokes: readonly HubSpoke[] = DEFAULT_HUB_SPOKES
): SliderHubAction {
  if (decision === 'snap-back') return { type: 'snap-back' }
  const path = normalizeHubPathname(pathname)
  if (path === '/') {
    const spoke = spokes.find((s) => s.open === decision)
    return spoke ? { type: 'push', route: spoke.route } : { type: 'snap-back' }
  }
  const spoke = spokes.find((s) => s.route === path)
  if (spoke && opposite(spoke.open) === decision) return { type: 'back' }
  return { type: 'snap-back' }
}

// ---------------------------------------------------------------------------
// Hub pager — the spokes are mounted beside home, so a slide moves the real
// screens and there is nothing to fill in after the finger lifts.
// ---------------------------------------------------------------------------

/** Spring for the pager coming to rest — mirrors the `designEnter` token. */
export const HUB_SPRING = { stiffness: 120, damping: 18, mass: 1 }

/** Horizontal travel before the pan activates (vertical drags fail it and scroll instead). */
export const HUB_ACTIVATION_OFFSET = 10

/** Vertical travel that fails the pan, leaving the drag to scroll views and the editor. */
export const HUB_FAIL_OFFSET_Y = 15

/**
 * Where a pane sits relative to home, in pane widths. A spoke opened by sliding
 * right lives one pane to the LEFT of home (-1); one opened by sliding left
 * lives to the RIGHT (+1). Home, and anything that is not a spoke, is 0.
 */
export function hubPaneSlot(
  pane: string | null | undefined,
  spokes: readonly HubSpoke[] = DEFAULT_HUB_SPOKES
): -1 | 0 | 1 {
  const path = normalizeHubPathname(pane)
  if (path === '/') return 0
  const spoke = spokes.find((s) => s.route === path)
  if (!spoke) return 0
  return spoke.open === 'right' ? -1 : 1
}

/** The track's resting translateX that brings `pane` on screen. */
export function hubPagerTargetX(
  pane: string | null | undefined,
  spokes: readonly HubSpoke[],
  width: number
): number {
  const slot = hubPaneSlot(pane, spokes)
  return slot === 0 ? 0 : -slot * width
}

/**
 * Where the track sits while the finger is down: wherever it was when the
 * finger landed plus the drag, but never past the resting position of the
 * current pane in a direction that means nothing here, and never more than
 * one pane away from it.
 */
export function hubPagerDragX(
  startX: number,
  translationX: number,
  restX: number,
  allow: { right: boolean; left: boolean },
  width: number
): number {
  'worklet'
  const min = allow.left ? restX - width : restX
  const max = allow.right ? restX + width : restX
  const x = startX + translationX
  if (x < min) return min
  if (x > max) return max
  return x
}

/**
 * The pane a committed slide on `pane` lands on — home opens the matching
 * spoke, a spoke returns home on its reverse slide, and anything else stays
 * put (returns `pane` itself).
 */
export function hubPagerDestination(
  pane: string | null | undefined,
  decision: 'right' | 'left' | 'snap-back',
  spokes: readonly HubSpoke[] = DEFAULT_HUB_SPOKES
): string {
  const action = resolveSliderHubAction(pane, decision, spokes)
  if (action.type === 'push') return action.route
  if (action.type === 'back') return '/'
  return normalizeHubPathname(pane)
}
