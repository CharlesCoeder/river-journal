// Client-side telemetry entry point for the desktop (Tauri) renderer. Desktop
// is a static export with no Next server runtime, so only this browser-side
// init runs; Rust-side crashes are captured separately by the `sentry` crate
// in src-tauri. Init options (including the content-redacting `beforeSend`)
// live in the shared telemetry module.
import * as Sentry from '@sentry/nextjs'
import { initSentry } from 'app/utils/telemetry/sentry'
import { initPostHog } from 'app/utils/telemetry/posthog'

initSentry()
// Product analytics — initialized right after crash telemetry. A no-op in local
// dev (no key / opt-in flag unset). Only explicit captureEvent() calls emit.
initPostHog()

// Instrument client-side route navigations (App Router). No-op unless Sentry
// was actually initialized above.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
