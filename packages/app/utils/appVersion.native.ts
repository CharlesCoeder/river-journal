/**
 * React Native app-version source — reads the version declared in app.json via
 * expo-constants (the same access pattern used elsewhere in the native app),
 * falling back to a constant if it is unavailable.
 */
import Constants from 'expo-constants'

export function getAppVersion(): string {
  return Constants.expoConfig?.version ?? '1.0.0'
}
