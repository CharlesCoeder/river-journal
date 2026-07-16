/**
 * utils/telemetry/consent.ts — the single entry point for flipping telemetry
 * consent at runtime (onboarding opt-in, Privacy Center toggle).
 *
 * Shared (no platform extension): it never imports `posthog-js` or a Sentry SDK
 * directly. The platform-specific enable/disable primitives live INSIDE the
 * platform-split `sentry`/`posthog` modules (resolved to `.native` on mobile),
 * and this file only orchestrates them plus the state write. This keeps the
 * platform boundary at those modules, as required for shared files.
 *
 * ON  -> persist the flag, then init both SDKs (idempotent), clear any prior
 *        opt-out so capture resumes immediately, and re-identify the current
 *        user — a sign-in that happened while consent was OFF dropped its
 *        identify (utils/auth.ts), so without this, events would stay anonymous
 *        until the next token refresh. No restart.
 * OFF -> persist the flag, then disable both SDKs immediately (Sentry.close();
 *        PostHog opt-out + identity reset).
 *
 * Each SDK is isolated in its own try/catch: telemetry must never take down the
 * app, AND one SDK's failure must never affect the other (a Sentry throw on
 * revoke must not skip the PostHog opt-out and leave it capturing).
 */

import { store$ } from '../../state/store'
import { setTelemetryConsentEnabled } from '../../state/telemetryConsent'
import { disableSentry, initSentry, setSentryUser } from './sentry'
import { disablePostHog, enablePostHog, identifyPostHogUser, initPostHog } from './posthog'

function warn(scope: string, error: unknown): void {
  console.warn(
    `[telemetry] ${scope} failed`,
    error instanceof Error ? error.message : 'unknown error'
  )
}

export function setTelemetryConsent(enabled: boolean): void {
  // State first, so the SDK predicates (which peek the flag) see the new value
  // when init runs below.
  setTelemetryConsentEnabled(enabled)

  if (enabled) {
    try {
      initSentry()
    } catch (error) {
      warn('sentry enable', error)
    }
    try {
      initPostHog()
      enablePostHog()
    } catch (error) {
      warn('posthog enable', error)
    }
    // Re-identify: if sign-in happened while consent was OFF, the identify at
    // utils/auth.ts was dropped. Attribute post-opt-in telemetry to the
    // Supabase user_id (never PII) instead of leaving it anonymous.
    try {
      const userId = store$.session.userId.peek()
      if (userId) {
        setSentryUser(userId)
        identifyPostHogUser(userId)
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
    try {
      disablePostHog()
    } catch (error) {
      warn('posthog disable', error)
    }
  }
}
