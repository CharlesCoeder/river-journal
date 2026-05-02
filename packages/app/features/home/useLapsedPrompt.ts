/**
 * useLapsedPrompt.ts
 *
 * Hook that computes whether the lapsed-user prompt should be shown,
 * and returns a dismiss action.
 *
 * Returns `{ shouldShow: boolean; dismiss: () => void }`.
 *
 * `shouldShow === true` IFF ALL of:
 *   1. `hasOpenedBefore === true` (not a first-time user — epics.md:902-904)
 *   2. `lastSessionAt !== null` AND `(now - lastSessionAt) > LAPSED_THRESHOLD_MS` (strict >)
 *   3. `dismissedAt === null` OR `dismissedAt < lastSessionAt` (not dismissed in this window)
 *
 * `now` arg is for deterministic testing; defaults to `Date.now()`.
 *
 * Story 1-8.
 */
import { use$ } from '@legendapp/state/react'
import { lapsed$, dismissLapsedPrompt, LAPSED_THRESHOLD_MS } from 'app/state/lapsed'

/**
 * Returns `{ shouldShow, dismiss }` for the home lapsed prompt.
 *
 * `shouldShow` is true IFF:
 *   1. `hasOpenedBefore === true` (excludes first-time users)
 *   2. Last session was > 7 days ago (strict >)
 *   3. Not yet dismissed in this window (dismissedAt < lastSessionAt or null)
 *
 * `now` arg is for deterministic testing; defaults to live Date.now().
 *
 * @example
 *   // Visible case: returning user, 8 days absent, not dismissed
 *   // lapsed$.set({ lastSessionAt: Date.now() - 8 * DAY_MS, dismissedAt: null, hasOpenedBefore: true })
 *   const { shouldShow } = useLapsedPrompt() // → true
 *
 *   // Hidden case 1: first-time user
 *   // lapsed$.set({ hasOpenedBefore: false, ... })
 *   const { shouldShow } = useLapsedPrompt() // → false
 *
 *   // Hidden case 2: within 7 days
 *   // lapsed$.set({ lastSessionAt: Date.now() - 5 * DAY_MS, ... hasOpenedBefore: true })
 *   const { shouldShow } = useLapsedPrompt() // → false
 */
export function useLapsedPrompt(now?: number): {
  shouldShow: boolean
  dismiss: () => void
} {
  const lastSessionAt = use$(lapsed$.lastSessionAt)
  const dismissedAt = use$(lapsed$.dismissedAt)
  const hasOpenedBefore = use$(lapsed$.hasOpenedBefore)

  const currentNow = now ?? Date.now()
  const isLapsed = lastSessionAt !== null && currentNow - lastSessionAt > LAPSED_THRESHOLD_MS
  const isDismissedThisWindow =
    dismissedAt !== null && lastSessionAt !== null && dismissedAt >= lastSessionAt

  const shouldShow = hasOpenedBefore && isLapsed && !isDismissedThisWindow

  // dismissLapsedPrompt is a module-level function — stable reference, no useCallback needed.
  return { shouldShow, dismiss: dismissLapsedPrompt }
}
