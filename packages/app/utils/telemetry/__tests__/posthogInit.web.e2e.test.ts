/**
 * posthogInit.web.e2e.test.ts — TDD RED-PHASE E2E spec for the web/desktop
 * PostHog init wrapper.
 *
 * `apps/web` and `apps/desktop` both consume the SAME
 * `packages/app/utils/telemetry/posthog.ts` module (mirrors the existing
 * `sentry.ts` precedent: one shared module, thin per-app
 * `instrumentation-client.ts` call sites). This spec covers that shared
 * module directly — the full, platform-real workflow: init → the SDK is
 * configured against the US host with autocapture/session-recording off →
 * a user signs in (identify) → a user signs out (reset) — all through the
 * actual exported functions, with only the `posthog-js` SDK boundary mocked
 * (this repo's convention of mocking only the true I/O/SDK boundary, as in
 * `sentryInit.web.e2e.test.ts`).
 *
 * RED PHASE: `packages/app/utils/telemetry/posthog.ts` does not exist yet
 * (neither does `posthog-js` as an installed dependency of this workspace).
 * Every test below MUST fail until this story is implemented.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const posthogInitMock = vi.fn()
const posthogIdentifyMock = vi.fn()
const posthogResetMock = vi.fn()
const posthogCaptureMock = vi.fn()
const posthogRegisterMock = vi.fn()
const posthogSetPersonPropertiesMock = vi.fn()

vi.mock('posthog-js', () => ({
  default: {
    init: posthogInitMock,
    identify: posthogIdentifyMock,
    reset: posthogResetMock,
    capture: posthogCaptureMock,
    register: posthogRegisterMock,
    setPersonProperties: posthogSetPersonPropertiesMock,
  },
}))

const ORIGINAL_ENV = { ...process.env }

beforeEach(async () => {
  vi.resetModules()
  posthogInitMock.mockClear()
  posthogIdentifyMock.mockClear()
  posthogResetMock.mockClear()
  posthogCaptureMock.mockClear()
  posthogRegisterMock.mockClear()
  posthogSetPersonPropertiesMock.mockClear()
  process.env = { ...ORIGINAL_ENV }
  // Telemetry is opt-in: grant device-local consent so these env/wiring tests
  // exercise the enabled path. (Consent gating itself is covered in
  // consentGate.test.ts.) Imported after resetModules so it shares the fresh
  // module instance the SDK wrapper will read.
  const { telemetryConsent$ } = await import('../../../state/telemetryConsent')
  telemetryConsent$.enabled.set(true)
})

afterEach(() => {
  vi.unstubAllEnvs()
  process.env = { ...ORIGINAL_ENV }
})

describe('initPostHog (web/desktop) — init wiring exists and is callable end-to-end', () => {
  it('calling initPostHog() in a production-like env invokes posthog.init exactly once', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED = 'true'
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key_web'

    const { initPostHog } = await import('../posthog')
    initPostHog()

    expect(posthogInitMock).toHaveBeenCalledTimes(1)
  })

  it('the key handed to posthog.init is read from NEXT_PUBLIC_POSTHOG_KEY', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED = 'true'
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key_web'

    const { initPostHog } = await import('../posthog')
    initPostHog()

    const key = posthogInitMock.mock.calls[0]?.[0]
    expect(key).toBe('phc_test_key_web')
  })
})

describe('initPostHog (web/desktop) — US host default + override', () => {
  it('defaults api_host to https://us.i.posthog.com when NEXT_PUBLIC_POSTHOG_HOST is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED = 'true'
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key_web'
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST

    const { initPostHog } = await import('../posthog')
    initPostHog()

    const options = posthogInitMock.mock.calls[0]?.[1]
    expect(options?.api_host).toBe('https://us.i.posthog.com')
  })

  it('honors NEXT_PUBLIC_POSTHOG_HOST as an override', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED = 'true'
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key_web'
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://custom.posthog.example.com'

    const { initPostHog } = await import('../posthog')
    initPostHog()

    const options = posthogInitMock.mock.calls[0]?.[1]
    expect(options?.api_host).toBe('https://custom.posthog.example.com')
  })
})

describe('initPostHog (web/desktop) — autocapture + session recording are OFF', () => {
  it('posthog.init is called with autocapture: false and disable_session_recording: true', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED = 'true'
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key_web'

    const { initPostHog } = await import('../posthog')
    initPostHog()

    const options = posthogInitMock.mock.calls[0]?.[1]
    expect(options?.autocapture).toBe(false)
    expect(options?.disable_session_recording).toBe(true)
  })
})

describe('initPostHog (web/desktop) — dev environment is quiet', () => {
  it('in dev (NODE_ENV=development, enabled flag unset), posthog.init is never called with a real key', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    delete process.env.NEXT_PUBLIC_POSTHOG_ENABLED
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_prod_key_should_not_be_used'

    const { initPostHog } = await import('../posthog')
    initPostHog()

    if (posthogInitMock.mock.calls.length === 0) {
      // Acceptable: PostHog is disabled entirely in dev.
      expect(posthogInitMock).not.toHaveBeenCalled()
    } else {
      // Acceptable: init was called, but not with the production key.
      const key = posthogInitMock.mock.calls[0]?.[0]
      expect(key).not.toBe('phc_prod_key_should_not_be_used')
    }
  })

  it('with no key configured at all, initPostHog() is a no-op regardless of environment', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED = 'true'
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY

    const { initPostHog } = await import('../posthog')
    initPostHog()

    expect(posthogInitMock).not.toHaveBeenCalled()
  })
})

describe('identifyPostHogUser (web/desktop) — identity is Supabase user_id ONLY', () => {
  it('identifyPostHogUser(userId) calls posthog.identify with the user_id and nothing else', async () => {
    const { identifyPostHogUser } = await import('../posthog')
    identifyPostHogUser('user-abc-123')

    expect(posthogIdentifyMock).toHaveBeenCalledTimes(1)
    const call = posthogIdentifyMock.mock.calls[0]
    expect(call?.[0]).toBe('user-abc-123')
    // No $set / property payload carrying email, name, or other PII.
    const propsArg = call?.[1]
    if (propsArg !== undefined) {
      expect(propsArg).not.toHaveProperty('email')
      expect(propsArg).not.toHaveProperty('name')
      expect(propsArg).not.toHaveProperty('$set')
    }
  })

  it('passing null clears identity by calling posthog.reset() (sign-out)', async () => {
    const { identifyPostHogUser } = await import('../posthog')
    identifyPostHogUser(null)

    expect(posthogResetMock).toHaveBeenCalledTimes(1)
    expect(posthogIdentifyMock).not.toHaveBeenCalled()
  })
})

describe('initPostHog / identifyPostHogUser (web/desktop) — no super-properties or $set person properties beyond identity', () => {
  it('initializing and identifying a user never registers super-properties or sets person properties', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED = 'true'
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key_web'

    const { initPostHog, identifyPostHogUser } = await import('../posthog')
    initPostHog()
    identifyPostHogUser('user-abc-123')

    expect(posthogRegisterMock).not.toHaveBeenCalled()
    expect(posthogSetPersonPropertiesMock).not.toHaveBeenCalled()
  })
})
