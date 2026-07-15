// Client-side telemetry entry point (Next.js `instrumentation-client.ts`
// convention). Runs once in the browser before the app renders. All init
// options — including the content-redacting `beforeSend` — live in the shared
// telemetry module so web and desktop stay in lockstep.
import * as Sentry from '@sentry/nextjs'
import { initSentry } from 'app/utils/telemetry/sentry'

initSentry()

// Instrument client-side route navigations (App Router). No-op unless Sentry
// was actually initialized above.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
