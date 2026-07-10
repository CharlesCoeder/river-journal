/**
 * state/onboarding.ts
 *
 * Persisted Legend-State observable for first-launch onboarding.
 * Local-only, per-device UI state — never synced to Supabase, never crosses
 * the encryption boundary. Persistence is wired separately in initializeApp.ts
 * (IndexedDB on web/desktop, MMKV on native), mirroring lapsed$ / deviceState$.
 *
 * WHY this must persist: completion is a permanent, once-only signal — a
 * returning user must NEVER re-see onboarding after finishing (or skipping) it.
 * Storing this on the NON-persisted, resets-on-restart UI-state bucket would
 * make every restart look like a brand-new install and re-show onboarding
 * forever. It is
 * deliberately NOT synced: re-appearing on a fresh device is intended
 * per-device first-experience behavior, not a bug.
 */

import { observable } from '@legendapp/state'

/** Last valid onboarding screen index (0-based). Sequence has 3 screens. */
const LAST_SCREEN = 2

/**
 * `onboarding$` observable — persisted, local-only.
 *
 * - `onboardingCompletedAt`: ISO 8601 timestamp of when onboarding was
 *   completed OR skipped (skip == completion, single-pass). null until then;
 *   once set, the gate never shows onboarding again on this device.
 * - `currentScreen`: 0-based index of the screen the user is currently on,
 *   persisted so a mid-flow close/reopen resumes where they left off. Clamped
 *   to [0, LAST_SCREEN] on write.
 */
export const onboarding$ = observable<{
  onboardingCompletedAt: string | null
  currentScreen: number
}>({
  onboardingCompletedAt: null,
  currentScreen: 0,
})

/**
 * Mark onboarding complete.
 *
 * Idempotent: a no-op if `onboardingCompletedAt` is already set, so a later
 * `Skip` (or a redundant `Get started`) can't clobber the original timestamp.
 * Both the Get started and Skip call sites route through here (skip ==
 * completion), and this guard makes wiring from two sites race-safe.
 *
 * @param now - ISO 8601 timestamp. Defaults to live time. Pass a fixed value for tests.
 */
export function completeOnboarding(now: string = new Date().toISOString()): void {
  if (onboarding$.onboardingCompletedAt.peek() !== null) return
  onboarding$.onboardingCompletedAt.set(now)
}

/**
 * Persist the current onboarding screen index for mid-flow resume.
 *
 * Clamps to [0, LAST_SCREEN] and truncates fractional values, because
 * OnboardingSequence does NOT validate the screen it receives — clamping on
 * write (here) and on read (the gate's initialScreen) guarantees a corrupt
 * persisted value can never render an out-of-range screen.
 *
 * @param screen - Target screen index; clamped and truncated to a valid range.
 */
export function setOnboardingScreen(screen: number): void {
  const clamped = Math.max(0, Math.min(LAST_SCREEN, Math.trunc(screen)))
  onboarding$.currentScreen.set(clamped)
}
