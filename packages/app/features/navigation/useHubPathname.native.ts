import { usePathname } from 'expo-router'

/**
 * Current pathname for the Slider Hub on native.
 *
 * Solito's `usePathname` reads `useRoute().path`, i.e. the route of the
 * NEAREST ENCLOSING SCREEN. The hub is mounted in the root layout, outside any
 * screen, so that hook returns nothing there and the hub would treat every
 * screen as home — a slide on the menu resolved to "open the editor". Expo
 * Router's `usePathname` reads the global router store instead, so it is
 * correct anywhere inside the app and re-renders on every navigation.
 */
export function useHubPathname(): string | null | undefined {
  return usePathname()
}
