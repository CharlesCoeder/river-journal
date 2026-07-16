/**
 * Web/Desktop app-version source.
 *
 * Kept as a tiny platform-split helper (native reads it from expo-constants)
 * so version-carrying modules stay platform-free and can receive the version as
 * a plain string. Mirrors the app's declared version.
 */
export const APP_VERSION = '1.0.0'

export function getAppVersion(): string {
  return APP_VERSION
}
