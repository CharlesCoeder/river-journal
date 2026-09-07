import { usePathname } from 'solito/navigation'

/**
 * Current pathname for the Slider Hub. Web/desktop: solito's Next-backed hook.
 * Native has its own implementation (useHubPathname.native.ts) — see there for
 * why solito's cannot be used at the root layout.
 */
export function useHubPathname(): string | null | undefined {
  return usePathname()
}
