import { NativeToast as Toast } from './NativeToast'

// Platform detection without expo-constants to avoid warnings on web/desktop
const isExpo = (() => {
  try {
    // Only import expo-constants in React Native environments
    if (typeof window === 'undefined' && typeof navigator !== 'undefined') {
      // We're in React Native
      const Constants = require('expo-constants')
      return Constants?.executionEnvironment === 'storeClient'
    }
    return false
  } catch {
    // If expo-constants is not available, we're not in Expo
    return false
  }
})()

export const CustomToast = () => {
  if (isExpo) {
    return null
  }
  return <Toast />
}
