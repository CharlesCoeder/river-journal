// @vitest-environment happy-dom
/**
 * appLock.e2e.test.ts — TDD red-phase E2E (integration) tests for the App
 * Lock state layer: the device-scoped non-synced preference observable, the
 * pure auto-lock timing helper, the passcode verifier round-trip, the
 * background/foreground lifecycle wiring, the persistence contract, and the
 * boundary-hygiene greps.
 *
 * Red-phase contract: `packages/app/state/appLock.ts` and
 * `packages/app/state/appLockTracking.ts` do not exist yet — this whole file
 * fails at the top-level `import` with a module-resolution error until they
 * are created, per this repo's established red-phase convention (see
 * `BillingDisclosure.test.tsx` / `ReminderSettings.test.tsx`). Every
 * assertion below is therefore expected to FAIL (via collection error) before
 * implementation and PASS after.
 *
 * ASSUMED CONTRACT (some of this is pinned precisely by the story; the rest
 * is a reasonable inference from the Dev Notes and existing conventions —
 * flagged so the implementer can confirm or the QA suite can be adjusted):
 *   - `appLock$` observable + `setAppLockEnabled` / `setAutoLockInterval` /
 *     `setPasscode` / `clearPasscode` are exported from `state/appLock.ts`.
 *   - `shouldRelock(backgroundedAt, now, interval)` is exported from
 *     `state/appLock.ts`.
 *   - `setPasscode` / `verifyPasscode` accept an optional second `overrides`
 *     argument — `{ deriveMasterKeyFromPassword? }` — mirroring the
 *     "injectable/override seam" the Dev Notes explicitly call for so the
 *     verifier round-trip test doesn't pay the real N=2^17 scrypt cost.
 *     ASSUMPTION: exact param name/shape; the implementer may need to align
 *     this file's call sites if a different seam shape is chosen.
 *   - The background/foreground lifecycle controller lives in a new sibling
 *     module `state/appLockTracking.ts`, exporting `startAppLockTracking()` /
 *     `stopAppLockTracking()`, modeled on `state/today.ts`'s
 *     `startTodayTracking`/`stopTodayTracking`. ASSUMPTION: file/function
 *     names — the behavior is specified but not this exact module boundary.
 *
 * Coverage map:
 *   - the auto-lock interval governs re-lock timing end-to-end (lifecycle
 *     wiring + the pure re-lock helper's boundary matrix)
 *   - the background timestamp used for re-lock timing is recorded on a true
 *     backgrounding transition only, never on a transient foreground blip
 *     (the OS snapshot-cover trigger is a separate, OS-level concern not
 *     observable from this test environment)
 *   - the device-scoped non-synced persistence contract (table registration,
 *     schema version, persistence gate, sync-config exclusion)
 *   - the biometric native dependency is present for the mobile build
 *     (necessary-but-not-sufficient signal — the native prebuild itself is
 *     not vitest-observable)
 *   - the pure re-lock helper's full boundary set; the passcode verifier
 *     round-trip, no-plaintext assertion, validation boundaries, and
 *     clear-passcode nulling both stored fields
 *   - boundary greps (no native-module / query-library / remote-sync leaks;
 *     the preference observable never appears in the sync configuration)
 */

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── react-native AppState mock — capture the registered handler so tests can
// fire synthetic 'active' | 'background' | 'inactive' transitions without
// depending on react-native-web's binary (visibilitychange-only) shim, which
// has no 'inactive' state at all. ──────────────────────────────────────────
type AppStateStatus = 'active' | 'background' | 'inactive'
let appStateHandler: ((status: AppStateStatus) => void) | null = null
const mockAppStateRemove = vi.fn()

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: vi.fn((type: string, handler: (status: AppStateStatus) => void) => {
      if (type === 'change') appStateHandler = handler
      return { remove: mockAppStateRemove }
    }),
    currentState: 'active' as AppStateStatus,
  },
  Platform: { OS: 'ios' },
}))

const STATE_DIR = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(__dirname, '../../../..')

// Real crypto helpers — cheap (salt gen, AES encrypt/decrypt); only the
// scrypt KDF itself is expensive, and that's what the override seam bypasses.
import { generateEncryptionSalt } from '../../utils/encryption'

// Fast, deterministic stand-in for deriveMasterKeyFromPassword: same
// (password, salt) always yields the same 32-byte key; different inputs
// yield different keys — enough to exercise match/mismatch without paying
// the real N=2^17 scrypt cost in every test run.
const fakeDeriveMasterKeyFromPassword = async (
  password: string,
  saltB64: string
): Promise<Uint8Array> => {
  const digest = createHash('sha256').update(`${password}::${saltB64}`).digest()
  return new Uint8Array(digest)
}

import {
  appLock$,
  setAppLockEnabled,
  setAutoLockInterval,
  setPasscode,
  verifyPasscode,
  clearPasscode,
  shouldRelock,
} from '../appLock'
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
  appStateHandler = null
  mockAppStateRemove.mockClear()
})

afterEach(() => {
  stopAppLockTracking()
  vi.clearAllMocks()
})

// ============================================================================
// The pure re-lock helper — shouldRelock full boundary set
// ============================================================================

describe('shouldRelock(backgroundedAt, now, interval): the full contractual boundary set', () => {
  it('backgroundedAt === null → false for every interval (cold-start locking is a separate path)', () => {
    expect(shouldRelock(null, Date.now(), 'immediately')).toBe(false)
    expect(shouldRelock(null, Date.now(), '1m')).toBe(false)
    expect(shouldRelock(null, Date.now(), '5m')).toBe(false)
  })

  it('"immediately" → true for any recorded background transition, regardless of elapsed time', () => {
    const now = 1_000_000
    expect(shouldRelock(now - 1, now, 'immediately')).toBe(true)
    expect(shouldRelock(now - 500_000, now, 'immediately')).toBe(true)
  })

  it('"1m" → false just-under, true exactly-at (inclusive), true just-over', () => {
    const backgroundedAt = 1_000_000
    expect(shouldRelock(backgroundedAt, backgroundedAt + 59_999, '1m')).toBe(false)
    expect(shouldRelock(backgroundedAt, backgroundedAt + 60_000, '1m')).toBe(true)
    expect(shouldRelock(backgroundedAt, backgroundedAt + 60_001, '1m')).toBe(true)
  })

  it('"5m" → false just-under, true exactly-at (inclusive), true just-over', () => {
    const backgroundedAt = 1_000_000
    expect(shouldRelock(backgroundedAt, backgroundedAt + 299_999, '5m')).toBe(false)
    expect(shouldRelock(backgroundedAt, backgroundedAt + 300_000, '5m')).toBe(true)
    expect(shouldRelock(backgroundedAt, backgroundedAt + 300_001, '5m')).toBe(true)
  })

  it('clock-skew (now < backgroundedAt) → never spuriously unlocks: false for 1m/5m, still true for "immediately"', () => {
    const backgroundedAt = 2_000_000
    const now = 1_000_000 // now is BEFORE backgroundedAt — non-monotonic clock / DST shift
    expect(shouldRelock(backgroundedAt, now, '1m')).toBe(false)
    expect(shouldRelock(backgroundedAt, now, '5m')).toBe(false)
    expect(shouldRelock(backgroundedAt, now, 'immediately')).toBe(true)
  })
})

// ============================================================================
// Passcode verifier round-trip (full workflow through appLock$)
// ============================================================================

describe('passcode verifier round-trip: setPasscode → verifyPasscode, no plaintext ever persisted', () => {
  it('a matching re-derivation verifies true; a wrong passcode verifies false', async () => {
    await setPasscode('secret123', { deriveMasterKeyFromPassword: fakeDeriveMasterKeyFromPassword })

    const correct = await verifyPasscode('secret123', {
      deriveMasterKeyFromPassword: fakeDeriveMasterKeyFromPassword,
    })
    expect(correct).toBe(true)

    const wrong = await verifyPasscode('wrongpass', {
      deriveMasterKeyFromPassword: fakeDeriveMasterKeyFromPassword,
    })
    expect(wrong).toBe(false)
  })

  it('never writes a plaintext passcode anywhere on appLock$ — only passcodeSalt + passcodeVerifier', async () => {
    await setPasscode('secret123', { deriveMasterKeyFromPassword: fakeDeriveMasterKeyFromPassword })

    const snapshot = appLock$.get()
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('secret123')
    expect(Object.keys(snapshot).sort()).toEqual(
      ['autoLockInterval', 'enabled', 'passcodeSalt', 'passcodeVerifier'].sort()
    )
    expect(typeof snapshot.passcodeSalt).toBe('string')
    expect(typeof snapshot.passcodeVerifier).toBe('string')
  })

  it('exactly-6 characters is accepted; 5 is rejected', async () => {
    await expect(
      setPasscode('12345', { deriveMasterKeyFromPassword: fakeDeriveMasterKeyFromPassword })
    ).rejects.toBeTruthy()
    expect(appLock$.passcodeSalt.get()).toBeNull()

    await expect(
      setPasscode('123456', { deriveMasterKeyFromPassword: fakeDeriveMasterKeyFromPassword })
    ).resolves.not.toThrow()
    expect(appLock$.passcodeSalt.get()).not.toBeNull()
  })

  it('a whitespace-only passcode is rejected', async () => {
    await expect(
      setPasscode('      ', { deriveMasterKeyFromPassword: fakeDeriveMasterKeyFromPassword })
    ).rejects.toBeTruthy()
    expect(appLock$.passcodeSalt.get()).toBeNull()
  })

  it('does NOT trim — significant leading/trailing whitespace is derived and verified as-entered', async () => {
    await setPasscode('  secret123  ', {
      deriveMasterKeyFromPassword: fakeDeriveMasterKeyFromPassword,
    })

    // The exact entered string (with whitespace) must verify true...
    const withSpaces = await verifyPasscode('  secret123  ', {
      deriveMasterKeyFromPassword: fakeDeriveMasterKeyFromPassword,
    })
    expect(withSpaces).toBe(true)

    // ...and the trimmed variant must NOT verify (different derived key).
    const trimmed = await verifyPasscode('secret123', {
      deriveMasterKeyFromPassword: fakeDeriveMasterKeyFromPassword,
    })
    expect(trimmed).toBe(false)
  })

  it('clearPasscode() nulls BOTH passcodeSalt and passcodeVerifier (no stale-verifier reuse on re-enable)', async () => {
    await setPasscode('secret123', { deriveMasterKeyFromPassword: fakeDeriveMasterKeyFromPassword })
    expect(appLock$.passcodeSalt.get()).not.toBeNull()
    expect(appLock$.passcodeVerifier.get()).not.toBeNull()

    clearPasscode()

    expect(appLock$.passcodeSalt.get()).toBeNull()
    expect(appLock$.passcodeVerifier.get()).toBeNull()
  })

  it('re-enabling after clearPasscode() generates a FRESH salt — never verifies against a stale verifier', async () => {
    await setPasscode('firstpass', { deriveMasterKeyFromPassword: fakeDeriveMasterKeyFromPassword })
    const firstSalt = appLock$.passcodeSalt.get()
    clearPasscode()

    await setPasscode('secondpass', {
      deriveMasterKeyFromPassword: fakeDeriveMasterKeyFromPassword,
    })
    const secondSalt = appLock$.passcodeSalt.get()

    expect(secondSalt).not.toBeNull()
    expect(secondSalt).not.toBe(firstSalt)

    // The old passcode must no longer verify against the new state.
    const oldVerifies = await verifyPasscode('firstpass', {
      deriveMasterKeyFromPassword: fakeDeriveMasterKeyFromPassword,
    })
    expect(oldVerifies).toBe(false)
  })
})

// ============================================================================
// Background/foreground lifecycle wiring (real appLockTracking
// controller + real appLock$/ephemeral$, synthetic AppState events)
// ============================================================================

describe('auto-lock interval governs re-lock timing end-to-end via the lifecycle controller', () => {
  it('does NOT relock on foreground when backgrounded for LESS than the configured interval (1m)', () => {
    setAutoLockInterval('1m')
    setAppLockEnabled(true)
    ephemeral$.isLocked.set(false)

    startAppLockTracking()
    expect(appStateHandler).not.toBeNull()

    const start = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(start)
    appStateHandler?.('background')

    vi.spyOn(Date, 'now').mockReturnValue(start + 30_000) // 30s < 60s interval
    appStateHandler?.('active')

    expect(ephemeral$.isLocked.get()).toBe(false)
    vi.restoreAllMocks()
  })

  it('DOES relock on foreground when backgrounded for AT LEAST the configured interval (1m)', () => {
    setAutoLockInterval('1m')
    setAppLockEnabled(true)
    ephemeral$.isLocked.set(false)

    startAppLockTracking()

    const start = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(start)
    appStateHandler?.('background')

    vi.spyOn(Date, 'now').mockReturnValue(start + 61_000) // > 60s interval
    appStateHandler?.('active')

    expect(ephemeral$.isLocked.get()).toBe(true)
    vi.restoreAllMocks()
  })

  it('"immediately" (default) relocks on foreground after ANY backgrounding, however brief', () => {
    setAutoLockInterval('immediately')
    setAppLockEnabled(true)
    ephemeral$.isLocked.set(false)

    startAppLockTracking()

    const start = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(start)
    appStateHandler?.('background')

    vi.spyOn(Date, 'now').mockReturnValue(start + 5) // 5ms later
    appStateHandler?.('active')

    expect(ephemeral$.isLocked.get()).toBe(true)
    vi.restoreAllMocks()
  })

  it('when App Lock is disabled, foregrounding never re-locks regardless of elapsed time', () => {
    setAutoLockInterval('immediately')
    setAppLockEnabled(false)
    ephemeral$.isLocked.set(false)

    startAppLockTracking()
    appStateHandler?.('background')
    appStateHandler?.('active')

    expect(ephemeral$.isLocked.get()).toBe(false)
  })
})

describe('the background timestamp is recorded on a true "background" transition only, never on a transient "inactive" blip', () => {
  it('a run of "inactive" → "active" blips (Control Center / notification shade / call banner) never triggers a relock, even with "immediately"', () => {
    setAutoLockInterval('immediately')
    setAppLockEnabled(true)
    ephemeral$.isLocked.set(false)

    startAppLockTracking()

    // Several transient inactive/active cycles WITHOUT ever going fully
    // 'background' must never arm the auto-lock clock.
    appStateHandler?.('inactive')
    appStateHandler?.('active')
    appStateHandler?.('inactive')
    appStateHandler?.('active')

    expect(ephemeral$.isLocked.get()).toBe(false)
  })

  it('a genuine "background" transition DOES arm the clock, even if preceded by "inactive" blips', () => {
    setAutoLockInterval('immediately')
    setAppLockEnabled(true)
    ephemeral$.isLocked.set(false)

    startAppLockTracking()

    appStateHandler?.('inactive') // transient — must not arm the clock
    appStateHandler?.('background') // real backgrounding — must arm the clock
    appStateHandler?.('active')

    expect(ephemeral$.isLocked.get()).toBe(true)
  })
})

// ============================================================================
// Device-scoped, non-synced persistence contract
// ============================================================================

describe('appLock$ persists device-scoped and non-synced; ephemeral$.isLocked never persists', () => {
  it('"app-lock" is registered in persistConfig TABLE_NAMES and DB_VERSION is bumped past 10', () => {
    const persistConfigSrc = readFileSync(path.join(STATE_DIR, 'persistConfig.ts'), 'utf8')
    expect(persistConfigSrc).toMatch(/['"]app-lock['"]/)

    const versionMatch = persistConfigSrc.match(/DB_VERSION\s*=\s*(\d+)/)
    expect(versionMatch).not.toBeNull()
    expect(Number(versionMatch?.[1])).toBeGreaterThan(10)
  })

  it('initializeApp.ts wires appLock$ through syncObservable(...) AND awaits its isPersistLoaded in the persistence gate', () => {
    const initSrc = readFileSync(path.join(STATE_DIR, 'initializeApp.ts'), 'utf8')
    expect(initSrc).toMatch(/syncObservable\(\s*appLock\$/)
    expect(initSrc).toMatch(/when\(syncState\(appLock\$\)\.isPersistLoaded\)/)
  })

  it('appLock$ is NEVER registered in syncConfig.ts (grep-assert — no Supabase sync path exists)', () => {
    const syncConfigSrc = readFileSync(path.join(STATE_DIR, 'syncConfig.ts'), 'utf8')
    expect(syncConfigSrc).not.toMatch(/appLock\$/)
    expect(syncConfigSrc).not.toMatch(/['"]app-lock['"]/)
  })

  it('appLock$ is never added to SYNC_CURSOR_TABLES', () => {
    const persistConfigSrc = readFileSync(path.join(STATE_DIR, 'persistConfig.ts'), 'utf8')
    const cursorTablesMatch = persistConfigSrc.match(
      /SYNC_CURSOR_TABLES\s*=\s*\[([^\]]*)\]/
    )
    expect(cursorTablesMatch).not.toBeNull()
    expect(cursorTablesMatch?.[1] ?? '').not.toMatch(/app-lock/)
  })

  it('toggling appLock$.enabled triggers no Supabase write (appLock module never imports the supabase client)', () => {
    const appLockSrc = readFileSync(path.join(STATE_DIR, 'appLock.ts'), 'utf8')
    expect(appLockSrc).not.toMatch(/from ['"].*\/supabase['"]/)
    expect(appLockSrc).not.toMatch(/syncedSupabase/)
  })

  it('ephemeral$.isLocked defaults to false and is not part of any persisted table name', () => {
    expect(ephemeral$.isLocked.get()).toBe(false)
    const storeSrc = readFileSync(path.join(STATE_DIR, 'store.ts'), 'utf8')
    // isLocked lives on ephemeral$, which this repo's convention keeps out of
    // persistConfig entirely — a sanity check that the field exists at all.
    expect(storeSrc).toMatch(/isLocked/)
  })
})

// ============================================================================
// The biometric native dependency (necessary-but-not-sufficient
// signal; the native prebuild itself cannot be verified from vitest)
// ============================================================================

describe('the biometric/device-credential native module is installed as a mobile dependency', () => {
  it('apps/mobile/package.json lists expo-local-authentication', () => {
    const mobilePkgPath = path.join(REPO_ROOT, 'apps/mobile/package.json')
    expect(existsSync(mobilePkgPath)).toBe(true)
    const pkg = JSON.parse(readFileSync(mobilePkgPath, 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(deps['expo-local-authentication']).toBeTruthy()
  })
})

// ============================================================================
// Boundary greps / no-leak hygiene
// ============================================================================

describe('boundary greps stay green', () => {
  it('utils/appLockAuth.ts (web/desktop stub) contains no expo-* import', () => {
    const abs = path.resolve(__dirname, '../../utils/appLockAuth.ts')
    expect(existsSync(abs), 'expected packages/app/utils/appLockAuth.ts to exist').toBe(true)
    const src = readFileSync(abs, 'utf8')
    expect(src).not.toMatch(/expo-local-authentication|expo-/)
  })

  it('state/appLock.ts contains no @tanstack/react-query, syncedSupabase, or expo-* import', () => {
    const src = readFileSync(path.join(STATE_DIR, 'appLock.ts'), 'utf8')
    expect(src).not.toMatch(/@tanstack\/react-query|syncedSupabase|expo-/)
  })
})
