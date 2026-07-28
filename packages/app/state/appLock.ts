/**
 * state/appLock.ts
 *
 * Local-only, per-device App Lock preference. NEVER synced to Supabase — the
 * on/off choice, the auto-lock interval, and the passcode material (salt +
 * verifier) are a per-device decision that intentionally does not travel with
 * the account. Persistence is wired separately in initializeApp.ts (IndexedDB
 * on web/desktop, MMKV on native), mirroring onboarding$ / deviceState$.
 *
 * App Lock is a casual-access barrier, NOT encryption. It gates the UI shell on
 * cold start and on return-from-background; it never touches journal content.
 *
 * The transient locked/unlocked flag lives on `ephemeral$.isLocked`
 * (state/store.ts) and is deliberately NOT stored here — it must reset on every
 * cold start so a fresh launch re-locks when the preference is enabled.
 *
 * Web/desktop passcode: reuses the app's canonical scrypt KDF
 * (deriveMasterKeyFromPassword) plus the AEAD verifier pattern — a known
 * constant is encrypted with the passcode-derived key to form the verifier. We
 * persist ONLY { passcodeSalt, passcodeVerifier }; never the passcode, never the
 * derived key.
 */

import { observable } from '@legendapp/state'
import {
  decryptFlowContent,
  deriveMasterKeyFromPassword,
  encryptFlowContent,
  generateEncryptionSalt,
} from '../utils/encryption'

export type AutoLockInterval = 'immediately' | '1m' | '5m'

export interface AppLockState {
  enabled: boolean
  autoLockInterval: AutoLockInterval
  passcodeSalt: string | null
  passcodeVerifier: string | null
}

export const appLock$ = observable<AppLockState>({
  enabled: false,
  autoLockInterval: 'immediately',
  passcodeSalt: null,
  passcodeVerifier: null,
})

/** Auto-lock thresholds in milliseconds (the `immediately` case has none). */
const INTERVAL_MS: Record<Exclude<AutoLockInterval, 'immediately'>, number> = {
  '1m': 60_000,
  '5m': 300_000,
}

/** Minimum passcode length for web/desktop App Lock. */
export const MIN_PASSCODE_LENGTH = 6

/**
 * The known constant encrypted with the passcode-derived key to make the
 * verifier. On unlock we re-derive from the entered passcode + stored salt and
 * check the verifier decrypts back to this — positive proof the passcode is
 * correct without ever storing the passcode or the derived key.
 */
const PASSCODE_VERIFIER_PLAINTEXT = 'river-app-lock-check-v1'

/**
 * Injectable seam so tests can substitute a fast, deterministic key-derivation
 * for the real N=2^17 scrypt KDF. Production code never passes overrides.
 */
export interface PasscodeCryptoOverrides {
  deriveMasterKeyFromPassword?: (password: string, saltB64: string) => Promise<Uint8Array>
}

/**
 * Pure re-lock timing helper. Given the timestamp the app was last backgrounded
 * (or null if it never backgrounded this session), the current time, and the
 * configured interval, decide whether returning to the foreground should
 * re-lock. No observable reads — kept pure so the boundary math is unit-tested
 * without a native runtime.
 *
 * Contract:
 *  - `backgroundedAt === null` → false (cold-start locking is a separate path).
 *  - `immediately` → true for any recorded background, regardless of elapsed.
 *  - `1m` / `5m` → true once elapsed is INCLUSIVELY at/over the threshold.
 *  - clock skew (`now < backgroundedAt`) → false for 1m/5m (never spuriously
 *    unlock), still true for `immediately`.
 */
export function shouldRelock(
  backgroundedAt: number | null,
  now: number,
  interval: AutoLockInterval
): boolean {
  if (backgroundedAt === null) return false
  if (interval === 'immediately') return true
  const elapsed = now - backgroundedAt
  if (elapsed < 0) return false
  return elapsed >= INTERVAL_MS[interval]
}

/** Enable or disable the App Lock preference. */
export function setAppLockEnabled(enabled: boolean): void {
  appLock$.enabled.set(enabled)
}

/** Persist the chosen auto-lock interval. */
export function setAutoLockInterval(interval: AutoLockInterval): void {
  appLock$.autoLockInterval.set(interval)
}

/**
 * Validate a candidate passcode. Exactly-6 is accepted; 5 is rejected. A
 * whitespace-only passcode is rejected. Crucially, the value is NOT trimmed —
 * the derived key uses the exact string entered, so trimming here would desync
 * setup vs. unlock.
 */
function assertValidPasscode(passcode: string): void {
  if (passcode.length < MIN_PASSCODE_LENGTH) {
    throw new Error(`Passcode must be at least ${MIN_PASSCODE_LENGTH} characters.`)
  }
  if (passcode.trim().length === 0) {
    throw new Error('Passcode cannot be blank.')
  }
}

/**
 * Derive a key from the passcode (exact string, no trim) + a fresh 32-byte
 * salt, build a verifier by encrypting the known constant, and persist ONLY
 * { passcodeSalt, passcodeVerifier }. Rejects an invalid passcode before any
 * derivation.
 */
export async function setPasscode(
  passcode: string,
  overrides?: PasscodeCryptoOverrides
): Promise<void> {
  assertValidPasscode(passcode)
  const derive = overrides?.deriveMasterKeyFromPassword ?? deriveMasterKeyFromPassword
  const salt = generateEncryptionSalt()
  const key = await derive(passcode, salt)
  const verifier = encryptFlowContent(PASSCODE_VERIFIER_PLAINTEXT, key)
  appLock$.passcodeSalt.set(salt)
  appLock$.passcodeVerifier.set(verifier)
}

/**
 * Re-derive from the entered passcode + stored salt and check it against the
 * stored verifier. Returns false when no passcode is set, when derivation
 * fails, or when the verifier does not decrypt back to the known constant.
 */
export async function verifyPasscode(
  passcode: string,
  overrides?: PasscodeCryptoOverrides
): Promise<boolean> {
  const salt = appLock$.passcodeSalt.peek()
  const verifier = appLock$.passcodeVerifier.peek()
  if (!salt || !verifier) return false
  const derive = overrides?.deriveMasterKeyFromPassword ?? deriveMasterKeyFromPassword
  try {
    const key = await derive(passcode, salt)
    return decryptFlowContent(verifier, key) === PASSCODE_VERIFIER_PLAINTEXT
  } catch {
    return false
  }
}

/**
 * Null BOTH the salt and the verifier so re-enabling later generates a fresh
 * salt and can never verify against a stale verifier from a forgotten passcode.
 */
export function clearPasscode(): void {
  appLock$.passcodeSalt.set(null)
  appLock$.passcodeVerifier.set(null)
}
