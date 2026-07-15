/**
 * sentry.native.ts — mobile crash/error telemetry init (React Native / Expo).
 *
 * Mirror of `sentry.ts` for `apps/mobile`, wiring the SAME shared
 * `redactEvent` as `beforeSend` so the content-exclusion guarantee is
 * identical across platforms. `@sentry/react-native` pulls native-only
 * modules, so this file MUST NOT be imported from shared (no-extension) code;
 * it is loaded only on the native platform (and, in tests, with the SDK
 * mocked at the module boundary).
 */

import * as Sentry from '@sentry/react-native'
import { redactEvent } from './redactor'

declare const __DEV__: boolean

/**
 * Whether Sentry should send on device.
 *
 * DEV QUIET: we only enable when a DSN is present AND either this is a
 * release build (`__DEV__` false) OR an explicit opt-in flag is set. Under
 * `__DEV__` without opt-in the production DSN is never used.
 */
function sentryEnabled(dsn: string | undefined): dsn is string {
  if (!dsn) return false
  const isRelease = typeof __DEV__ === 'undefined' || __DEV__ === false
  return isRelease || process.env.EXPO_PUBLIC_SENTRY_ENABLED === 'true'
}

/**
 * Initialize Sentry for the mobile app. Call once, early in module load at the
 * app entry. A no-op when disabled (dev without opt-in, or no DSN configured).
 */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN
  if (!sentryEnabled(dsn)) return

  const isRelease = typeof __DEV__ === 'undefined' || __DEV__ === false

  Sentry.init({
    dsn,
    // Never attach device PII. The redactor scrubs content, but we also
    // stop the SDK collecting raw PII upstream of beforeSend.
    sendDefaultPii: false,
    tracesSampleRate: isRelease ? 0.1 : 0,
    // THE client-side content-exclusion enforcement point (shared redactor).
    beforeSend: redactEvent,
    // Tracing is sampled on release builds, so transaction events (span
    // descriptions / urls / data) must run through the SAME redactor —
    // otherwise sampled traces would ship content un-scrubbed.
    beforeSendTransaction: redactEvent,
    // Network/XHR breadcrumbs: do NOT attach request/response bodies. Any body
    // string that does slip into `breadcrumb.data` is still walked and scrubbed
    // by the redactor.
    //
    // NOTE: mobile Session Replay is intentionally NOT enabled — it records the
    // screen verbatim and would capture journal/Collective content that
    // beforeSend never inspects. Do not add `Sentry.mobileReplayIntegration()`.
  })
}

/**
 * Set (or clear) the Sentry user context — Supabase `user_id` ONLY, never
 * email/display name/PII. Pass `null` on sign-out to clear.
 */
export function setSentryUser(userId: string | null): void {
  if (userId) {
    Sentry.setUser({ id: userId })
  } else {
    Sentry.setUser(null)
  }
}
