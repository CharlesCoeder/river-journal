/**
 * sentryInit.native.e2e.test.ts — TDD RED-PHASE E2E spec for the mobile
 * Sentry init wrapper.
 *
 * Mirrors `sentryInit.web.e2e.test.ts` for `apps/mobile`, which consumes
 * `packages/app/utils/telemetry/sentry.native.ts`. Per the Dev Notes
 * ("Why factor the redactor out of sentry.native.ts"), the native SDK
 * itself is not test-loadable under Vitest, so `@sentry/react-native` is
 * mocked at the module boundary — the same pattern this repo already uses
 * for `pushTokens.native.test.ts` (`../pushTokens.native`, `expo-notifications`
 * / `expo-device` mocked with inline factories; confirmed `vi.mock` does not
 * require the real package to resolve on disk when a factory is supplied).
 *
 * This file imports `../sentry.native` directly (not the extension-less
 * `../sentry` specifier) so it exercises the actual mobile module under
 * Vitest's plain Node module resolution, matching the existing
 * `pushTokens.native.test.ts` convention.
 *
 * RED PHASE: `packages/app/utils/telemetry/sentry.native.ts` does not exist
 * yet (neither does `@sentry/react-native` as an installed dependency of
 * `apps/mobile`). Every test below MUST fail until this story is implemented.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sentryInitMock = vi.fn()
const sentrySetUserMock = vi.fn()
const mobileReplayIntegrationMock = vi.fn()

vi.mock('@sentry/react-native', () => ({
  init: sentryInitMock,
  setUser: sentrySetUserMock,
  mobileReplayIntegration: mobileReplayIntegrationMock,
  wrap: (component: unknown) => component,
}))

const ORIGINAL_ENV = { ...process.env }

beforeEach(async () => {
  vi.resetModules()
  sentryInitMock.mockClear()
  sentrySetUserMock.mockClear()
  mobileReplayIntegrationMock.mockClear()
  process.env = { ...ORIGINAL_ENV }
  // Telemetry is opt-in: grant device-local consent so these env/wiring tests
  // exercise the enabled path. (Consent gating itself is covered in
  // consentGate.test.ts.) Imported after resetModules so it shares the fresh
  // module instance the SDK wrapper will read.
  const { telemetryConsent$ } = await import('../../../state/telemetryConsent')
  telemetryConsent$.enabled.set(true)
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
})

describe('initSentry (mobile) — init wiring exists and is callable end-to-end', () => {
  it('calling initSentry() in a production-like env invokes Sentry.init exactly once', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_SENTRY_ENABLED = 'true'
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://prod-dsn@example.ingest.sentry.io/2'

    const { initSentry } = await import('../sentry.native')
    initSentry()

    expect(sentryInitMock).toHaveBeenCalledTimes(1)
  })
})

describe('initSentry (mobile) — beforeSend is wired to the real (shared) redactor end-to-end', () => {
  it('the beforeSend passed to Sentry.init actually redacts content when invoked', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_SENTRY_ENABLED = 'true'
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://prod-dsn@example.ingest.sentry.io/2'

    const { initSentry } = await import('../sentry.native')
    initSentry()

    const initOptions = sentryInitMock.mock.calls[0]?.[0]
    expect(typeof initOptions?.beforeSend).toBe('function')

    const scrubbed = initOptions.beforeSend({ extra: { note: 'private journal note content' } })
    const noteValue = scrubbed?.extra?.note
    expect(noteValue === '[redacted]' || noteValue === undefined).toBe(true)
    expect(JSON.stringify(scrubbed).includes('private journal note content')).toBe(false)
  })
})

describe('initSentry (mobile) — transaction events also route through the redactor', () => {
  it('beforeSendTransaction is wired and redacts content on transaction (span) payloads', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_SENTRY_ENABLED = 'true'
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://prod-dsn@example.ingest.sentry.io/2'

    const { initSentry } = await import('../sentry.native')
    initSentry()

    const initOptions = sentryInitMock.mock.calls[0]?.[0]
    // If tracing can fire on release builds, the transaction path MUST be scrubbed.
    if ((initOptions?.tracesSampleRate ?? 0) > 0) {
      expect(typeof initOptions?.beforeSendTransaction).toBe('function')
      const spanContent =
        'the exact private journal body that the user typed into the editor earlier today'
      const scrubbed = initOptions.beforeSendTransaction({
        transaction: 'JournalScreen',
        spans: [{ op: 'ui', description: spanContent }],
      })
      expect(JSON.stringify(scrubbed).includes(spanContent)).toBe(false)
    }
  })
})

describe('initSentry (mobile) — dev environment is quiet (__DEV__ gating)', () => {
  it('under __DEV__, the production DSN is never handed to Sentry.init', async () => {
    vi.stubGlobal('__DEV__', true)
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://prod-dsn@example.ingest.sentry.io/2'

    const { initSentry } = await import('../sentry.native')
    initSentry()

    if (sentryInitMock.mock.calls.length === 0) {
      expect(sentryInitMock).not.toHaveBeenCalled()
    } else {
      const initOptions = sentryInitMock.mock.calls[0]?.[0]
      expect(initOptions?.dsn).not.toBe('https://prod-dsn@example.ingest.sentry.io/2')
    }
  })
})

describe('initSentry (mobile) — PII on user context is user_id only', () => {
  it('setSentryUser(userId) calls Sentry.setUser with { id } and nothing else', async () => {
    const { setSentryUser } = await import('../sentry.native')
    setSentryUser('user-xyz-789')

    expect(sentrySetUserMock).toHaveBeenCalledTimes(1)
    const userArg = sentrySetUserMock.mock.calls[0]?.[0]
    expect(userArg).toEqual({ id: 'user-xyz-789' })
    expect(userArg).not.toHaveProperty('email')
    expect(userArg).not.toHaveProperty('username')
    expect(userArg).not.toHaveProperty('name')
  })

  it('clearing the user (sign-out) clears Sentry user context', async () => {
    const { setSentryUser } = await import('../sentry.native')
    setSentryUser(null)

    expect(sentrySetUserMock).toHaveBeenCalledWith(null)
  })
})

describe('initSentry (mobile) — default auto-capture cannot leak content upstream of beforeSend', () => {
  it('Sentry.init is called with sendDefaultPii: false', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_SENTRY_ENABLED = 'true'
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://prod-dsn@example.ingest.sentry.io/2'

    const { initSentry } = await import('../sentry.native')
    initSentry()

    const initOptions = sentryInitMock.mock.calls[0]?.[0]
    expect(initOptions?.sendDefaultPii).toBe(false)
  })

  it('Mobile session replay is never enabled (mobileReplayIntegration is never invoked)', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_SENTRY_ENABLED = 'true'
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://prod-dsn@example.ingest.sentry.io/2'

    const { initSentry } = await import('../sentry.native')
    initSentry()

    expect(mobileReplayIntegrationMock).not.toHaveBeenCalled()
  })
})
