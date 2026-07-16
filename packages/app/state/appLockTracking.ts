/**
 * state/appLockTracking.ts
 *
 * Background/foreground lifecycle controller for App Lock's auto-lock timing.
 * Records the most recent time the app truly left the foreground and, on
 * return, re-locks when the configured interval has elapsed (see
 * `shouldRelock`). Modeled on state/today.ts's own idempotent AppState
 * subscription — deliberately NOT piggy-backed on the TanStack focusManager
 * bridge in state/queryClient.native.ts (that bridge is for query refetching
 * and must stay independent).
 *
 * Trigger split (native):
 *  - Record `backgroundedAt` on a TRUE `background` transition only (latest
 *    wins). Transient `inactive` blips (Control Center pull-down, notification
 *    shade, a permission dialog, an incoming-call banner) must NOT arm the
 *    auto-lock clock — otherwise, with the `Immediately` default, a routine
 *    interruption would re-lock the user mid-session.
 *  - The app-switcher-snapshot privacy cover (a separate concern) is driven off
 *    `inactive` elsewhere; this module never covers content.
 *
 * Web/desktop have no AppState — the same timing logic runs off `document`
 * `visibilitychange` plus `window` `blur`/`focus`. `ephemeral$.isLocked` is
 * per-document, so each tab/window locks/unlocks independently (intended).
 *
 * Cold-start locking is NOT handled here — it is set once after persistence
 * load (see initializeApp.ts) so no unlocked frame paints before the overlay.
 */

import { AppState, Platform, type AppStateStatus } from 'react-native'
import { appLock$, shouldRelock } from './appLock'
import { ephemeral$ } from './store'

/** Most recent true-background timestamp, or null when foreground this session. */
let backgroundedAt: number | null = null
let appStateSub: { remove: () => void } | null = null
let webCleanup: (() => void) | null = null
let started = false

/** Record a true backgrounding transition (latest wins). */
function armClock(): void {
  backgroundedAt = Date.now()
}

/** On return to the foreground, re-lock if the interval has elapsed. */
function onForeground(): void {
  if (appLock$.enabled.peek()) {
    if (shouldRelock(backgroundedAt, Date.now(), appLock$.autoLockInterval.peek())) {
      ephemeral$.isLocked.set(true)
    }
  }
  backgroundedAt = null
}

/**
 * Idempotent. Call once from app init after persistence loads. Subscribes to
 * the platform lifecycle so a return-from-background re-locks per the configured
 * interval. Returns the teardown for symmetry / test cleanup.
 */
export function startAppLockTracking(): () => void {
  if (started) return stopAppLockTracking
  started = true
  backgroundedAt = null

  if (Platform.OS === 'web') {
    const onVisibility = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        armClock()
      } else {
        onForeground()
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', armClock)
      window.addEventListener('focus', onForeground)
    }
    webCleanup = (): void => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('blur', armClock)
        window.removeEventListener('focus', onForeground)
      }
    }
  } else {
    appStateSub = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'background') {
        // True backgrounding — arm the auto-lock clock (latest wins).
        armClock()
      } else if (status === 'active') {
        onForeground()
      }
      // 'inactive' is intentionally ignored here (see the module header).
    })
  }

  return stopAppLockTracking
}

/** Tear down the subscription and reset internal timing state. */
export function stopAppLockTracking(): void {
  started = false
  backgroundedAt = null
  if (appStateSub) {
    appStateSub.remove()
    appStateSub = null
  }
  if (webCleanup) {
    webCleanup()
    webCleanup = null
  }
}
