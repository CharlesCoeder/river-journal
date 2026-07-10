// @vitest-environment happy-dom
/**
 * Home-forward-to-Collective post-auth routing.
 *
 * ASSUMED CONTRACT (see the account-gate feature's "Project Structure Notes"
 * — the suggested new-file path for this concern): a Legend-State observable
 * `pendingCollectiveReturn$` (boolean, local-only, persisted) lives in
 * `packages/app/state/authReturn.ts`. It is set truthy by the auth gate
 * before navigating home, rehydrated before this effect can run, and
 * consumed by a HomeScreen effect that:
 *   - clears the marker BEFORE calling `router.replace('/collective')`
 *     (clear-before-navigate, single-fire)
 *   - only fires once `isSyncReady$` (packages/app/state/syncConfig.ts,
 *     existing/unmodified) is true
 *   - does nothing when no marker is pending (direct `/auth` visit)
 *   - is also clearable by a manual authenticated Collective tap
 *     (stale-marker tolerance)
 *
 * If the real implementation names this module/export differently, update
 * the import below to match — the effect-level assertions (single-fire,
 * clear-before-navigate, no-op when not-ready/no-marker) are the contract
 * this file locks in. Because the marker doesn't exist yet, this WHOLE FILE
 * is expected to fail at module resolution until `state/authReturn.ts` lands
 * — a valid red-phase signature distinct from the behavior-level failures in
 * `HomeScreen.collective-gate.test.tsx`.
 *
 * `isSyncReady$` and the marker are REAL `@legendapp/state` observables
 * (not duck-typed mocks) so the REAL `use$`/`@legendapp/state/react` hooks
 * used by HomeScreen react to `.set()` calls made from the test body.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const pushSpy = vi.fn()
const replaceSpy = vi.fn()

// use$/@legendapp/state/react is left UNMOCKED so the real hook reacts to
// `.set()` calls made from the test body. For that to work the observables
// MUST come from the SAME @legendapp/state module instance the app code uses:
// a `vi.hoisted()` + `require()` observable is built by the CJS bundle, while
// the real `use$` ships in the ESM bundle whose `isObservable()` does not
// recognize CJS-built observables (use$ then returns the proxy itself —
// always truthy, never reactive). So the observables are created INSIDE the
// async `vi.mock` factories via `vi.importActual` and reached from the test
// body through the mocked modules' own exports (imported below).

vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const { testID, onPress, onScroll, children, accessibilityRole, accessibilityLabel, ...rest } = props
    return {
      ...rest,
      ...(testID ? { 'data-testid': testID } : {}),
      ...(accessibilityRole ? { role: accessibilityRole } : {}),
      ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
      ...(onPress ? { onClick: onPress } : {}),
      ...(onScroll ? { onScroll } : {}),
    }
  }

  const passthrough = (tagName: keyof HTMLElementTagNameMap) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(tagName, mapProps(props), children)
    Component.displayName = tagName
    return Component
  }

  const AnimatePresence = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)

  const Text = ({ children, ...props }: any) =>
    ReactModule.createElement('span', mapProps(props), children)

  const StreakChip = () =>
    ReactModule.createElement('span', { 'data-testid': 'streak-chip', role: 'text' }, 'Day —')

  const CollectiveEntry = ({ state = 'dim', onPress }: any) =>
    ReactModule.createElement(
      'span',
      {
        'data-testid': 'collective-entry',
        role: 'button',
        'aria-label': state === 'lit' ? 'Collective' : 'Collective, locked',
        onClick: onPress,
      },
      'COLLECTIVE'
    )

  return {
    AnimatePresence,
    ScrollView: passthrough('div'),
    Text,
    View: passthrough('div'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
    useReducedMotion: () => false,
    StreakChip,
    CollectiveEntry,
  }
})

vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: pushSpy, replace: replaceSpy, back: vi.fn() }),
  usePathname: () => '/',
  useLink: () => ({}),
  useParams: () => ({}),
  useSearchParams: () => ({}),
}))

// ─── Real observables shared between the test body and HomeScreen's own
// subscriptions — created from the actual ESM @legendapp/state instance ─────
vi.mock('app/state/syncConfig', async () => {
  const { observable } = await vi.importActual<typeof import('@legendapp/state')>('@legendapp/state')
  return { isSyncReady$: observable(false) }
})

vi.mock('app/state/store', async () => {
  const { observable } = await vi.importActual<typeof import('@legendapp/state')>('@legendapp/state')
  const isAuthenticated$ = observable(false)
  return {
    store$: {
      views: {
        statsByDate: vi.fn(() => observable(null)),
        get streak() {
          return observable(undefined)
        },
      },
      session: {
        isAuthenticated: isAuthenticated$,
        get: vi.fn(() => ({ isAuthenticated: isAuthenticated$.get() })),
      },
    },
  }
})

vi.mock('app/state/date-utils', () => ({
  getTodayJournalDayString: () => '2026-05-04',
}))

vi.mock('app/features/home/components/KeyringPrompt', () => ({
  KeyringPrompt: () => React.createElement('div', { 'data-testid': 'keyring-prompt' }, null),
}))
vi.mock('app/features/home/components/OrphanFlowsDialog', () => ({
  OrphanFlowsDialog: () => React.createElement('div', { 'data-testid': 'orphan-flows-dialog' }, null),
}))
vi.mock('app/features/home/components/EncryptionModeDialog', () => ({
  EncryptionModeDialog: () => React.createElement('div', { 'data-testid': 'encryption-mode-dialog' }, null),
}))
vi.mock('app/features/navigation/WordLinkNav', () => ({
  WordLinkNav: () => React.createElement('nav', { 'data-testid': 'word-link-nav' }, null),
}))
vi.mock('../useLapsedPrompt', () => ({
  useLapsedPrompt: () => ({ shouldShow: false, dismiss: vi.fn() }),
}))
vi.mock('../components/LapsedPrompt', () => ({
  LapsedPrompt: () => null,
}))

// ─── The marker module — a REAL import (not vi.mock), same instance the
// HomeScreen effect consumes. ────────────────────────────────────────────────
import { pendingCollectiveReturn$ } from 'app/state/authReturn'

// ─── Import under test ───────────────────────────────────────────────────────
import { HomeScreen } from '../HomeScreen'
import { isSyncReady$ } from 'app/state/syncConfig'
import { store$ } from 'app/state/store'

// The mocked modules' own observables — same ESM instance the real use$ reads.
const isAuthenticated$ = store$.session.isAuthenticated

beforeEach(() => {
  pushSpy.mockClear()
  replaceSpy.mockClear()
  act(() => {
    isSyncReady$.set(false)
    isAuthenticated$.set(false)
    pendingCollectiveReturn$.set(false)
  })
})

afterEach(() => {
  cleanup()
})

describe('home-forward to Collective once isSyncReady$ opens', () => {
  it('does NOT navigate while isSyncReady$ is false, even with a pending marker', () => {
    act(() => {
      pendingCollectiveReturn$.set(true)
    })
    render(React.createElement(HomeScreen))
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  it('navigates to /collective exactly once once the marker is set and isSyncReady$ opens', () => {
    act(() => {
      pendingCollectiveReturn$.set(true)
    })
    render(React.createElement(HomeScreen))
    act(() => {
      isSyncReady$.set(true)
    })
    expect(replaceSpy).toHaveBeenCalledWith('/collective')
    expect(replaceSpy).toHaveBeenCalledTimes(1)
  })

  it('clears the pending marker once consumed', () => {
    act(() => {
      pendingCollectiveReturn$.set(true)
    })
    render(React.createElement(HomeScreen))
    act(() => {
      isSyncReady$.set(true)
    })
    expect(pendingCollectiveReturn$.get()).toBe(false)
  })

  it('does not double-fire on a later isSyncReady$ recompute (single-fire)', () => {
    act(() => {
      pendingCollectiveReturn$.set(true)
    })
    render(React.createElement(HomeScreen))
    act(() => {
      isSyncReady$.set(true)
    })
    act(() => {
      isSyncReady$.set(false)
      isSyncReady$.set(true)
    })
    expect(replaceSpy).toHaveBeenCalledTimes(1)
  })

  it('fires the forward even on the no-orphan fast path (no dependency on any dialog having appeared)', () => {
    act(() => {
      pendingCollectiveReturn$.set(true)
    })
    render(React.createElement(HomeScreen))
    act(() => {
      isSyncReady$.set(true)
    })
    expect(replaceSpy).toHaveBeenCalledWith('/collective')
  })
})

describe('no forced navigation without a pending marker (direct /auth visit)', () => {
  it('does NOT navigate when isSyncReady$ opens but no marker was ever set', () => {
    render(React.createElement(HomeScreen))
    act(() => {
      isSyncReady$.set(true)
    })
    expect(replaceSpy).not.toHaveBeenCalled()
  })
})

describe('stale marker cleared by a fresh non-collective auth does not surprise-forward', () => {
  it('does NOT navigate when isSyncReady$ opens after a stale marker was overwritten false by a non-collective auth attempt', () => {
    act(() => {
      // Simulates an abandoned prior OAuth attempt from the Collective gate
      // leaving the marker stuck true.
      pendingCollectiveReturn$.set(true)
    })
    act(() => {
      // Simulates AuthScreen's self-healing fix: completeEmailAuth /
      // handleGoogleAuthStart unconditionally overwrite the marker with the
      // CURRENT attempt's (non-collective) intent before this point.
      pendingCollectiveReturn$.set(false)
    })
    render(React.createElement(HomeScreen))
    act(() => {
      isSyncReady$.set(true)
    })
    expect(replaceSpy).not.toHaveBeenCalled()
  })
})

describe('authenticated manual tap clears a stale pending marker (stale-marker tolerance)', () => {
  it('clears pendingCollectiveReturn$ when an authenticated user taps Collective directly', () => {
    act(() => {
      pendingCollectiveReturn$.set(true)
      isAuthenticated$.set(true)
    })
    render(React.createElement(HomeScreen))
    fireEvent.click(screen.getByTestId('collective-entry'))
    expect(pendingCollectiveReturn$.get()).toBe(false)
  })

  it('still routes the authenticated tap straight to /collective while clearing the stale marker', () => {
    act(() => {
      pendingCollectiveReturn$.set(true)
      isAuthenticated$.set(true)
    })
    render(React.createElement(HomeScreen))
    fireEvent.click(screen.getByTestId('collective-entry'))
    expect(pushSpy).toHaveBeenCalledWith('/collective')
  })

  it('a later isSyncReady$ open cannot surprise-navigate after the stale marker was cleared by a manual tap', () => {
    act(() => {
      pendingCollectiveReturn$.set(true)
      isAuthenticated$.set(true)
    })
    render(React.createElement(HomeScreen))
    fireEvent.click(screen.getByTestId('collective-entry'))
    replaceSpy.mockClear()
    act(() => {
      isSyncReady$.set(true)
    })
    expect(replaceSpy).not.toHaveBeenCalled()
  })
})
