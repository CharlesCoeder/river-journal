/**
 * Minimal stub for react-native-gesture-handler in Vitest/Node.js environments.
 * The real implementation requires native build tooling.
 * Only the exports referenced by HubGestureHost are stubbed here.
 */
export const GestureHandlerRootView = 'View'
export const GestureDetector = ({ children }: { children: unknown }) => children

const panBuilder = {
  enabled: function () {
    return this
  },
  activeOffsetX: function () {
    return this
  },
  failOffsetY: function () {
    return this
  },
  onStart: function () {
    return this
  },
  onUpdate: function () {
    return this
  },
  onEnd: function () {
    return this
  },
}

export const Gesture = {
  Pan: () => ({ ...panBuilder }),
}
