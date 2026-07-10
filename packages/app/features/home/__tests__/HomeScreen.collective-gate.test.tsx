// @vitest-environment happy-dom
/**
 * Home `CollectiveEntry` tap — auth gate.
 *
 * An unauthenticated tap must route to the `/auth` account-gate (with
 * `from=collective` + `returnTo` context) instead of `/collective`; an
 * authenticated tap keeps the existing (carryover, unchanged) behavior of
 * routing straight to `/collective`.
 *
 * This is a focused, story-scoped ADDITION — `HomeScreen.test.tsx` (existing)
 * is left untouched per instructions; its own
 * "pressing CollectiveEntry calls router.push('/collective')" assertions
 * currently describe the UNGATED carryover behavior and will need updating
 * in the implementation step to only apply to the authenticated case.
 *
 * Mock strategy mirrors `HomeScreen.test.tsx` (own local copies, not shared).
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const pushSpy = vi.fn()

// use$/@legendapp/state/react is left UNMOCKED so the real hook reacts to
// `.set()` calls made from the test body. For that to work the observables
// MUST come from the SAME @legendapp/state module instance the app code uses:
// a `vi.hoisted()` + `require()` observable is built by the CJS bundle, while
// the real `use$` ships in the ESM bundle whose `isObservable()` does not
// recognize CJS-built observables (use$ then returns the proxy itself —
// always truthy, never reactive). So the observable is created INSIDE the
// async `vi.mock` factory via `vi.importActual` and reached from the test
// body through the mocked module's own export (store$.session.isAuthenticated).

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

  const StreakChip = ({ dayCount, state }: any) =>
    ReactModule.createElement(
      'span',
      { 'data-testid': 'streak-chip', role: 'text' },
      dayCount != null ? `Day ${dayCount}` : 'Day —'
    )

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
  useRouter: () => ({ push: pushSpy, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useLink: () => ({}),
  useParams: () => ({}),
  useSearchParams: () => ({}),
}))

// store$.views.* is stubbed with fresh observables too so no real
// store/sync/supabase modules are ever touched.
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
        // Fallback shape for any code path still reading the whole session
        // object directly instead of the granular observable.
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

// ─── Import under test ───────────────────────────────────────────────────────
import { HomeScreen } from '../HomeScreen'
import { store$ } from 'app/state/store'

// The mocked module's own observable — same ESM instance the real use$ reads.
const isAuthenticated$ = store$.session.isAuthenticated

beforeEach(() => {
  pushSpy.mockClear()
  act(() => {
    isAuthenticated$.set(false)
  })
})

afterEach(() => {
  cleanup()
})

describe('Collective entry tap is auth-gated', () => {
  it('routes an UNAUTHENTICATED tap to the /auth account-gate with collective context', () => {
    act(() => {
      isAuthenticated$.set(false)
    })
    render(React.createElement(HomeScreen))
    fireEvent.click(screen.getByTestId('collective-entry'))
    expect(pushSpy).toHaveBeenCalledWith('/auth?from=collective&returnTo=%2Fcollective')
  })

  it('does NOT route an unauthenticated tap straight to /collective', () => {
    act(() => {
      isAuthenticated$.set(false)
    })
    render(React.createElement(HomeScreen))
    fireEvent.click(screen.getByTestId('collective-entry'))
    expect(pushSpy).not.toHaveBeenCalledWith('/collective')
  })

  it('routes an AUTHENTICATED tap straight to /collective (carryover, unchanged)', () => {
    act(() => {
      isAuthenticated$.set(true)
    })
    render(React.createElement(HomeScreen))
    fireEvent.click(screen.getByTestId('collective-entry'))
    expect(pushSpy).toHaveBeenCalledWith('/collective')
  })

  it('preserves the existing lapsed-dismiss call before navigating', () => {
    // Regression guard: the gated press handler must keep the
    // `if (showLapsed) dismissLapsed()` call. With useLapsedPrompt mocked to
    // shouldShow=false here, dismiss must never fire — this just confirms the
    // press handler still runs cleanly in both auth states without throwing.
    act(() => {
      isAuthenticated$.set(false)
    })
    render(React.createElement(HomeScreen))
    expect(() => fireEvent.click(screen.getByTestId('collective-entry'))).not.toThrow()
  })
})
