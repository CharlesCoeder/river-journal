// @vitest-environment happy-dom
// TDD red-phase: tests written BEFORE implementation of SliderHub.
// All tests in this file should FAIL until packages/app/features/navigation/SliderHub.tsx
// exports the pure `computeSliderHubCommit` function.
//
// Function contract:
//   computeSliderHubCommit(translationX: number, velocityX: number, screenWidth: number)
//     → 'right' | 'left' | 'snap-back'
//
// Commit conditions (both use >= inclusive):
//   Math.abs(translationX) >= screenWidth * 0.25   (displacement threshold)
//   Math.abs(velocityX)    >= 500                  (velocity escape hatch)
// Direction is the sign of the dominant/committed signal.
// When only velocity commits (translation below threshold), direction follows sign of velocityX.
// When translation and velocity have opposed signs, translationX sign is canonical
// (the finger's final position is the intent signal; documented in function header).

import { describe, expect, it } from 'vitest'

// This import WILL FAIL in red-phase — SliderHub.tsx does not yet exist.
import { computeSliderHubCommit } from '../SliderHub'

const SCREEN_WIDTH = 400 // px — a common test device width
const COMMIT_THRESHOLD = SCREEN_WIDTH * 0.25 // 100px

describe('computeSliderHubCommit — displacement threshold (AC #1, #2, #3)', () => {
  it('zero translation + zero velocity → snap-back', () => {
    expect(computeSliderHubCommit(0, 0, SCREEN_WIDTH)).toBe('snap-back')
  })

  it('positive translation exactly at threshold (inclusive) → right (AC #1)', () => {
    expect(computeSliderHubCommit(COMMIT_THRESHOLD, 0, SCREEN_WIDTH)).toBe('right')
  })

  it('positive translation one px above threshold → right', () => {
    expect(computeSliderHubCommit(COMMIT_THRESHOLD + 1, 0, SCREEN_WIDTH)).toBe('right')
  })

  it('positive translation one px below threshold → snap-back (AC #2)', () => {
    expect(computeSliderHubCommit(COMMIT_THRESHOLD - 1, 0, SCREEN_WIDTH)).toBe('snap-back')
  })

  it('negative translation exactly at threshold (inclusive) → left (AC #3)', () => {
    expect(computeSliderHubCommit(-COMMIT_THRESHOLD, 0, SCREEN_WIDTH)).toBe('left')
  })

  it('negative translation one px beyond threshold → left', () => {
    expect(computeSliderHubCommit(-(COMMIT_THRESHOLD + 1), 0, SCREEN_WIDTH)).toBe('left')
  })

  it('negative translation one px below threshold → snap-back (symmetry, AC #2)', () => {
    expect(computeSliderHubCommit(-(COMMIT_THRESHOLD - 1), 0, SCREEN_WIDTH)).toBe('snap-back')
  })

  it('very large positive translation (e.g. full screen width) → right regardless of velocity', () => {
    expect(computeSliderHubCommit(SCREEN_WIDTH, 0, SCREEN_WIDTH)).toBe('right')
  })

  it('very large negative translation → left regardless of velocity', () => {
    expect(computeSliderHubCommit(-SCREEN_WIDTH, 0, SCREEN_WIDTH)).toBe('left')
  })
})

describe('computeSliderHubCommit — velocity escape hatch (AC #1, #3)', () => {
  it('velocity exactly at threshold 500 px/s (inclusive), rightward → right', () => {
    expect(computeSliderHubCommit(10, 500, SCREEN_WIDTH)).toBe('right')
  })

  it('velocity exactly at threshold 500 px/s (inclusive), leftward → left', () => {
    expect(computeSliderHubCommit(-10, -500, SCREEN_WIDTH)).toBe('left')
  })

  it('velocity 499 px/s (below threshold), translation below threshold → snap-back', () => {
    expect(computeSliderHubCommit(50, 499, SCREEN_WIDTH)).toBe('snap-back')
  })

  it('velocity 600 px/s with sub-threshold translation → right (fast flick AC #1)', () => {
    expect(computeSliderHubCommit(50, 600, SCREEN_WIDTH)).toBe('right')
  })

  it('velocity -600 px/s with sub-threshold translation → left (fast flick AC #3)', () => {
    expect(computeSliderHubCommit(-50, -600, SCREEN_WIDTH)).toBe('left')
  })

  it('high velocity but translation already above threshold — displacement wins, same direction', () => {
    // Both signals say right
    expect(computeSliderHubCommit(COMMIT_THRESHOLD + 20, 800, SCREEN_WIDTH)).toBe('right')
  })
})

describe('computeSliderHubCommit — opposed-sign edge cases', () => {
  // translationX and velocityX have opposite signs.
  // Documented rule: translationX sign is canonical (finger's final position is intent).
  it('positive translation above threshold, negative velocity → right (translationX wins)', () => {
    expect(computeSliderHubCommit(COMMIT_THRESHOLD + 10, -600, SCREEN_WIDTH)).toBe('right')
  })

  it('negative translation above threshold, positive velocity → left (translationX wins)', () => {
    expect(computeSliderHubCommit(-(COMMIT_THRESHOLD + 10), 600, SCREEN_WIDTH)).toBe('left')
  })

  it('sub-threshold positive translation, high negative velocity → left (velocity dominates, sign of velocityX)', () => {
    // Only the velocity escape fired; direction follows velocityX sign
    expect(computeSliderHubCommit(50, -600, SCREEN_WIDTH)).toBe('left')
  })

  it('sub-threshold negative translation, high positive velocity → right (velocity dominates, sign of velocityX)', () => {
    expect(computeSliderHubCommit(-50, 600, SCREEN_WIDTH)).toBe('right')
  })
})

describe('computeSliderHubCommit — screen-width parameterisation', () => {
  it('uses screenWidth to compute threshold — different device widths yield correct threshold', () => {
    // iPhone SE width 375: threshold = 93.75px
    expect(computeSliderHubCommit(93, 0, 375)).toBe('snap-back') // below
    expect(computeSliderHubCommit(94, 0, 375)).toBe('right') // at/above (93.75, so 94 >= threshold)
  })

  it('iPad width 1024: threshold = 256px — small pan does not commit', () => {
    expect(computeSliderHubCommit(200, 0, 1024)).toBe('snap-back')
  })

  it('iPad width 1024: pan to 256px commits', () => {
    expect(computeSliderHubCommit(256, 0, 1024)).toBe('right')
  })
})
