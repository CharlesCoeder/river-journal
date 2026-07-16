/**
 * initializeApp.test.ts — boot-time resume of an interrupted post-deletion
 * local cleanup.
 *
 * If the app is closed mid-cleanup (after the confirmation flow set the
 * persisted flag but before the seam finished), the flag survives restart
 * and must be re-driven on the next boot so the local purge/sign-out
 * eventually finishes without the user having to do anything. This file
 * covers the extracted boot-resume helper in isolation, plus a source-level
 * check that its call site sits in the right place inside
 * `initializePersistence()` (after the auth listener is wired, never
 * awaited on the boot critical path).
 *
 * Every direct collaborator of `state/initializeApp.ts` is mocked so
 * importing the module — and exercising the boot-resume helper alone —
 * never pulls in real persistence, Supabase, or platform-only code
 * (mirrors the supabase/persistConfig mocking precedent used elsewhere in
 * this directory for modules that transitively reach `state/store.ts`).
 *
 * Red-phase: `state/initializeApp.ts` does not export a boot-resume helper
 * today, and `initializePersistence()` does not yet call anything keyed off
 * `deviceState$.pendingAccountCleanup`. The named import below fails at
 * module load until the extraction lands — every test in this file is red
 * until then.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Controllable session user id for the boot-telemetry gate's re-identify read.
const { storeState } = vi.hoisted(() => ({
  storeState: { userId: null as string | null },
}))

vi.mock('../persistConfig', () => ({
  configurePersistence: vi.fn(),
}))
vi.mock('../store', () => ({
  store$: {
    session: {
      userId: { peek: () => storeState.userId },
    },
  },
  countUndecidedOrphans: vi.fn(() => ({ flowCount: 0, entryCount: 0 })),
}))
vi.mock('../billing', () => ({
  billingReceipt$: {},
}))
vi.mock('../appOpenReValidation', () => ({
  scheduleAppOpenReValidation: vi.fn(),
}))
vi.mock('../flows', () => ({ flows$: {} }))
vi.mock('../entries', () => ({ entries$: {} }))
vi.mock('../grace_days', () => ({ graceDays$: {} }))
vi.mock('../push_tokens', () => ({ pushTokens$: {} }))
vi.mock('../../utils/auth', () => ({
  initAuthListener: vi.fn(),
}))
vi.mock('../encryptionSetup', () => ({
  isEncryptionReadyForSync$: {},
}))
vi.mock('../lapsed', () => ({
  lapsed$: {},
  recordSessionOpen: vi.fn(),
}))
vi.mock('../onboarding', () => ({ onboarding$: {} }))
vi.mock('../authReturn', () => ({
  authReturn$: {},
  flushPendingAgeAttestation: vi.fn(),
}))
vi.mock('../timezoneSync', () => ({
  syncDeviceTimezone: vi.fn(),
}))
vi.mock('../today', () => ({
  startTodayTracking: vi.fn(),
}))
vi.mock('../streak', () => ({}))

// Telemetry collaborators — mocked so importing initializeApp never pulls the
// real Sentry/PostHog SDKs into this boot-resume unit test.
vi.mock('../../utils/telemetry/sentry', () => ({
  initSentry: vi.fn(),
  setSentryUser: vi.fn(),
  disableSentry: vi.fn(),
}))
vi.mock('../../utils/telemetry/posthog', () => ({
  initPostHog: vi.fn(),
  identifyPostHogUser: vi.fn(),
  captureEvent: vi.fn(),
  disablePostHog: vi.fn(),
  enablePostHog: vi.fn(),
}))
vi.mock('../telemetryConsent', async () => {
  const { observable } =
    await vi.importActual<typeof import('@legendapp/state')>('@legendapp/state')
  return {
    telemetryConsent$: observable({ enabled: false }),
    setTelemetryConsentEnabled: vi.fn(),
  }
})

// ─── app/state/accountCleanup — the seam the boot-resume helper re-fires ────
const runPostDeletionCleanupMock = vi.fn()
vi.mock('../accountCleanup', () => ({
  runPostDeletionCleanup: (...args: unknown[]) => runPostDeletionCleanupMock(...args),
}))

// ─── app/state/syncConfig — the persisted flag the helper checks on boot ────
vi.mock('../syncConfig', async () => {
  const { observable } =
    await vi.importActual<typeof import('@legendapp/state')>('@legendapp/state')
  const deviceState$ = observable({ pendingAccountCleanup: false })
  return {
    generateUUID: () => 'test-uuid',
    isSyncReady$: observable(false),
    syncUserId$: observable<string | null>(null),
    orphanFlowsPending$: observable<unknown>(null),
    deviceState$,
  }
})

import { deviceState$ } from '../syncConfig'
import { telemetryConsent$ } from '../telemetryConsent'
import { initSentry, setSentryUser } from '../../utils/telemetry/sentry'
import { enablePostHog, identifyPostHogUser, initPostHog } from '../../utils/telemetry/posthog'
// resumePendingAccountCleanupIfNeeded does not exist yet — fails at import
// until the boot-resume extraction lands (this is the expected red state).
import { applyBootTelemetryGate, resumePendingAccountCleanupIfNeeded } from '../initializeApp'

const pendingAccountCleanup$ = deviceState$.pendingAccountCleanup

beforeEach(() => {
  runPostDeletionCleanupMock.mockReset().mockResolvedValue(undefined)
  pendingAccountCleanup$.set(false)
})

describe('resumePendingAccountCleanupIfNeeded — boot resume', () => {
  it('fires the cleanup seam once when the hydrated persisted flag is true', () => {
    pendingAccountCleanup$.set(true)

    resumePendingAccountCleanupIfNeeded()

    expect(runPostDeletionCleanupMock).toHaveBeenCalledTimes(1)
  })

  it('never fires the cleanup seam when the hydrated persisted flag is false', () => {
    pendingAccountCleanup$.set(false)

    resumePendingAccountCleanupIfNeeded()

    expect(runPostDeletionCleanupMock).not.toHaveBeenCalled()
  })

  it('does not block on the seam — a never-resolving cleanup does not hang the caller', () => {
    pendingAccountCleanup$.set(true)
    runPostDeletionCleanupMock.mockReturnValue(new Promise(() => {}))

    expect(() => resumePendingAccountCleanupIfNeeded()).not.toThrow()
  })

  it('swallows a rejecting seam on the boot path (fire-and-forget, metadata-only .catch — never surfaced to the caller)', async () => {
    pendingAccountCleanup$.set(true)
    runPostDeletionCleanupMock.mockRejectedValue(new Error('boot-resume cleanup failed'))

    expect(() => resumePendingAccountCleanupIfNeeded()).not.toThrow()
    // Flush the rejected microtask — an unhandled rejection here would fail
    // the test run, which is exactly the "swallowed" contract being checked.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

describe('applyBootTelemetryGate — persisted-consent boot gate (executed, not grepped)', () => {
  beforeEach(() => {
    vi.mocked(initSentry).mockClear()
    vi.mocked(initPostHog).mockClear()
    vi.mocked(enablePostHog).mockClear()
    vi.mocked(setSentryUser).mockClear()
    vi.mocked(identifyPostHogUser).mockClear()
    storeState.userId = null
    telemetryConsent$.enabled.set(false)
  })

  it('consent OFF ⇒ initializes nothing', () => {
    telemetryConsent$.enabled.set(false)

    applyBootTelemetryGate()

    expect(initSentry).not.toHaveBeenCalled()
    expect(initPostHog).not.toHaveBeenCalled()
    expect(enablePostHog).not.toHaveBeenCalled()
    expect(setSentryUser).not.toHaveBeenCalled()
    expect(identifyPostHogUser).not.toHaveBeenCalled()
  })

  it('consent ON ⇒ inits Sentry + PostHog and re-asserts opt-in', () => {
    telemetryConsent$.enabled.set(true)
    storeState.userId = null

    applyBootTelemetryGate()

    expect(initSentry).toHaveBeenCalledTimes(1)
    expect(initPostHog).toHaveBeenCalledTimes(1)
    expect(enablePostHog).toHaveBeenCalledTimes(1)
    // No persisted user ⇒ no identify.
    expect(setSentryUser).not.toHaveBeenCalled()
    expect(identifyPostHogUser).not.toHaveBeenCalled()
  })

  it('consent ON with a persisted user ⇒ re-identifies that user (user_id only)', () => {
    telemetryConsent$.enabled.set(true)
    storeState.userId = 'user-persisted-123'

    applyBootTelemetryGate()

    expect(setSentryUser).toHaveBeenCalledWith('user-persisted-123')
    expect(identifyPostHogUser).toHaveBeenCalledWith('user-persisted-123')
  })
})

describe('boot wiring — call-site placement inside initializePersistence()', () => {
  const SOURCE = readFileSync(path.resolve(__dirname, '../initializeApp.ts'), 'utf8')

  it('calls the boot-resume helper AFTER initAuthListener() (so a re-hydrated lingering session still gets torn down)', () => {
    const authListenerIdx = SOURCE.indexOf('initAuthListener()')
    const resumeIdx = SOURCE.indexOf('resumePendingAccountCleanupIfNeeded()')

    expect(authListenerIdx, 'initAuthListener() call site not found').toBeGreaterThanOrEqual(0)
    expect(
      resumeIdx,
      'resumePendingAccountCleanupIfNeeded() call site not found'
    ).toBeGreaterThanOrEqual(0)
    expect(authListenerIdx).toBeLessThan(resumeIdx)
  })

  it('never awaits the boot-resume helper on the boot critical path', () => {
    expect(SOURCE).not.toMatch(/await\s+resumePendingAccountCleanupIfNeeded\s*\(/)
  })
})
