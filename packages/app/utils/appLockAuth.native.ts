/**
 * utils/appLockAuth.native.ts — the native (iOS/Android) App Lock biometric
 * surface. Wraps `expo-local-authentication` behind the same shape as the
 * web/desktop stub (utils/appLockAuth.ts) so shared/feature code imports the
 * extensionless path and Metro binds this real implementation while Next/Tamagui
 * binds the stub — keeping the native SDK out of the web/desktop bundle.
 *
 * Capability: a biometric enrollment is preferred; if biometrics are absent but
 * a device passcode/PIN/pattern exists, the OS device-credential fallback is
 * used. If neither exists, App Lock cannot be enabled.
 *
 * Prompt: `authenticateAsync({ disableDeviceFallback: false })` so the OS device
 * credential satisfies the prompt when biometrics are unavailable or fail — this
 * is also the capability-revocation safety net (an enrollment removed after
 * enablement still surfaces the device-credential prompt).
 */

import * as LocalAuthentication from 'expo-local-authentication'

export type AppLockCapabilityKind = 'biometric' | 'credential' | 'none'

export interface AppLockCapability {
  available: boolean
  kind: AppLockCapabilityKind
}

export async function getAppLockCapability(): Promise<AppLockCapability> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync()
  const isEnrolled = await LocalAuthentication.isEnrolledAsync()

  if (hasHardware && isEnrolled) {
    return { available: true, kind: 'biometric' }
  }

  // No usable biometric — fall back to the OS device credential when one is set.
  const level = await LocalAuthentication.getEnrolledLevelAsync()
  if (level === LocalAuthentication.SecurityLevel.SECRET) {
    return { available: true, kind: 'credential' }
  }

  return { available: false, kind: 'none' }
}

export async function promptAppLockAuth(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    disableDeviceFallback: false,
    promptMessage: 'Unlock River Journal',
  })
  return result.success
}
