/**
 * sentryInit.web.e2e.test.ts — TDD RED-PHASE E2E spec for the web/desktop
 * Sentry init wrapper.
 *
 * `apps/web` and `apps/desktop` both consume the SAME
 * `packages/app/utils/telemetry/sentry.ts` module (Dev Notes: "single
 * source of truth", thin per-app `instrumentation-client.ts` call sites).
 * This spec covers that shared module directly — it is the full,
 * platform-real workflow: init → an event is captured → `beforeSend` runs
 * → the SDK is told to setUser — all through the actual exported functions,
 * with only the `@sentry/nextjs` SDK boundary mocked (mirrors this repo's
 * existing convention of mocking only the true I/O/SDK boundary, e.g.
 * `vi.mock('../../utils/supabase', ...)` in `subscriptionTier.e2e.test.ts`).
 *
 * RED PHASE: `packages/app/utils/telemetry/sentry.ts` does not exist yet
 * (neither does `@sentry/nextjs` as an installed dependency of this
 * workspace). Every test below MUST fail until this story is implemented.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sentryInitMock = vi.fn()
const sentrySetUserMock = vi.fn()
const sentryReplayIntegrationMock = vi.fn()

vi.mock('@sentry/nextjs', () => ({
  init: sentryInitMock,
  setUser: sentrySetUserMock,
  replayIntegration: sentryReplayIntegrationMock,
  withSentryConfig: (config: unknown) => config,
}))

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  sentryInitMock.mockClear()
  sentrySetUserMock.mockClear()
  sentryReplayIntegrationMock.mockClear()
  process.env = { ...ORIGINAL_ENV }
})

afterEach(() => {
  vi.unstubAllEnvs()
  process.env = { ...ORIGINAL_ENV }
})

describe('initSentry (web/desktop) — init wiring exists and is callable end-to-end', () => {
  it('calling initSentry() in a production-like env invokes Sentry.init exactly once', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.NEXT_PUBLIC_SENTRY_ENABLED = 'true'
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://prod-dsn@example.ingest.sentry.io/1'

    const { initSentry } = await import('../sentry')
    initSentry()

    expect(sentryInitMock).toHaveBeenCalledTimes(1)
  })
})

describe('initSentry (web/desktop) — beforeSend is wired to the real redactor end-to-end', () => {
  it('the beforeSend passed to Sentry.init actually redacts content when invoked (full pipeline: init → capture → beforeSend)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.NEXT_PUBLIC_SENTRY_ENABLED = 'true'
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://prod-dsn@example.ingest.sentry.io/1'

    const { initSentry } = await import('../sentry')
    initSentry()

    const initOptions = sentryInitMock.mock.calls[0]?.[0]
    expect(typeof initOptions?.beforeSend).toBe('function')

    // Simulate the SDK handing a real event to beforeSend, as it would at
    // runtime right before the payload leaves the device.
    const scrubbed = initOptions.beforeSend({ extra: { body: 'private flow content' } })
    const bodyValue = scrubbed?.extra?.body
    expect(bodyValue === '[redacted]' || bodyValue === undefined).toBe(true)
    expect(JSON.stringify(scrubbed).includes('private flow content')).toBe(false)
  })
})

describe('initSentry (web/desktop) — transaction events also route through the redactor', () => {
  it('beforeSendTransaction is wired and redacts content on transaction (span) payloads', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.NEXT_PUBLIC_SENTRY_ENABLED = 'true'
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://prod-dsn@example.ingest.sentry.io/1'

    const { initSentry } = await import('../sentry')
    initSentry()

    const initOptions = sentryInitMock.mock.calls[0]?.[0]
    // If tracing can fire in production, the transaction path MUST be scrubbed.
    if ((initOptions?.tracesSampleRate ?? 0) > 0) {
      expect(typeof initOptions?.beforeSendTransaction).toBe('function')
      const spanContent =
        'the exact private journal body that the user typed into the editor earlier today'
      const scrubbed = initOptions.beforeSendTransaction({
        transaction: '/journal/[id]',
        spans: [{ op: 'ui', description: spanContent }],
      })
      expect(JSON.stringify(scrubbed).includes(spanContent)).toBe(false)
    }
  })
})

describe('initSentry (web/desktop) — dev environment is quiet', () => {
  it('in dev (NODE_ENV=development, enabled flag unset), the production DSN is never handed to Sentry.init', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    delete process.env.NEXT_PUBLIC_SENTRY_ENABLED
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://prod-dsn@example.ingest.sentry.io/1'

    const { initSentry } = await import('../sentry')
    initSentry()

    if (sentryInitMock.mock.calls.length === 0) {
      // Acceptable: Sentry is disabled entirely in dev.
      expect(sentryInitMock).not.toHaveBeenCalled()
    } else {
      // Acceptable: Sentry.init was called, but NOT with the production DSN.
      const initOptions = sentryInitMock.mock.calls[0]?.[0]
      expect(initOptions?.dsn).not.toBe('https://prod-dsn@example.ingest.sentry.io/1')
    }
  })

  it('in dev, if Sentry.init is called at all, tracesSampleRate is low/zero (no dev noise polluting the production project)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    process.env.NEXT_PUBLIC_SENTRY_ENABLED = 'true'
    process.env.NEXT_PUBLIC_SENTRY_DSN = ''

    const { initSentry } = await import('../sentry')
    initSentry()

    if (sentryInitMock.mock.calls.length > 0) {
      const initOptions = sentryInitMock.mock.calls[0]?.[0]
      expect(initOptions?.tracesSampleRate ?? 0).toBeLessThanOrEqual(0.1)
    }
  })
})

describe('initSentry (web/desktop) — PII on user context is user_id only', () => {
  it('setSentryUser(userId) calls Sentry.setUser with { id } and nothing else', async () => {
    const { setSentryUser } = await import('../sentry')
    setSentryUser('user-abc-123')

    expect(sentrySetUserMock).toHaveBeenCalledTimes(1)
    const userArg = sentrySetUserMock.mock.calls[0]?.[0]
    expect(userArg).toEqual({ id: 'user-abc-123' })
    expect(userArg).not.toHaveProperty('email')
    expect(userArg).not.toHaveProperty('username')
    expect(userArg).not.toHaveProperty('name')
  })

  it('clearing the user (sign-out) clears Sentry user context', async () => {
    const { setSentryUser } = await import('../sentry')
    setSentryUser(null)

    expect(sentrySetUserMock).toHaveBeenCalledWith(null)
  })
})

describe('initSentry (web/desktop) — default auto-capture cannot leak content upstream of beforeSend', () => {
  it('Sentry.init is called with sendDefaultPii: false', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.NEXT_PUBLIC_SENTRY_ENABLED = 'true'
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://prod-dsn@example.ingest.sentry.io/1'

    const { initSentry } = await import('../sentry')
    initSentry()

    const initOptions = sentryInitMock.mock.calls[0]?.[0]
    expect(initOptions?.sendDefaultPii).toBe(false)
  })

  it('Session Replay is never enabled (replayIntegration is never invoked)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.NEXT_PUBLIC_SENTRY_ENABLED = 'true'
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://prod-dsn@example.ingest.sentry.io/1'

    const { initSentry } = await import('../sentry')
    initSentry()

    expect(sentryReplayIntegrationMock).not.toHaveBeenCalled()
  })
})
