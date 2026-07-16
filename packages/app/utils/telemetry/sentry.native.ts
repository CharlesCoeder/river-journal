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
import { telemetryConsent$ } from '../../state/telemetryConsent'
import { redactEvent } from './redactor'

declare const __DEV__: boolean

/**
 * Whether Sentry should send on device.
 *
 * THREE AND-gates, all required: (1) a DSN is present, (2) the user has given
 * telemetry consent (device-local, default OFF — the opt-in gate), and (3) the
 * dev-quiet gate — a release build (`__DEV__` false) OR an explicit opt-in
 * flag. Under `__DEV__` without opt-in the production DSN is never used.
 * Consent is read synchronously (peek) because no hooks exist at init time.
 */
function sentryEnabled(dsn: string | undefined): dsn is string {
  if (!dsn) return false
  if (!telemetryConsent$.enabled.peek()) return false
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
 * Immediately stop Sentry when consent is revoked post-boot, without a restart.
 * Uses `Sentry.close()` rather than flipping `options.enabled`: the options
 * flip leaves the native (iOS/Android) crash handlers installed, so native
 * crashes keep uploading after a revoke — `close()` tears the whole client (and
 * those native handlers) down. A later re-enable re-runs `initSentry()`, which
 * starts a fresh client (there is no module-level inited guard to clear).
 * `close()` returns a Promise; callers are sync, so fire-and-forget with a
 * swallowed rejection.
 */
export function disableSentry(): void {
  Sentry.close().catch(() => {})
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
