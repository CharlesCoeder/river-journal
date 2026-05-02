/**
 * Minimal stub for @my/ui in Vitest/Node.js test environments.
 * Only exports referenced by SliderHub.tsx are stubbed here.
 */
export const useMedia = () => ({
  sm: false,
  md: true,
  lg: true,
  xl: false,
  xxl: false,
})

export const useReducedMotion = () => false
