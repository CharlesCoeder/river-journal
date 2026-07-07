/**
 * state/lapsed.ts
 *
 * Persisted Legend-State observable for lapsed-user detection.
 * Local-only UI state — never crosses the encryption boundary.
 *
 * This observable tracks the last-session timestamp and a per-window
 * dismissal flag for the "Want to start again?" prompt.
 */

import { observable, batch } from '@legendapp/state'

// ─── Threshold constants ──────────────────────────────────────────────────────

/** Number of days absence that triggers the lapsed prompt. Strict greater-than. */
export const LAPSED_THRESHOLD_DAYS = 7

/** Milliseconds equivalent of LAPSED_THRESHOLD_DAYS. Strict greater-than per epics.md:887. */
export const LAPSED_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000

// ─── Observable ──────────────────────────────────────────────────────────────

/**
 * `lapsed$` observable — persisted, local-only.
 *
 * - `lastSessionAt`: epoch ms of the CURRENT session-open (updated every boot); null on
 *   first launch. This is the value that becomes "previous" on the next boot.
 * - `previousSessionAt`: epoch ms of the session-open immediately BEFORE the current one;
 *   null on first launch. The lapse gap is measured against this, NOT `lastSessionAt` —
 *   otherwise the very boot that should reveal the lapse would already have overwritten
 *   `lastSessionAt` with ≈now, and the gap would always be ≈0. See recordSessionOpen.
 * - `dismissedAt`: epoch ms when the user dismissed the current lapsed window; null when
 *   no active window or no dismissal yet in this window.
 * - `hasOpenedBefore`: false until first session-open is recorded; gates first-time-user case.
 */
export const lapsed$ = observable<{
  lastSessionAt: number | null
  previousSessionAt: number | null
  dismissedAt: number | null
  hasOpenedBefore: boolean
}>({
  lastSessionAt: null,
  previousSessionAt: null,
  dismissedAt: null,
  hasOpenedBefore: false,
})

// ─── Action helpers ───────────────────────────────────────────────────────────

/**
 * Record a session open.
 *
 * - Snapshots the prior `lastSessionAt` into `previousSessionAt` BEFORE overwriting
 *   `lastSessionAt` with `now`. The lapse gap is evaluated against `previousSessionAt`
 *   (see useLapsedPrompt), so recording the current session no longer destroys the
 *   very gap the prompt needs to detect a lapse.
 * - Updates `lastSessionAt` and sets `hasOpenedBefore = true`.
 * - Resets `dismissedAt = null` if the gap from the previous session exceeds the
 *   lapsed threshold (i.e., the user is entering a fresh lapsed window).
 * - Same-tick guard: if `(now - lastSessionAt) < 60_000`, skips entirely (idempotent on
 *   hot-reload / repeated boots within the same minute) — `previousSessionAt` is left
 *   untouched so the detected gap survives.
 * - Negative gap (clock skew backwards) is treated as ≤ threshold — no reset.
 *
 * @param now - Epoch ms timestamp. Defaults to `Date.now()`. Pass a fixed value for tests.
 */
export function recordSessionOpen(now: number = Date.now()): void {
  const previous = lapsed$.lastSessionAt.peek()

  // Same-tick guard: skip if called again within the same 60-second window.
  // Returning early leaves previousSessionAt intact, so a lapse detected on this
  // boot is not clobbered by a rapid re-entry (hot-reload, quick re-foreground).
  if (previous !== null && (now - previous) < 60_000) {
    return
  }

  const gap = previous === null ? null : now - previous

  batch(() => {
    // Preserve the prior session timestamp before advancing lastSessionAt to now.
    lapsed$.previousSessionAt.set(previous)
    lapsed$.lastSessionAt.set(now)
    lapsed$.hasOpenedBefore.set(true)
    // Reset dismissal flag only if entering a fresh lapsed window (strict greater-than)
    if (gap !== null && gap > LAPSED_THRESHOLD_MS) {
      lapsed$.dismissedAt.set(null)
    }
  })
}

/**
 * Dismiss the lapsed prompt for the current window.
 *
 * Sets `dismissedAt` to `now`. The prompt will not re-appear until the user
 * lapses again (recordSessionOpen detects a new gap > threshold and resets dismissedAt).
 *
 * @param now - Epoch ms timestamp. Defaults to `Date.now()`. Pass a fixed value for tests.
 */
export function dismissLapsedPrompt(now: number = Date.now()): void {
  lapsed$.dismissedAt.set(now)
}
