/**
 * sentry.ts — web + desktop (Tauri renderer) crash/error telemetry init.
 *
 * `initSentry()` is NOT called eagerly at the app entry: telemetry is opt-in,
 * so init runs only after the persisted consent flag has loaded — from the
 * boot gate in `state/initializeApp.ts` and, on a live toggle, from
 * `utils/telemetry/consent.ts`. Desktop is a static export (no Next server
 * runtime), so only the browser SDK applies there; the Rust layer handles
 * Rust-side crashes separately.
 *
 * The actual redaction logic lives in the SDK-free `redactor.ts` so it can be
 * unit-tested; here we only wire `beforeSend: redactEvent` and the privacy
 * hardening options. The native counterpart (`sentry.native.ts`) wires the
 * SAME `redactEvent`.
 */

import * as Sentry from '@sentry/nextjs'
import { telemetryConsent$ } from '../../state/telemetryConsent'
import { redactEvent } from './redactor'

/**
 * Whether Sentry should send in the current environment.
 *
 * THREE AND-gates, all required: (1) a DSN is present, (2) the user has given
 * telemetry consent (device-local, default OFF — the opt-in gate), and (3) the
 * dev-quiet env gate — a production build OR an explicit opt-in flag. In plain
 * local dev (flag unset) gate 3 is false, so the production DSN is never used
 * and no dev noise pollutes the production project. Consent is read
 * synchronously (peek) because no hooks are available at init time.
 */
function sentryEnabled(dsn: string | undefined): dsn is string {
  if (!dsn) return false
  if (!telemetryConsent$.enabled.peek()) return false
  return process.env.NEXT_PUBLIC_SENTRY_ENABLED === 'true' || process.env.NODE_ENV === 'production'
}

/**
 * Initialize Sentry for the browser/renderer. Safe to call once at client
 * entry; a no-op when disabled (dev without opt-in, or no DSN configured).
 */
export function initSentry(): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!sentryEnabled(dsn)) return

  const isProduction = process.env.NODE_ENV === 'production'

  Sentry.init({
    dsn,
    // Never attach cookies / auth headers / IP / request+response bodies. The
    // redactor only scrubs fields it walks, so we also prevent the SDK from
    // stuffing raw PII/content upstream of beforeSend.
    sendDefaultPii: false,
    // Low/zero tracing so dev never floods the project; modest in production.
    tracesSampleRate: isProduction ? 0.1 : 0,
    // THE client-side content-exclusion enforcement point. Every error event
    // is scrubbed here right before it would leave the device.
    beforeSend: redactEvent,
    // Tracing is sampled in production, so transaction events (span
    // descriptions / urls / data) must run through the SAME redactor —
    // otherwise sampled traces would ship content un-scrubbed.
    beforeSendTransaction: redactEvent,
    // NOTE: Session Replay is intentionally NOT enabled here — replay records
    // the DOM verbatim, which would capture journal/Collective content that
    // beforeSend never inspects. Do not add `Sentry.replayIntegration()`.
    //
    // Console breadcrumbs are left on: any content echoed through them is a
    // string on `breadcrumb.message`, which the redactor's free-text net
    // scrubs. If that guarantee ever weakens, disable the console integration.
  })
}

/**
 * Immediately stop Sentry when consent is revoked post-boot, without a restart.
 * Uses `Sentry.close()` rather than flipping `options.enabled`: the options
 * flip does NOT uninstall the native (iOS/Android) crash handlers, so on mobile
 * native crashes keep uploading after a revoke — `close()` tears the whole
 * client (and those handlers) down. We mirror it here so both platforms behave
 * identically. A later re-enable re-runs `initSentry()`, which starts a fresh
 * client (there is no module-level inited guard to clear). `close()` returns a
 * Promise; callers are sync, so fire-and-forget with a swallowed rejection.
 */
export function disableSentry(): void {
  Sentry.close().catch(() => {})
}

/**
 * Set (or clear) the Sentry user context.
 *
 * PII invariant: telemetry identifies a user by their Supabase `user_id`
 * ONLY — never email, display name, or any other PII. Pass `null` on sign-out
 * to clear the context.
 */
export function setSentryUser(userId: string | null): void {
  if (userId) {
    Sentry.setUser({ id: userId })
  } else {
    Sentry.setUser(null)
  }
}
