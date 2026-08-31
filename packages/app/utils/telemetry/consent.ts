/**
 * utils/telemetry/consent.ts — the single entry point for flipping telemetry
 * consent at runtime (onboarding opt-in, Privacy Center toggle).
 *
 * Shared (no platform extension): it never imports a Sentry SDK directly. The
 * platform-specific enable/disable primitives live INSIDE the platform-split
 * `sentry` module (resolved to `.native` on mobile), and this file only
 * orchestrates them plus the state write. This keeps the platform boundary at
 * that module, as required for shared files.
 *
 * ON  -> persist the flag, then init the SDK (idempotent) and re-identify the
 *        current user — a sign-in that happened while consent was OFF dropped
 *        its identify (utils/auth.ts), so without this, crash reports would
 *        stay anonymous until the next token refresh. No restart.
 * OFF -> persist the flag, then disable the SDK immediately (Sentry.close()).
 *
 * Each step is isolated in its own try/catch: telemetry must never take down
 * the app.
 */

import { store$ } from '../../state/store'
import { setTelemetryConsentEnabled } from '../../state/telemetryConsent'
import { disableSentry, initSentry, setSentryUser } from './sentry'

function warn(scope: string, error: unknown): void {
  console.warn(
    `[telemetry] ${scope} failed`,
    error instanceof Error ? error.message : 'unknown error'
  )
}

export function setTelemetryConsent(enabled: boolean): void {
  // State first, so the SDK predicate (which peeks the flag) sees the new
  // value when init runs below.
  setTelemetryConsentEnabled(enabled)

  if (enabled) {
    try {
      initSentry()
    } catch (error) {
      warn('sentry enable', error)
    }
    // Re-identify: if sign-in happened while consent was OFF, the identify at
    // utils/auth.ts was dropped. Attribute post-opt-in crash reports to the
    // Supabase user_id (never PII) instead of leaving them anonymous.
    try {
      const userId = store$.session.userId.peek()
      if (userId) {
        setSentryUser(userId)
      }
    } catch (error) {
      warn('telemetry identify', error)
    }
  } else {
    try {
      disableSentry()
    } catch (error) {
      warn('sentry disable', error)
    }
  }
}
