/**
 * captureEvent.e2e.test.ts — TDD RED-PHASE E2E spec for the ONE sanctioned
 * capture path, `captureEvent(event, props)`.
 *
 * This is the full, real workflow: an app call site invokes `captureEvent`
 * → it validates `props` against the real `eventAllowlist.ts` → unknown
 * keys are stripped → the runtime content-key net and the free-text
 * value-level net both run → only the surviving sanitized payload reaches
 * the mocked `posthog-js` SDK boundary. Only the true SDK boundary
 * (`posthog-js`) is mocked; `eventAllowlist.ts` and `contentKeys.ts` are
 * the REAL modules for almost every test here, exercising the actual
 * validation logic end-to-end (mirrors `redactor.e2e.test.ts` exercising
 * the real redactor through the real `beforeSend` pipeline).
 *
 * One test ("defense-in-depth net") deliberately mocks `../eventAllowlist`
 * to simulate an allowlist entry that has (incorrectly) admitted a
 * content-shaped key, in order to prove `captureEvent`'s OWN redundant
 * runtime check catches it independently of the allowlist — this is the
 * exact "two independent nets" scenario the design calls out: a prop key
 * must be refused even if it somehow appears (correctly or not) in an
 * allowlist entry.
 *
 * RED PHASE: `packages/app/utils/telemetry/posthog.ts` (and
 * `eventAllowlist.ts`) do not exist yet. Every test below MUST fail until
 * this story is implemented.
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

beforeEach(() => {
  vi.resetModules()
  posthogInitMock.mockClear()
  posthogIdentifyMock.mockClear()
  posthogResetMock.mockClear()
  posthogCaptureMock.mockClear()
  posthogRegisterMock.mockClear()
  posthogSetPersonPropertiesMock.mockClear()
  process.env = { ...ORIGINAL_ENV }
  // Enable capture for the duration of these tests (dev-gating is covered
  // separately in posthogInit.web.e2e.test.ts).
  process.env.NEXT_PUBLIC_POSTHOG_ENABLED = 'true'
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key_web'
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  // The defense-in-depth test registers a per-test vi.doMock('../eventAllowlist');
  // resetModules() clears the module cache but NOT the mock registry, so without
  // this the simulated allowlist would leak into later tests. Un-mock so every
  // test sees the real eventAllowlist regardless of execution order.
  vi.doUnmock('../eventAllowlist')
  process.env = { ...ORIGINAL_ENV }
})

describe('captureEvent — unknown prop keys are stripped before send', () => {
  it('a prop key not documented for the event never reaches posthog.capture', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { captureEvent } = await import('../posthog')

    captureEvent('flow_started', {
      user_id: 'user-1',
      tier: 'free',
      secretDebugField: 'should never be sent',
    } as any)

    expect(posthogCaptureMock).toHaveBeenCalledTimes(1)
    const [, sentProps] = posthogCaptureMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(sentProps).not.toHaveProperty('secretDebugField')
    expect(sentProps).toEqual({ user_id: 'user-1', tier: 'free' })
  })
})

describe('captureEvent — dev-only warnings', () => {
  it('warns in dev when an unknown key is stripped', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { captureEvent } = await import('../posthog')

    captureEvent('flow_started', { user_id: 'user-1', tier: 'free', bogus: 'x' } as any)

    expect(warnSpy).toHaveBeenCalled()
  })

  it('warns in dev when a documented prop is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { captureEvent } = await import('../posthog')

    captureEvent('flow_started', { user_id: 'user-1' } as any)

    expect(warnSpy).toHaveBeenCalled()
  })

  it('does not warn in production for a fully valid call', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { captureEvent } = await import('../posthog')

    captureEvent('flow_started', { user_id: 'user-1', tier: 'free' } as any)

    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('captureEvent — an event absent from the allowlist is a no-op that never throws', () => {
  it('never calls posthog.capture for an unenumerated event name', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { captureEvent } = await import('../posthog')

    expect(() => captureEvent('some_event_nobody_added_to_the_allowlist' as any, {} as any)).not.toThrow()
    expect(posthogCaptureMock).not.toHaveBeenCalled()
  })

  it('warns in dev for the unenumerated event', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { captureEvent } = await import('../posthog')

    captureEvent('some_event_nobody_added_to_the_allowlist' as any, {} as any)

    expect(warnSpy).toHaveBeenCalled()
  })
})

describe('captureEvent — malformed input never throws', () => {
  it('undefined props does not throw', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { captureEvent } = await import('../posthog')
    expect(() => captureEvent('flow_started', undefined as any)).not.toThrow()
  })

  it('captureEvent(event) with no props argument at all does not throw', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { captureEvent } = await import('../posthog')
    expect(() => (captureEvent as any)('flow_started')).not.toThrow()
  })
})

describe('captureEvent — runtime content-key net is independent of the allowlist (defense-in-depth, Red Team hardening)', () => {
  it('strips a prop key that isContentKey() matches even when a (simulated, compromised) allowlist entry admits it', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    // Simulate a bug where the allowlist itself was misconfigured to allow a
    // content-shaped key ("body") for an event, and validation says it's
    // fine. captureEvent's OWN independent isContentKey() check must still
    // refuse to send it — this is the exact "two independent nets"
    // scenario the design calls for.
    vi.doMock('../eventAllowlist', () => ({
      EVENT_ALLOWLIST: {
        flow_started: { props: ['user_id', 'tier', 'body'], description: 'test fixture' },
      },
      validateEventProps: (_event: string, props: Record<string, unknown>) => ({
        sanitizedProps: props,
        strippedKeys: [],
        missingKeys: [],
      }),
      getWordCountBucket: (n: number) => (n < 100 ? '<100' : '100-499'),
    }))

    const { captureEvent } = await import('../posthog')

    captureEvent('flow_started', {
      user_id: 'user-1',
      tier: 'free',
      body: 'this should never leave the device no matter what the allowlist says',
    } as any)

    if (posthogCaptureMock.mock.calls.length > 0) {
      const [, sentProps] = posthogCaptureMock.mock.calls[0] as [string, Record<string, unknown>]
      expect(sentProps).not.toHaveProperty('body')
      expect(JSON.stringify(sentProps)).not.toContain('this should never leave the device')
    }
  })
})

describe('captureEvent — free-text VALUE net catches an allowed key holding prose (Red Team hardening: "allowed key, forbidden value")', () => {
  const LONG_PROSE =
    'I told my therapist about what happened last spring and it felt like a weight lifted ' +
    'off my chest that I did not know I was carrying for this long, finally.'

  it('drops a long sentence-shaped value passed into an allowed prop (e.g. milestone) while preserving other valid props', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { captureEvent } = await import('../posthog')

    captureEvent('streak_unlock_earned', {
      user_id: 'user-1',
      tier: 'free',
      milestone: LONG_PROSE,
    } as any)

    if (posthogCaptureMock.mock.calls.length > 0) {
      const [, sentProps] = posthogCaptureMock.mock.calls[0] as [string, Record<string, unknown>]
      expect(JSON.stringify(sentProps)).not.toContain('told my therapist')
      expect(sentProps.user_id).toBe('user-1')
      expect(sentProps.tier).toBe('free')
    }
  })

  it('preserves a short, id/enum-shaped value in the same prop', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { captureEvent } = await import('../posthog')

    captureEvent('streak_unlock_earned', {
      user_id: 'user-1',
      tier: 'free',
      milestone: 30,
    } as any)

    expect(posthogCaptureMock).toHaveBeenCalledTimes(1)
    const [, sentProps] = posthogCaptureMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(sentProps.milestone).toBe(30)
  })
})

describe('captureEvent — no super-properties / $set person properties are ever registered', () => {
  it('a full session of init + identify + multiple captureEvent calls never touches super-properties or person-property APIs', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { initPostHog, identifyPostHogUser, captureEvent } = await import('../posthog')

    initPostHog()
    identifyPostHogUser('user-1')
    captureEvent('flow_started', { user_id: 'user-1', tier: 'free' } as any)
    captureEvent('collective_post_submitted', { user_id: 'user-1', tier: 'free' } as any)

    expect(posthogRegisterMock).not.toHaveBeenCalled()
    expect(posthogSetPersonPropertiesMock).not.toHaveBeenCalled()
  })
})
