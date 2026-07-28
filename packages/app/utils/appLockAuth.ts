/**
 * utils/appLockAuth.ts — web/desktop stub for the App Lock biometric surface.
 *
 * Platform-agnostic sibling of `utils/appLockAuth.native.ts`. Metro resolves
 * `.native.ts` on iOS/Android; Next/Tamagui resolves this `.ts` on web/desktop.
 * Biometric / device-credential auth is a mobile-only OS capability, so on
 * web/desktop App Lock uses an app-level passcode instead (see state/appLock.ts)
 * and neither export here is used on the unlock path. This file imports NONE of
 * the native auth SDKs, so the native biometric module is never pulled into the
 * web/desktop bundle (the boundary grep in "No regressions").
 */

export type AppLockCapabilityKind = 'biometric' | 'credential' | 'none'

export interface AppLockCapability {
  available: boolean
  kind: AppLockCapabilityKind
}

/**
 * Web/desktop has no biometric capability — the passcode path is used instead.
 * Reported as `kind: 'none'` so a caller can tell there is no OS biometric here.
 */
export async function getAppLockCapability(): Promise<AppLockCapability> {
  return { available: true, kind: 'none' }
}

/** Unused on web/desktop (passcode path handles unlocking). */
export async function promptAppLockAuth(): Promise<boolean> {
  return false
}
