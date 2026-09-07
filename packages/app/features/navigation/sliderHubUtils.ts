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
