// Shim for react-native-safe-area-context on web
// Based on starter-free template
const insets = { top: 0, right: 0, bottom: 0, left: 0 }
const frame = { x: 0, y: 0, width: 0, height: 0 }

module.exports = {
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: ({ children }) => children,
  useSafeAreaInsets: () => insets,
  useSafeAreaFrame: () => frame,
  SafeAreaInsetsContext: { Consumer: ({ children }) => children(insets) },
  SafeAreaFrameContext: { Consumer: ({ children }) => children(frame) },
  initialWindowMetrics: { insets, frame },
}
