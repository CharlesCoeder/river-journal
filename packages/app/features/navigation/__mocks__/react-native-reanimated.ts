/**
 * Minimal stub for react-native-reanimated in Vitest/Node.js environments.
 * The real implementation runs on native/web via the Expo build pipeline.
 * Only the exports referenced by the hub pager and the editor overlay are
 * stubbed here.
 */
export const useSharedValue = (_initial: unknown) => ({ value: _initial })
export const makeMutable = <T>(initial: T) => ({ value: initial })
export const useAnimatedStyle = (fn: () => unknown) => fn()
export const useAnimatedReaction = (_prepare: () => unknown, _react: (value: unknown) => void) => {}
export const useDerivedValue = (fn: () => unknown) => ({ value: fn() })
export const withSpring = (value: number) => value
export const withTiming = (value: number) => value
export const withDelay = (_delay: number, value: number) => value
export const cancelAnimation = (_value: unknown) => {}
export const runOnJS =
  <T extends (...args: unknown[]) => unknown>(fn: T) =>
  (...args: Parameters<T>) =>
    fn(...args)

const Animated = {
  View: 'View',
  Text: 'Text',
}
export default Animated
