// Client-side telemetry entry point for the desktop (Tauri) renderer. Desktop
// is a static export with no Next server runtime; Rust-side crashes are
// captured separately by the `sentry` crate in src-tauri.
//
// Telemetry is OPT-IN, so init does NOT run here: the consent flag is only
// readable after persistence loads, which happens later than this module. The
// consent-gated Sentry init therefore lives in `app/state/initializeApp.ts`,
// after the persisted flag is awaited. A late opt-in re-runs init via
// `app/utils/telemetry/consent.ts` — no reload.
import * as Sentry from '@sentry/nextjs'

// Instrument client-side route navigations (App Router). No-op unless Sentry
// was actually initialized (consent granted).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
