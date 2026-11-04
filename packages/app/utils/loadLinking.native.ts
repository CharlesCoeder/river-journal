import { Linking } from 'react-native'

// Not `import('react-native')`: dynamic import copies every export, which runs
// React Native's lazy getters, and PushNotificationIOS throws when its native module
// is not linked. The import would reject and the link would silently never open.
export function loadLinking(): Promise<typeof Linking> {
  return Promise.resolve(Linking)
}
