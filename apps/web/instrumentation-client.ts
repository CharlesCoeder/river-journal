// Client-side telemetry entry point (Next.js `instrumentation-client.ts`
// convention). Runs once in the browser before the app renders.
//
// Telemetry is OPT-IN, so init does NOT run here: the consent flag is only
// readable after persistence loads, which happens later than this module. The
// consent-gated Sentry/PostHog init therefore lives in
// `app/state/initializeApp.ts`, after the persisted flag is awaited. A late
// opt-in re-runs init via `app/utils/telemetry/consent.ts` — no reload.
import * as Sentry from '@sentry/nextjs'

// Instrument client-side route navigations (App Router). No-op unless Sentry
// was actually initialized (consent granted).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
