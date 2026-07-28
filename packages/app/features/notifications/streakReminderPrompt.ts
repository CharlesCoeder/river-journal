/**
 * streakReminderPrompt.ts
 *
 * Pure decision helper for the once-ever streak-reminder permission prompt.
 *
 * The modal is shown only when ALL of the following hold:
 *  1. The platform is native (`ios` or `android`) — never web/desktop.
 *  2. `currentStreak === 1` — the first streak day just completed.
 *  3. `promptSeenAt` is unset — the one-time in-app ask has not been answered.
 *  4. `hasLiveToken` is false — no live token is already registered for the user.
 *  5. `permissionAlreadyGranted` is false — this helper stays MODAL-ONLY. The
 *     "OS already granted, no live token" case is a silent-register edge handled
 *     by the gate's effect, NOT by this decision function (there is nothing to
 *     ask when the OS has already granted, so no modal is surfaced).
 *
 * Pure function — no observable reads, no I/O, no side effects. Mirrors the
 * `celebrationVariant.ts` / `state/streak.ts` pure-function-then-consumer pattern.
 */

export interface ShouldShowStreakReminderPromptInput {
  /** `Platform.OS` value. */
  platform: string
  currentStreak: number
  /** ISO timestamp the one-time ask was answered, or null/undefined if unanswered. */
  promptSeenAt: string | undefined | null
  /** True when a live (non-deleted) push token already exists for the user. */
  hasLiveToken: boolean
  /** True when the OS has already granted notification permission. */
  permissionAlreadyGranted: boolean
}

const NATIVE_PLATFORMS = new Set(['ios', 'android'])

export function shouldShowStreakReminderPrompt({
  platform,
  currentStreak,
  promptSeenAt,
  hasLiveToken,
  permissionAlreadyGranted,
}: ShouldShowStreakReminderPromptInput): boolean {
  if (!NATIVE_PLATFORMS.has(platform)) return false
  if (currentStreak !== 1) return false
  if (promptSeenAt) return false
  if (hasLiveToken) return false
  // Modal-only: when the OS has already granted, the gate silently registers
  // instead of surfacing a modal (there is nothing to ask).
  if (permissionAlreadyGranted) return false
  return true
}
