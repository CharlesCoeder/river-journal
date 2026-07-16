/**
 * posthogInit.native.e2e.test.ts — TDD RED-PHASE E2E spec for the mobile
 * PostHog init wrapper.
 *
 * Mirrors `posthogInit.web.e2e.test.ts` for `apps/mobile`, which consumes
 * `packages/app/utils/telemetry/posthog.native.ts`. Per the story's Dev
 * Notes, `posthog-react-native` is instance-based (not a global singleton
 * like `posthog-js`) — the module holds a module-level `PostHog` instance
 * and exposes the SAME `initPostHog()` / `identifyPostHogUser()` /
 * `captureEvent()` surface as `posthog.ts` so call sites are
 * platform-agnostic. The native SDK is not test-loadable under Vitest, so
 * `posthog-react-native` is mocked at the module boundary — the same
 * pattern `sentryInit.native.e2e.test.ts` uses for `@sentry/react-native`
 * and `pushTokens.native.test.ts` uses for `expo-notifications`.
 *
 * This file imports `../posthog.native` directly (not the extension-less
 * `../posthog` specifier) so it exercises the actual mobile module under
 * Vitest's plain Node module resolution.
 *
 * RED PHASE: `packages/app/utils/telemetry/posthog.native.ts` does not exist
 * yet (neither does `posthog-react-native` as an installed dependency of
 * `apps/mobile`). Every test below MUST fail until this story is
 * implemented.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const posthogConstructorMock = vi.fn()
const posthogIdentifyMock = vi.fn()
const posthogResetMock = vi.fn()
const posthogCaptureMock = vi.fn()
const posthogRegisterMock = vi.fn()

class MockPostHog {
  constructor(apiKey: string, options: unknown) {
    posthogConstructorMock(apiKey, options)
  }
  identify(...args: unknown[]) {
    posthogIdentifyMock(...args)
  }
  reset(...args: unknown[]) {
    posthogResetMock(...args)
  }
  capture(...args: unknown[]) {
    posthogCaptureMock(...args)
  }
  register(...args: unknown[]) {
    posthogRegisterMock(...args)
  }
}

vi.mock('posthog-react-native', () => ({
  default: MockPostHog,
  PostHog: MockPostHog,
}))

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  posthogConstructorMock.mockClear()
  posthogIdentifyMock.mockClear()
  posthogResetMock.mockClear()
  posthogCaptureMock.mockClear()
  posthogRegisterMock.mockClear()
  process.env = { ...ORIGINAL_ENV }
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
})

describe('initPostHog (mobile) — init wiring exists and is callable end-to-end', () => {
  it('calling initPostHog() in a release-like env constructs a PostHog instance exactly once', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_POSTHOG_ENABLED = 'true'
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test_key_native'

    const { initPostHog } = await import('../posthog.native')
    initPostHog()

    expect(posthogConstructorMock).toHaveBeenCalledTimes(1)
  })

  it('the key handed to the PostHog constructor is read from EXPO_PUBLIC_POSTHOG_KEY', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_POSTHOG_ENABLED = 'true'
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test_key_native'

    const { initPostHog } = await import('../posthog.native')
    initPostHog()

    const key = posthogConstructorMock.mock.calls[0]?.[0]
    expect(key).toBe('phc_test_key_native')
  })
})

describe('initPostHog (mobile) — EU host default + override', () => {
  it('defaults host to https://eu.posthog.com when EXPO_PUBLIC_POSTHOG_HOST is unset', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_POSTHOG_ENABLED = 'true'
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test_key_native'
    delete process.env.EXPO_PUBLIC_POSTHOG_HOST

    const { initPostHog } = await import('../posthog.native')
    initPostHog()

    const options = posthogConstructorMock.mock.calls[0]?.[1] as { host?: string } | undefined
    expect(options?.host).toBe('https://eu.posthog.com')
  })

  it('honors EXPO_PUBLIC_POSTHOG_HOST as an override', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_POSTHOG_ENABLED = 'true'
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test_key_native'
    process.env.EXPO_PUBLIC_POSTHOG_HOST = 'https://custom.posthog.example.com'

    const { initPostHog } = await import('../posthog.native')
    initPostHog()

    const options = posthogConstructorMock.mock.calls[0]?.[1] as { host?: string } | undefined
    expect(options?.host).toBe('https://custom.posthog.example.com')
  })
})

describe('initPostHog (mobile) — autocapture + session replay are OFF', () => {
  it('the PostHog instance is constructed with autocapture disabled and no session-replay config enabled', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_POSTHOG_ENABLED = 'true'
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test_key_native'

    const { initPostHog } = await import('../posthog.native')
    initPostHog()

    const options = posthogConstructorMock.mock.calls[0]?.[1] as Record<string, unknown>
    // Accept either a boolean `autocapture: false` or a granular
    // `captureNativeAppLifecycleEvents`-style object with tracking disabled —
    // the SDK version's exact option name is an implementation detail; what
    // MUST hold is that autocapture is not left enabled.
    expect(options?.autocapture === false || options?.autocapture === undefined).toBe(true)
    if (options?.autocapture && typeof options.autocapture === 'object') {
      expect((options.autocapture as Record<string, unknown>).captureTouches).not.toBe(true)
    }
    // Session replay must never be turned on.
    expect(options?.enableSessionReplay).not.toBe(true)
    expect(options?.sessionReplayConfig).toBeFalsy()
  })
})

describe('initPostHog (mobile) — dev environment is quiet (__DEV__ gating)', () => {
  it('under __DEV__ without opt-in, the PostHog constructor is never called with the production key', async () => {
    vi.stubGlobal('__DEV__', true)
    delete process.env.EXPO_PUBLIC_POSTHOG_ENABLED
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_prod_key_should_not_be_used'

    const { initPostHog } = await import('../posthog.native')
    initPostHog()

    if (posthogConstructorMock.mock.calls.length === 0) {
      expect(posthogConstructorMock).not.toHaveBeenCalled()
    } else {
      const key = posthogConstructorMock.mock.calls[0]?.[0]
      expect(key).not.toBe('phc_prod_key_should_not_be_used')
    }
  })

  it('with no key configured at all, initPostHog() is a no-op regardless of environment', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_POSTHOG_ENABLED = 'true'
    delete process.env.EXPO_PUBLIC_POSTHOG_KEY

    const { initPostHog } = await import('../posthog.native')
    initPostHog()

    expect(posthogConstructorMock).not.toHaveBeenCalled()
  })
})

describe('identifyPostHogUser (mobile) — identity is Supabase user_id ONLY', () => {
  it('identifyPostHogUser(userId) calls the instance identify() with the user_id and nothing else', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_POSTHOG_ENABLED = 'true'
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test_key_native'

    const { initPostHog, identifyPostHogUser } = await import('../posthog.native')
    initPostHog()
    identifyPostHogUser('user-xyz-789')

    expect(posthogIdentifyMock).toHaveBeenCalledTimes(1)
    const call = posthogIdentifyMock.mock.calls[0]
    expect(call?.[0]).toBe('user-xyz-789')
    const propsArg = call?.[1]
    if (propsArg !== undefined) {
      expect(propsArg).not.toHaveProperty('email')
      expect(propsArg).not.toHaveProperty('name')
      expect(propsArg).not.toHaveProperty('$set')
    }
  })

  it('passing null clears identity by calling reset() (sign-out)', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_POSTHOG_ENABLED = 'true'
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test_key_native'

    const { initPostHog, identifyPostHogUser } = await import('../posthog.native')
    initPostHog()
    identifyPostHogUser(null)

    expect(posthogResetMock).toHaveBeenCalledTimes(1)
    expect(posthogIdentifyMock).not.toHaveBeenCalled()
  })

  it('identifyPostHogUser never throws when initPostHog() was never called (disabled / no instance)', async () => {
    const { identifyPostHogUser } = await import('../posthog.native')
    expect(() => identifyPostHogUser('user-xyz-789')).not.toThrow()
    expect(() => identifyPostHogUser(null)).not.toThrow()
  })
})

describe('initPostHog / identifyPostHogUser (mobile) — no super-properties beyond identity', () => {
  it('initializing and identifying a user never registers super-properties', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_POSTHOG_ENABLED = 'true'
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test_key_native'

    const { initPostHog, identifyPostHogUser } = await import('../posthog.native')
    initPostHog()
    identifyPostHogUser('user-xyz-789')

    expect(posthogRegisterMock).not.toHaveBeenCalled()
  })
})
