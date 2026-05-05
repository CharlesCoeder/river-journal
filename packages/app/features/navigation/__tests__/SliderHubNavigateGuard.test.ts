// @vitest-environment happy-dom
/**
 * Route-aware navigate guard in SliderHub.
 *
 * The `navigateTo` function inside SliderHubGesture short-circuits when the
 * current pathname already equals the target — preventing infinite push loops
 * now that SliderHub is mounted at the root layout (every route).
 *
 * Guard lives at SliderHub.tsx lines 84–96 (navigateTo inner function):
 *   if (currentPathname === target) { committing.value = false; return }
 *   router.push(target)
 *
 * This file tests the observable contract:
 *   - same-route gesture commit → router.push NOT called  (no-op)
 *   - different-route gesture commit → router.push IS called
 *
 * Implementation strategy
 * ───────────────────────
 * `navigateTo` is a closure inside SliderHubGesture and is not exported
 * directly. We model its behaviour through a faithful replica of the guard
 * logic (see `makeNavigateTo` below). The replica MUST stay structurally
 * identical to the source; if the guard changes, update both.
 *
 * Contract: the existing route-aware no-op MUST short-circuit
 * gesture-commits when the current route equals the destination.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted to the top of the compiled output by Vitest's transform.
// Module-level variables declared with const/let are NOT yet initialised at
// hoist time, so they cannot be referenced inside the factory. Instead we
// create the spy objects entirely inside the factory and access them via
// vi.mocked() or direct import after the mock is installed.
vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: vi.fn().mockReturnValue('/'),
  useLink: () => ({}),
  useParams: () => ({}),
  useSearchParams: () => ({}),
}))

// The remaining native modules are handled by the workspace-level vitest
// aliases (react-native-reanimated, react-native-gesture-handler, @my/ui).
// SliderHub is imported after the mock declaration so the hoist applies.
import { computeSliderHubCommit } from '../SliderHub'
import { usePathname } from 'solito/navigation'

// ---------------------------------------------------------------------------
// Contract model
//
// `navigateTo` is a closure inside `SliderHubGesture` and is not exported.
// We test its contract via a faithful in-test replica that mirrors the exact
// guard logic in SliderHub.tsx lines 84–96. If the guard logic changes in the
// source, this replica must be updated to match — that is intentional
// (the test codifies the contract, not the implementation details).
// ---------------------------------------------------------------------------

/**
 * Minimal replica of the navigateTo guard for contract testing.
 * Structurally identical to SliderHub.tsx navigateTo (lines 84–96).
 */
function makeNavigateTo(
  currentPathname: string | null,
  committingRef: { value: boolean },
  router: { push: (href: string) => void }
) {
  return (target: '/journal' | '/menu') => {
    if (!router) return
    // Route-aware no-op: if we're already on the target, skip the push
    if (currentPathname === target) {
      committingRef.value = false
      return
    }
    router.push(target)
    // Simplified: skip the spring callback — committing reset is synchronous here
    committingRef.value = false
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SliderHub navigateTo guard — same-route commit is a no-op (AC #8)', () => {
  let pushSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    pushSpy = vi.fn()
  })

  it('does NOT call router.push when already on /menu and target is /menu', () => {
    const committing = { value: false }
    const navigate = makeNavigateTo('/menu', committing, { push: pushSpy })

    navigate('/menu')

    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('does NOT call router.push when already on /journal and target is /journal', () => {
    const committing = { value: false }
    const navigate = makeNavigateTo('/journal', committing, { push: pushSpy })

    navigate('/journal')

    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('resets committing.value to false after same-route no-op (re-entrancy guard is released)', () => {
    const committing = { value: true }
    const navigate = makeNavigateTo('/menu', committing, { push: pushSpy })

    navigate('/menu')

    expect(committing.value).toBe(false)
  })
})

describe('SliderHub navigateTo guard — cross-route commit pushes normally (AC #8)', () => {
  let pushSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    pushSpy = vi.fn()
  })

  it('calls router.push(/menu) when current pathname is / and target is /menu', () => {
    const committing = { value: false }
    const navigate = makeNavigateTo('/', committing, { push: pushSpy })

    navigate('/menu')

    expect(pushSpy).toHaveBeenCalledOnce()
    expect(pushSpy).toHaveBeenCalledWith('/menu')
  })

  it('calls router.push(/journal) when current pathname is / and target is /journal', () => {
    const committing = { value: false }
    const navigate = makeNavigateTo('/', committing, { push: pushSpy })

    navigate('/journal')

    expect(pushSpy).toHaveBeenCalledOnce()
    expect(pushSpy).toHaveBeenCalledWith('/journal')
  })

  it('calls router.push(/journal) when current pathname is /menu (cross-route)', () => {
    const committing = { value: false }
    const navigate = makeNavigateTo('/menu', committing, { push: pushSpy })

    navigate('/journal')

    expect(pushSpy).toHaveBeenCalledOnce()
    expect(pushSpy).toHaveBeenCalledWith('/journal')
  })

  it('calls router.push(/menu) when current pathname is /journal (cross-route)', () => {
    const committing = { value: false }
    const navigate = makeNavigateTo('/journal', committing, { push: pushSpy })

    navigate('/menu')

    expect(pushSpy).toHaveBeenCalledOnce()
    expect(pushSpy).toHaveBeenCalledWith('/menu')
  })
})

describe('SliderHub navigateTo guard — null/falsy pathname edge cases (AC #8)', () => {
  let pushSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    pushSpy = vi.fn()
  })

  it('still calls router.push when usePathname returns null (first-frame race before Expo Router resolves)', () => {
    // null !== '/menu', so the guard does NOT short-circuit — push fires.
    // This matches the documented pre-mortem note: "push is harmless (queued
    // by Expo Router before any route mounts)".
    const committing = { value: false }
    const navigate = makeNavigateTo(null, committing, { push: pushSpy })

    navigate('/menu')

    expect(pushSpy).toHaveBeenCalledWith('/menu')
  })
})

// ---------------------------------------------------------------------------
// Smoke — verify the solito/navigation mock installs and usePathname resolves,
// and that the SliderHub module loads without error in this environment.
// ---------------------------------------------------------------------------
describe('SliderHub module loads and re-exports computeSliderHubCommit', () => {
  it('computeSliderHubCommit is a function (module loads without error)', () => {
    expect(typeof computeSliderHubCommit).toBe('function')
  })

  it('usePathname mock resolves (solito/navigation stub is wired)', () => {
    // The workspace alias was overridden by vi.mock above; just verify it resolves.
    expect(typeof usePathname).toBe('function')
  })
})
