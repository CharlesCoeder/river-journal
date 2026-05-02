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
