import { useEffect, useState } from 'react'
import { AccessibilityInfo, Platform } from 'react-native'

/**
 * Cross-platform hook that returns `true` when the OS/browser has
 * requested reduced motion, `false` otherwise.
 *
 * - Web: reads `prefers-reduced-motion` via `window.matchMedia` and
 *   subscribes to `change` events for live toggling.
 * - Native: reads `AccessibilityInfo.isReduceMotionEnabled()` and
 *   subscribes to `reduceMotionChanged` for live toggling.
 * - SSR: returns `false` (default to motion-allowed) to avoid hydration
 *   mismatch.
 */
export function useReducedMotion(): boolean {
  const getInitial = (): boolean => {
    if (Platform.OS !== 'web') return false
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  const [reduceMotion, setReduceMotion] = useState<boolean>(getInitial)

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      const handler = (e: MediaQueryListEvent) => setReduceMotion(e.matches)
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
    // Native path
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => sub.remove()
  }, [])

  return reduceMotion
}
