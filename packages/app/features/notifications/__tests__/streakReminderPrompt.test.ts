/**
 * Red-phase unit tests for `features/notifications/streakReminderPrompt.ts`.
 *
 * Red-phase contract: every test MUST fail until the target module exists —
 * the whole file fails at the top-level `import { shouldShowStreakReminderPrompt }
 * from '../streakReminderPrompt'` with a module-resolution error, per this
 * repo's established red-phase convention (see `celebrationVariant.test.ts`,
 * `onboarding.test.ts`).
 *
 * Contract locked in for the implementation:
 *
 *   shouldShowStreakReminderPrompt(input: {
 *     platform: string           // Platform.OS value
 *     currentStreak: number
 *     promptSeenAt: string | undefined | null
 *     hasLiveToken: boolean
 *     permissionAlreadyGranted: boolean
 *   }): boolean
 *
 * ALL of the following must hold for `true`:
 *   - platform is 'ios' or 'android' (native only)
 *   - currentStreak === 1 (the first streak day)
 *   - promptSeenAt is unset (null/undefined/empty string)
 *   - hasLiveToken is false
 *   - permissionAlreadyGranted is false — this pure helper stays MODAL-ONLY;
 *     the "OS already granted, no live token" case is a silent-register edge
 *     handled by the gate's effect, not by this decision function (Dev Notes
 *     "How the trigger chains off the CelebrationScreen handoff").
 *
 * Pure function — no observable reads, no I/O, mirrors the
 * `celebrationVariant.ts` / `state/streak.ts` pure-function pattern.
 */

import { describe, expect, it } from 'vitest'
import { shouldShowStreakReminderPrompt } from '../streakReminderPrompt'

const HAPPY_PATH = {
  platform: 'ios',
  currentStreak: 1,
  promptSeenAt: undefined,
  hasLiveToken: false,
  permissionAlreadyGranted: false,
} as const

describe('shouldShowStreakReminderPrompt — happy path', () => {
  it('returns true when all conditions hold on iOS', () => {
    expect(shouldShowStreakReminderPrompt({ ...HAPPY_PATH, platform: 'ios' })).toBe(true)
  })

  it('returns true when all conditions hold on Android', () => {
    expect(shouldShowStreakReminderPrompt({ ...HAPPY_PATH, platform: 'android' })).toBe(true)
  })

  it('treats a null promptSeenAt the same as undefined (unset)', () => {
    expect(shouldShowStreakReminderPrompt({ ...HAPPY_PATH, promptSeenAt: null })).toBe(true)
  })
})

describe('shouldShowStreakReminderPrompt — platform gate', () => {
  it('returns false on web', () => {
    expect(shouldShowStreakReminderPrompt({ ...HAPPY_PATH, platform: 'web' })).toBe(false)
  })

  it('returns false on an unrecognized/desktop platform string', () => {
    expect(shouldShowStreakReminderPrompt({ ...HAPPY_PATH, platform: 'macos' })).toBe(false)
  })

  it('returns false on windows (desktop/Tauri)', () => {
    expect(shouldShowStreakReminderPrompt({ ...HAPPY_PATH, platform: 'windows' })).toBe(false)
  })
})

describe('shouldShowStreakReminderPrompt — streak gate', () => {
  it('returns false when currentStreak is 0', () => {
    expect(shouldShowStreakReminderPrompt({ ...HAPPY_PATH, currentStreak: 0 })).toBe(false)
  })

  it('returns false when currentStreak is 2 (past the first day)', () => {
    expect(shouldShowStreakReminderPrompt({ ...HAPPY_PATH, currentStreak: 2 })).toBe(false)
  })

  it('returns false when currentStreak is a large number (long-established streak)', () => {
    expect(shouldShowStreakReminderPrompt({ ...HAPPY_PATH, currentStreak: 42 })).toBe(false)
  })
})

describe('shouldShowStreakReminderPrompt — once-ever prompt gate', () => {
  it('returns false when promptSeenAt is already set (an ISO timestamp)', () => {
    expect(
      shouldShowStreakReminderPrompt({ ...HAPPY_PATH, promptSeenAt: '2026-07-01T00:00:00.000Z' })
    ).toBe(false)
  })

  it('a currentStreak===1 recurrence after a lapse still returns false once promptSeenAt is set (no re-prompt)', () => {
    expect(
      shouldShowStreakReminderPrompt({
        ...HAPPY_PATH,
        currentStreak: 1,
        promptSeenAt: '2026-01-01T00:00:00.000Z',
      })
    ).toBe(false)
  })
})

describe('shouldShowStreakReminderPrompt — live token gate', () => {
  it('returns false when a live token already exists for the user', () => {
    expect(shouldShowStreakReminderPrompt({ ...HAPPY_PATH, hasLiveToken: true })).toBe(false)
  })
})

describe('shouldShowStreakReminderPrompt — permission-already-granted gate (stays modal-only)', () => {
  it('returns false when permissionAlreadyGranted is true, even though every other condition holds', () => {
    expect(shouldShowStreakReminderPrompt({ ...HAPPY_PATH, permissionAlreadyGranted: true })).toBe(
      false
    )
  })
})

describe('shouldShowStreakReminderPrompt — combined-failure matrix', () => {
  it('returns false when multiple gates fail simultaneously (web + streak !== 1 + already seen)', () => {
    expect(
      shouldShowStreakReminderPrompt({
        platform: 'web',
        currentStreak: 5,
        promptSeenAt: '2026-06-01T00:00:00.000Z',
        hasLiveToken: true,
        permissionAlreadyGranted: true,
      })
    ).toBe(false)
  })

  it('is a pure function — calling it twice with the same input yields the same result (no hidden state)', () => {
    const first = shouldShowStreakReminderPrompt({ ...HAPPY_PATH })
    const second = shouldShowStreakReminderPrompt({ ...HAPPY_PATH })
    expect(first).toBe(second)
    expect(first).toBe(true)
  })
})
