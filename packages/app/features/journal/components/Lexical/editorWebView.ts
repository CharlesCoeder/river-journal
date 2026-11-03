/**
 * Expo DOM components default to @expo/dom-webview. The editors stay on
 * react-native-webview, the host their keyboard, inset and hub-drag behavior was
 * built and verified against. Moving to the new host deserves its own testing.
 */
export const EDITOR_WEBVIEW = { useExpoDOMWebView: false } as const
