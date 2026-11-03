import { Platform } from 'react-native'

/**
 * Which WebView hosts the Expo DOM editors.
 *
 * iOS stays on react-native-webview, the host its keyboard, inset and hub-drag
 * behavior was built and verified against. Expo's new default deserves its own
 * testing there.
 *
 * Android uses Expo's DOM WebView. On SDK 58, react-native-webview there never
 * receives the host OS the DOM runtime needs, so the editor stays blank.
 */
export const EDITOR_WEBVIEW = { useExpoDOMWebView: Platform.OS === 'android' } as const
