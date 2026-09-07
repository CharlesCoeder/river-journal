import { useCallback } from 'react'
import { router } from 'expo-router'

/**
 * Native "go home": pop the root stack back to the home route.
 *
 * `unstable_settings.initialRouteName = 'index'` in apps/mobile/app/_layout.tsx
 * guarantees home is always the first route in the root stack (even on deep
 * links), so `dismissTo('/')` always pops rather than pushes. Pushing `/`
 * (the web behaviour) would leave duplicate home entries under every
 * round-trip and make the edge back-swipe on home land on stale screens.
 *
 * Uses the imperative router so this is safe to call from effects and
 * callbacks alike; expo-router resolves the target navigator itself, so it
 * also works from inside the nested `journal/` stack.
 */
export function useNavigateHome(): () => void {
  return useCallback(() => {
    router.dismissTo('/')
  }, [])
}
