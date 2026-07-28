// @vitest-environment happy-dom
/**
 * appLockTracking.web.test.ts — unit coverage for the web/desktop branch of the
 * App Lock lifecycle controller. The native (AppState) branch is exercised by
 * appLock.e2e.test.ts; this file covers the `window` blur/focus path that only
 * runs when Platform.OS === 'web', which that suite (Platform.OS mocked to
 * 'ios') never reaches.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Platform.OS 'web' selects the document/window branch; AppState is unused here
// but must exist as an import target.
vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Platform: { OS: 'web' },
}))

import { appLock$, setAppLockEnabled, setAutoLockInterval } from '../appLock'
import { ephemeral$ } from '../store'
import { startAppLockTracking, stopAppLockTracking } from '../appLockTracking'

beforeEach(() => {
  appLock$.set({
    enabled: false,
    autoLockInterval: 'immediately',
    passcodeSalt: null,
    passcodeVerifier: null,
  })
  ephemeral$.isLocked.set(false)
})

afterEach(() => {
  stopAppLockTracking()
  vi.restoreAllMocks()
})

describe('web/desktop auto-lock lifecycle (window blur/focus)', () => {
  it('re-locks on focus after a blur when enabled with the Immediately interval', () => {
    setAutoLockInterval('immediately')
    setAppLockEnabled(true)
    startAppLockTracking()

    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))

    expect(ephemeral$.isLocked.get()).toBe(true)
  })

  it('does not re-lock on focus without a preceding blur (no recorded background)', () => {
    setAutoLockInterval('immediately')
    setAppLockEnabled(true)
    startAppLockTracking()

    window.dispatchEvent(new Event('focus'))

    expect(ephemeral$.isLocked.get()).toBe(false)
  })

  it('does not re-lock while App Lock is disabled, however long backgrounded', () => {
    setAutoLockInterval('immediately')
    setAppLockEnabled(false)
    startAppLockTracking()

    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))

    expect(ephemeral$.isLocked.get()).toBe(false)
  })

  it('respects the 1m interval: a short blur does not re-lock', () => {
    setAutoLockInterval('1m')
    setAppLockEnabled(true)
    startAppLockTracking()

    const start = 1_000_000
    vi.spyOn(Date, 'now').mockReturnValue(start)
    window.dispatchEvent(new Event('blur'))
    vi.spyOn(Date, 'now').mockReturnValue(start + 30_000) // 30s < 60s
    window.dispatchEvent(new Event('focus'))

    expect(ephemeral$.isLocked.get()).toBe(false)
  })

  it('stops listening after teardown — a later blur/focus cycle has no effect', () => {
    setAutoLockInterval('immediately')
    setAppLockEnabled(true)
    startAppLockTracking()
    stopAppLockTracking()

    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))

    expect(ephemeral$.isLocked.get()).toBe(false)
  })
})
