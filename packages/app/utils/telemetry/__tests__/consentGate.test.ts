/**
 * consentGate.test.ts — the opt-in telemetry consent gate, end-to-end through
 * the real predicates and the real `setTelemetryConsent` orchestrator, with
 * only the SDK boundary (`@sentry/nextjs`) and the heavy store mocked (this
 * repo's convention of mocking the true I/O boundary).
 *
 * Covers the I/O & edge-case matrix: fresh boot (consent OFF ⇒ no init, even
 * with prod-like env), toggle ON post-boot (the SDK inits without restart,
 * late opt-in re-identifies the signed-in user), toggle OFF post-boot
 * (Sentry.close()), and the env-dev-quiet AND-gate still winning over consent.
 *
 * Each test re-imports the modules after `vi.resetModules()` so the module-level
 * state (the fresh telemetryConsent$ observable) never leaks across tests via
 * describe order.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// All mock state lives in vi.hoisted so the (hoisted) vi.mock factories below
// can safely close over it — a plain top-level `let`/`const` would be read
// before initialization when the factory runs.
const { sentryInitMock, sentryCloseMock, sentrySetUserMock, storeState } = vi.hoisted(() => ({
  sentryInitMock: vi.fn(),
  // close() returns a Promise<boolean>; disableSentry fire-and-forgets it.
  sentryCloseMock: vi.fn(() => Promise.resolve(true)),
  sentrySetUserMock: vi.fn(),
  storeState: { userId: null as string | null },
}))

vi.mock('@sentry/nextjs', () => ({
  init: sentryInitMock,
  close: sentryCloseMock,
  setUser: sentrySetUserMock,
}))

// Mock the heavy store so consent.ts's late-opt-in re-identify read has a
// controllable user without pulling the real store graph (supabase/sync) into
// this unit test.
vi.mock('../../../state/store', () => ({
  store$: {
    session: {
      userId: {
        peek: () => storeState.userId,
      },
    },
  },
}))

const ORIGINAL_ENV = { ...process.env }

function setProdLikeEnv() {
  vi.stubEnv('NODE_ENV', 'production')
  process.env.NEXT_PUBLIC_SENTRY_ENABLED = 'true'
  process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://prod-dsn@example.ingest.sentry.io/1'
}

// Re-import the module graph fresh (after resetModules) so each test sees clean
// module-level state and a fresh telemetryConsent$ observable shared across
// consent.ts / sentry.ts.
async function loadModules() {
  const { telemetryConsent$ } = await import('../../../state/telemetryConsent')
  const { setTelemetryConsent } = await import('../consent')
  const { initSentry } = await import('../sentry')
  return { telemetryConsent$, setTelemetryConsent, initSentry }
}

beforeEach(() => {
  vi.resetModules()
  sentryInitMock.mockClear()
  sentryCloseMock.mockClear()
  sentrySetUserMock.mockClear()
  storeState.userId = null
  process.env = { ...ORIGINAL_ENV }
})

afterEach(() => {
  vi.unstubAllEnvs()
  process.env = { ...ORIGINAL_ENV }
})

describe('fresh boot — consent defaults OFF', () => {
  it('initSentry() is a no-op while consent is OFF, even in a prod-like env', async () => {
    setProdLikeEnv()
    const { initSentry } = await loadModules()
    initSentry()
    expect(sentryInitMock).not.toHaveBeenCalled()
  })
})

describe('toggle ON post-boot — the SDK inits without restart', () => {
  it('setTelemetryConsent(true) initializes Sentry', async () => {
    setProdLikeEnv()
    const { setTelemetryConsent, telemetryConsent$ } = await loadModules()
    setTelemetryConsent(true)

    expect(telemetryConsent$.enabled.peek()).toBe(true)
    expect(sentryInitMock).toHaveBeenCalledTimes(1)
  })

  it('re-identifies a signed-in user on late opt-in (setUser with the user_id)', async () => {
    setProdLikeEnv()
    storeState.userId = 'user-late-optin'
    const { setTelemetryConsent } = await loadModules()
    setTelemetryConsent(true)

    expect(sentrySetUserMock).toHaveBeenCalledWith({ id: 'user-late-optin' })
  })

  it('does not identify when no user is signed in at opt-in time', async () => {
    setProdLikeEnv()
    storeState.userId = null
    const { setTelemetryConsent } = await loadModules()
    setTelemetryConsent(true)

    expect(sentrySetUserMock).not.toHaveBeenCalled()
  })
})

describe('toggle OFF post-boot — telemetry stops immediately', () => {
  it('setTelemetryConsent(false) closes the Sentry client', async () => {
    setProdLikeEnv()
    const { setTelemetryConsent, telemetryConsent$ } = await loadModules()
    setTelemetryConsent(true)

    setTelemetryConsent(false)

    expect(telemetryConsent$.enabled.peek()).toBe(false)
    // close() (not an options.enabled flip) is the revoke mechanism.
    expect(sentryCloseMock).toHaveBeenCalledTimes(1)
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
})
