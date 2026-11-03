import { Platform, PlatformColor } from 'react-native'

// With no placeholder color set, single-line fields drew UIKit's placeholderText
// color up to Expo SDK 54. From SDK 58 they draw a darker gray, though React
// Native's code did not change. Multi-line fields set placeholderText explicitly
// and were unaffected. Naming the color keeps every input as it was. iOS only:
// Android has no color by this name.
export const inputPlaceholderColor = Platform.OS === 'ios' ? PlatformColor('placeholderText') : undefined
