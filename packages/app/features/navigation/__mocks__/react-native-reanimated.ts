/**
 * Minimal stub for react-native-reanimated in Vitest/Node.js environments.
 * The real implementation runs on native/web via the Expo build pipeline.
 * Only the exports referenced by SliderHub.tsx are stubbed here.
 */
export const useSharedValue = (_initial: unknown) => ({ value: _initial })
export const useAnimatedStyle = (fn: () => unknown) => fn()
export const withSpring = (value: number) => value
export const withTiming = (value: number) => value
export const runOnJS =
  <T extends (...args: unknown[]) => unknown>(fn: T) =>
  (...args: Parameters<T>) =>
    fn(...args)

const Animated = {
  View: 'View',
  Text: 'Text',
}
export default Animated
