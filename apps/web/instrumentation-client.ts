// Client-side telemetry entry point (Next.js `instrumentation-client.ts`
// convention). Runs once in the browser before the app renders. All init
// options — including the content-redacting `beforeSend` — live in the shared
// telemetry module so web and desktop stay in lockstep.
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
