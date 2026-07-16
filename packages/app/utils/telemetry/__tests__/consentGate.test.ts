/**
 * consentGate.test.ts — the opt-in telemetry consent gate, end-to-end through
 * the real predicates and the real `setTelemetryConsent` orchestrator, with
 * only the SDK boundaries (`posthog-js`, `@sentry/nextjs`) and the heavy store
 * mocked (this repo's convention of mocking the true I/O boundary).
 *
 * Covers the I/O & edge-case matrix: fresh boot (consent OFF ⇒ no init, no
 * capture even with prod-like env), toggle ON post-boot (both SDKs init without
 * restart, late opt-in re-identifies the signed-in user), toggle OFF post-boot
 * (Sentry.close() + PostHog opt-out AND identity reset), and the env-dev-quiet
 * AND-gate still winning over consent.
 *
 * Each test re-imports the modules after `vi.resetModules()` so the module-level
 * SDK state (posthog `inited`, the fresh telemetryConsent$ observable) never
 * leaks across tests via describe order.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// All mock state lives in vi.hoisted so the (hoisted) vi.mock factories below
// can safely close over it — a plain top-level `let`/`const` would be read
// before initialization when the factory runs.
const {
  sentryInitMock,
  sentryCloseMock,
  sentrySetUserMock,
  posthogInitMock,
  posthogCaptureMock,
  posthogIdentifyMock,
  posthogResetMock,
  optInMock,
  optOutMock,
  storeState,
} = vi.hoisted(() => ({
  sentryInitMock: vi.fn(),
  // close() returns a Promise<boolean>; disableSentry fire-and-forgets it.
  sentryCloseMock: vi.fn(() => Promise.resolve(true)),
  sentrySetUserMock: vi.fn(),
  posthogInitMock: vi.fn(),
  posthogCaptureMock: vi.fn(),
  posthogIdentifyMock: vi.fn(),
  posthogResetMock: vi.fn(),
  optInMock: vi.fn(),
  optOutMock: vi.fn(),
  storeState: { userId: null as string | null },
}))

vi.mock('@sentry/nextjs', () => ({
  init: sentryInitMock,
  close: sentryCloseMock,
  setUser: sentrySetUserMock,
}))

vi.mock('posthog-js', () => ({
  default: {
    init: posthogInitMock,
    capture: posthogCaptureMock,
    identify: posthogIdentifyMock,
    reset: posthogResetMock,
    opt_in_capturing: optInMock,
    opt_out_capturing: optOutMock,
  },
}))

// Mock the heavy store so consent.ts's late-opt-in re-identify read has a
// controllable user without pulling the real store graph (supabase/sync) into
// this unit test.
vi.mock('../../../state/store', () => ({
  store$: {
    session: {
      userId: { peek: () => storeState.userId },
    },
  },
}))

const ORIGINAL_ENV = { ...process.env }

function setProdLikeEnv() {
  vi.stubEnv('NODE_ENV', 'production')
  process.env.NEXT_PUBLIC_SENTRY_ENABLED = 'true'
  process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://prod-dsn@example.ingest.sentry.io/1'
  process.env.NEXT_PUBLIC_POSTHOG_ENABLED = 'true'
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key'
}

// Re-import the module graph fresh (after resetModules) so each test sees clean
// module-level SDK state and a fresh telemetryConsent$ observable shared across
// consent.ts / sentry.ts / posthog.ts.
async function loadModules() {
  const { telemetryConsent$ } = await import('../../../state/telemetryConsent')
  const { setTelemetryConsent } = await import('../consent')
  const { initSentry } = await import('../sentry')
  const { captureEvent } = await import('../posthog')
  return { telemetryConsent$, setTelemetryConsent, initSentry, captureEvent }
}

beforeEach(() => {
  vi.resetModules()
  sentryInitMock.mockClear()
  sentryCloseMock.mockClear()
  sentrySetUserMock.mockClear()
  posthogInitMock.mockClear()
  posthogCaptureMock.mockClear()
  posthogIdentifyMock.mockClear()
  posthogResetMock.mockClear()
  optInMock.mockClear()
  optOutMock.mockClear()
  storeState.userId = null
  process.env = { ...ORIGINAL_ENV }
})

afterEach(() => {
  vi.unstubAllEnvs()
  process.env = { ...ORIGINAL_ENV }
})

describe('fresh boot — consent OFF blocks init even with prod-like env', () => {
  it('initSentry() is a no-op (Sentry.init never called) while consent is OFF', async () => {
    setProdLikeEnv()
    const { initSentry } = await loadModules()
    initSentry()
    expect(sentryInitMock).not.toHaveBeenCalled()
  })

  it('captureEvent() is a silent no-op (posthog.capture never called) while consent is OFF', async () => {
    setProdLikeEnv()
    const { captureEvent } = await loadModules()
    captureEvent('flow_started', { user_id: 'user-1', tier: 'free' } as any)
    expect(posthogCaptureMock).not.toHaveBeenCalled()
  })
})

describe('toggle ON post-boot — both SDKs init without restart', () => {
  it('setTelemetryConsent(true) initializes Sentry and PostHog and opts capture in', async () => {
    setProdLikeEnv()
    const { setTelemetryConsent, telemetryConsent$ } = await loadModules()
    setTelemetryConsent(true)

    expect(telemetryConsent$.enabled.peek()).toBe(true)
    expect(sentryInitMock).toHaveBeenCalledTimes(1)
    expect(posthogInitMock).toHaveBeenCalledTimes(1)
    expect(optInMock).toHaveBeenCalledTimes(1)
  })

  it('captureEvent() sends once consent is ON', async () => {
    setProdLikeEnv()
    const { setTelemetryConsent, captureEvent } = await loadModules()
    setTelemetryConsent(true)
    captureEvent('flow_started', { user_id: 'user-1', tier: 'free' } as any)
    expect(posthogCaptureMock).toHaveBeenCalledTimes(1)
  })

  it('re-identifies a signed-in user on late opt-in (setUser + identify with the user_id)', async () => {
    setProdLikeEnv()
    storeState.userId = 'user-late-optin'
    const { setTelemetryConsent } = await loadModules()
    setTelemetryConsent(true)

    expect(sentrySetUserMock).toHaveBeenCalledWith({ id: 'user-late-optin' })
    expect(posthogIdentifyMock).toHaveBeenCalledWith('user-late-optin')
  })

  it('does not identify when no user is signed in at opt-in time', async () => {
    setProdLikeEnv()
    storeState.userId = null
    const { setTelemetryConsent } = await loadModules()
    setTelemetryConsent(true)

    expect(sentrySetUserMock).not.toHaveBeenCalled()
    expect(posthogIdentifyMock).not.toHaveBeenCalled()
  })
})

describe('toggle OFF post-boot — capture stops immediately', () => {
  it('setTelemetryConsent(false) closes the Sentry client and opts PostHog out + resets identity', async () => {
    setProdLikeEnv()
    const { setTelemetryConsent, telemetryConsent$ } = await loadModules()
    setTelemetryConsent(true)

    setTelemetryConsent(false)

    expect(telemetryConsent$.enabled.peek()).toBe(false)
    // close() (not an options.enabled flip) is the revoke mechanism now.
    expect(sentryCloseMock).toHaveBeenCalledTimes(1)
    expect(optOutMock).toHaveBeenCalledTimes(1)
    // Revoke drops the persisted analytics identity (distinct_id).
    expect(posthogResetMock).toHaveBeenCalledTimes(1)
  })

  it('captureEvent() no longer sends after consent is revoked', async () => {
    setProdLikeEnv()
    const { setTelemetryConsent, captureEvent } = await loadModules()
    setTelemetryConsent(true)
    setTelemetryConsent(false)
    posthogCaptureMock.mockClear()

    captureEvent('flow_started', { user_id: 'user-1', tier: 'free' } as any)
    expect(posthogCaptureMock).not.toHaveBeenCalled()
  })
})

describe('env dev-quiet AND-gate still wins over consent', () => {
  it('consent ON in a dev build (no *_ENABLED flag) still does not init Sentry', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    delete process.env.NEXT_PUBLIC_SENTRY_ENABLED
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://prod-dsn@example.ingest.sentry.io/1'
    const { initSentry, telemetryConsent$ } = await loadModules()
    telemetryConsent$.set({ enabled: true })

    initSentry()
    expect(sentryInitMock).not.toHaveBeenCalled()
  })

  it('consent ON in a dev build still does not capture', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    delete process.env.NEXT_PUBLIC_POSTHOG_ENABLED
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key'
    const { captureEvent, telemetryConsent$ } = await loadModules()
    telemetryConsent$.set({ enabled: true })

    captureEvent('flow_started', { user_id: 'user-1', tier: 'free' } as any)
    expect(posthogCaptureMock).not.toHaveBeenCalled()
  })
})
