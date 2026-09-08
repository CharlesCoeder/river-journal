import { useCallback } from 'react'
import { useRouter } from 'solito/navigation'

/**
 * Returns a stable "go home" action.
 *
 * Web/desktop: a plain push to `/` — browser/Tauri history is the back stack
 * and pushing home is the expected behaviour.
 *
 * Native has its own implementation (useNavigateHome.native.ts) that pops the
 * root stack back to the always-present home route instead of pushing a
 * duplicate home on top, so the stack never accumulates
 * home → menu → settings → home → … and the edge back-swipe on home stays
 * inert.
 */
export function useNavigateHome(): () => void {
  const router = useRouter()
  return useCallback(() => {
    router.push('/')
  }, [router])
}
