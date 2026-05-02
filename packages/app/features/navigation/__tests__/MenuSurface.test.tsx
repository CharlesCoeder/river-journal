// @vitest-environment happy-dom
/**
 * MenuSurface behavior and accessibility tests — RED PHASE.
 *
 * MenuSurface.tsx does not yet exist.  Every test in this file is expected
 * to fail until the implementation lands.
 *
 * ── Why the module is mocked initially ────────────────────────────────────
 * Vite resolves import() calls statically at transform time, so a dynamic
 * `import('../MenuSurface')` still throws a resolution error before tests run.
 * To get individual failing assertions (true red-phase) rather than a
 * file-level collection error, we:
 *   1. Mock the module path with vi.mock() so Vite's resolver is bypassed.
 *   2. Keep the mock factory returning nothing (undefined exports).
 *   3. Every test that tries to render or inspect `MenuSurface` fails with a
 *      clear "MenuSurface is not a function" or similar assertion error.
 *
 * When the real implementation ships:
 *   - Remove the `vi.mock('../MenuSurface', …)` call below.
 *   - Uncomment the direct static import.
 *
 * ── Mock-expansion note ────────────────────────────────────────────────────
 * The workspace-level @my/ui alias only provides `useMedia` and
 * `useReducedMotion`.  MenuSurface will also import layout primitives
 * (YStack, XStack, Stack, Text, View, Pressable, AnimatePresence).  This file
 * overrides @my/ui locally without touching the shared stub — SliderHub tests
 * are unaffected.
 *
 * ── Router spy strategy ────────────────────────────────────────────────────
 * A module-level `__pushSpy` ref is refreshed in beforeEach.  The
 * solito/navigation mock reads the current ref so every test gets a clean spy.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Component under test.
//
// MenuSurface.tsx currently exports a no-op stub (returns null, no MENU_ITEMS).
// Every test that tries to render the component or inspect MENU_ITEMS will fail
// with assertion errors until the real implementation replaces the stub.
//
// When the real implementation ships, no changes to this import are needed —
// the tests will start passing as the stubs are replaced with real behaviour.
// ---------------------------------------------------------------------------
import type { ComponentType } from 'react'
import { MenuSurface as _MenuSurface, MENU_ITEMS as _MENU_ITEMS } from '../MenuSurface'

const MenuSurface = _MenuSurface as ComponentType<Record<string, never>> | undefined
const MENU_ITEMS = _MENU_ITEMS as
  | ReadonlyArray<{ key: string; label: string; route: string }>
  | undefined

// ---------------------------------------------------------------------------
// @my/ui override — richer than the workspace alias; preserves the
// useMedia / useReducedMotion exports that SliderHub tests depend on.
// ---------------------------------------------------------------------------
vi.mock('@my/ui', async () => {
  const R = await import('react')

  const passthrough = (tag: keyof HTMLElementTagNameMap) => {
    const Comp = ({
      children,
      onPress,
      testID,
      accessibilityLabel,
      accessibilityRole,
      tag: _tag,
      minHeight,
      ...rest
    }: any) =>
      R.createElement(
        tag,
        {
          ...(testID ? { 'data-testid': testID } : {}),
          ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
          ...(accessibilityRole ? { role: accessibilityRole } : {}),
          ...(onPress ? { onClick: onPress } : {}),
          ...(minHeight !== undefined ? { style: { minHeight } } : {}),
        },
        children
      )
    Comp.displayName = tag
    return Comp
  }

  let __reducedMotion = false

  return {
    useMedia: () => ({ sm: false, md: true, lg: true }),
    useReducedMotion: () => __reducedMotion,
    __setReducedMotion: (val: boolean) => {
      __reducedMotion = val
    },
    YStack: passthrough('div'),
    XStack: passthrough('div'),
    Stack: passthrough('div'),
    View: passthrough('div'),
    Text: passthrough('span'),
    AnimatePresence: ({ children }: any) => R.createElement(R.Fragment, null, children),
    Pressable: ({
      children,
      onPress,
      testID,
      accessibilityLabel,
      accessibilityRole,
      minHeight,
    }: any) =>
      R.createElement('button', {
        type: 'button',
        ...(testID ? { 'data-testid': testID } : {}),
        ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
        ...(accessibilityRole ? { role: accessibilityRole } : {}),
        ...(minHeight !== undefined ? { style: { minHeight } } : {}),
        onClick: onPress,
        children,
      }),
  }
})

// ---------------------------------------------------------------------------
// @tamagui/lucide-icons stubs
// ---------------------------------------------------------------------------
vi.mock('@tamagui/lucide-icons', () => ({
  BookOpen: () => React.createElement('svg', { 'data-testid': 'icon-book-open' }),
  Users: () => React.createElement('svg', { 'data-testid': 'icon-users' }),
  MessageCircle: () => React.createElement('svg', { 'data-testid': 'icon-message-circle' }),
  Flame: () => React.createElement('svg', { 'data-testid': 'icon-flame' }),
  Award: () => React.createElement('svg', { 'data-testid': 'icon-award' }),
  Settings: () => React.createElement('svg', { 'data-testid': 'icon-settings' }),
  User: () => React.createElement('svg', { 'data-testid': 'icon-user' }),
  LogIn: () => React.createElement('svg', { 'data-testid': 'icon-log-in' }),
  LogOut: () => React.createElement('svg', { 'data-testid': 'icon-log-out' }),
}))

// ---------------------------------------------------------------------------
// app/utils — spy-able signOut
// ---------------------------------------------------------------------------
const mockSignOut = vi.fn()
vi.mock('app/utils', () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
}))

// ---------------------------------------------------------------------------
// app/state/store — mutable auth state per test
// ---------------------------------------------------------------------------
let mockIsAuthenticated = false
vi.mock('app/state/store', () => ({
  store$: {
    session: {
      isAuthenticated: { get: () => mockIsAuthenticated },
    },
  },
}))

// ---------------------------------------------------------------------------
// @legendapp/state/react
// ---------------------------------------------------------------------------
vi.mock('@legendapp/state/react', () => ({
  use$: (obs: { get: () => unknown }) => obs.get(),
}))

// ---------------------------------------------------------------------------
// app/state/persistConfig (transitive)
// ---------------------------------------------------------------------------
vi.mock('app/state/persistConfig', () => ({
  persistPlugin: { getTable: vi.fn(), setTable: vi.fn(), deleteTable: vi.fn() },
  configurePersistence: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Router spy — refreshed in beforeEach so every test starts with a clean spy.
// The factory closure reads the mutable reference so vi.mock stays hoisted.
// ---------------------------------------------------------------------------
let __pushSpy = vi.fn()
vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: (...args: unknown[]) => __pushSpy(...args), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
  useLink: () => ({}),
  useParams: () => ({}),
  useSearchParams: () => ({}),
}))

beforeEach(() => {
  __pushSpy = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockIsAuthenticated = false
})

// ---------------------------------------------------------------------------
// Shared render helper — fails assertively when MenuSurface is undefined
// ---------------------------------------------------------------------------
function renderMenu() {
  if (typeof MenuSurface !== 'function') {
    throw new Error(
      'MenuSurface is not a function — implementation file packages/app/features/navigation/MenuSurface.tsx does not exist yet'
    )
  }
  return render(React.createElement(MenuSurface))
}

// ===========================================================================
// Suite 1 — Menu item ordering and count
// ===========================================================================

describe('MenuSurface renders six items in the locked order', () => {
  it('renders exactly six menu items including a Log in/out item (AC 1)', () => {
    renderMenu()

    expect(screen.getByText(/past entries/i)).toBeTruthy()
    expect(screen.getByText(/collective/i)).toBeTruthy()
    expect(screen.getByText(/streak/i)).toBeTruthy()
    expect(screen.getByText(/preferences/i)).toBeTruthy()
    expect(screen.getByText(/account/i)).toBeTruthy()
    expect(screen.getByText(/log in/i)).toBeTruthy() // unauthenticated default
  })

  it('MENU_ITEMS exports exactly 6 items in the locked order (AC 1)', () => {
    if (!MENU_ITEMS) throw new Error('MENU_ITEMS not exported — implementation missing')
    const keys = MENU_ITEMS.map((i) => i.key)
    expect(keys).toEqual([
      expect.stringMatching(/past.?entries/i),
      expect.stringMatching(/collective/i),
      expect.stringMatching(/streak/i),
      expect.stringMatching(/preferences/i),
      expect.stringMatching(/account/i),
      expect.stringMatching(/log.?(in|out)/i),
    ])
  })

  it('DOM contains exactly six elements with role="menuitem" inside role="menu" (AC 1, AC 4)', () => {
    renderMenu()
    const container = screen.getByRole('menu')
    expect(container.querySelectorAll('[role="menuitem"]').length).toBe(6)
  })
})

// ===========================================================================
// Suite 2 — Navigation routing per item
// ===========================================================================

describe('each menu item routes to the correct destination', () => {
  const routeTable = [
    { label: /past entries/i, route: '/day-view' },
    { label: /collective/i, route: '/collective' },
    { label: /streak/i, route: '/streak' },
    { label: /preferences/i, route: '/settings' },
    { label: /account/i, route: '/account' },
  ] as const

  for (const { label, route } of routeTable) {
    it(`pressing "${String(label)}" calls router.push("${route}") (AC 3)`, async () => {
      renderMenu()
      fireEvent.click(screen.getByText(label))
      await waitFor(() => expect(__pushSpy).toHaveBeenCalledWith(route))
    })
  }

  it('pressing Log in when unauthenticated routes to /auth without calling signOut (AC 3)', async () => {
    mockIsAuthenticated = false
    renderMenu()
    fireEvent.click(screen.getByText(/log in/i))
    await waitFor(() => {
      expect(__pushSpy).toHaveBeenCalledWith('/auth')
      expect(mockSignOut).not.toHaveBeenCalled()
    })
  })

  it('pressing Log out when authenticated calls signOut then routes to /auth (AC 3)', async () => {
    mockIsAuthenticated = true
    mockSignOut.mockResolvedValue({ error: null })
    renderMenu()
    fireEvent.click(screen.getByText(/log out/i))
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1)
      expect(__pushSpy).toHaveBeenCalledWith('/auth')
    })
  })

  it('label shows "Log out" when authenticated and "Log in" when unauthenticated (AC 3)', () => {
    mockIsAuthenticated = false
    const { unmount } = renderMenu()
    expect(screen.getByText(/log in/i)).toBeTruthy()
    expect(screen.queryByText(/log out/i)).toBeNull()
    unmount()

    mockIsAuthenticated = true
    renderMenu()
    expect(screen.getByText(/log out/i)).toBeTruthy()
    expect(screen.queryByText(/log in/i)).toBeNull()
  })
})

// ===========================================================================
// Suite 3 — Press-flood guard (AC 12)
// ===========================================================================

describe('press-flood guard: rapid taps on a menu item enqueue at most one navigation', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('second tap within 400 ms fires router.push exactly once (AC 12)', async () => {
    renderMenu()
    const item = screen.getByText(/past entries/i)
    fireEvent.click(item)
    fireEvent.click(item)
    await act(async () => { vi.advanceTimersByTime(50) })
    expect(__pushSpy).toHaveBeenCalledTimes(1)
  })

  it('tap on a different item during the latch window is also blocked (AC 12)', async () => {
    renderMenu()
    fireEvent.click(screen.getByText(/past entries/i))
    fireEvent.click(screen.getByText(/collective/i))
    await act(async () => { vi.advanceTimersByTime(50) })
    expect(__pushSpy).toHaveBeenCalledTimes(1)
  })

  it('latch clears after 400 ms and the next tap is accepted (AC 12)', async () => {
    renderMenu()
    const item = screen.getByText(/past entries/i)
    fireEvent.click(item)
    await act(async () => { vi.advanceTimersByTime(400) })
    fireEvent.click(item)
    await act(async () => { vi.advanceTimersByTime(50) })
    expect(__pushSpy).toHaveBeenCalledTimes(2)
  })
})

// ===========================================================================
// Suite 4 — Stagger short-circuit on first press (AC 13)
// ===========================================================================

describe('stagger animation completes immediately when any item is pressed', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('all items are visible immediately after a press during the stagger sequence (AC 13)', async () => {
    renderMenu()
    // 50ms: item 0 (0ms) revealed; items 1-5 (100-500ms) not yet
    await act(async () => { vi.advanceTimersByTime(50) })
    fireEvent.click(screen.getByText(/past entries/i))
    const hidden = screen.getByRole('menu').querySelectorAll('[data-hidden="true"]')
    expect(hidden.length).toBe(0)
  })

  it('no further DOM changes occur after press clears all pending stagger timeouts (AC 13)', async () => {
    const { container } = renderMenu()
    await act(async () => { vi.advanceTimersByTime(50) })
    fireEvent.click(screen.getByText(/past entries/i))
    const snapshot = container.innerHTML
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(container.innerHTML).toBe(snapshot)
  })
})

// ===========================================================================
// Suite 5 — Reduced-motion compliance (AC 7)
// ===========================================================================

describe('reduced-motion: all items render visible without stagger delays', () => {
  afterEach(async () => {
    const myUi = (await import('@my/ui')) as any
    myUi.__setReducedMotion(false)
  })

  it('when useReducedMotion returns true all six items are visible on first render, no timer advance needed (AC 7)', async () => {
    vi.useFakeTimers()
    const myUi = (await import('@my/ui')) as any
    myUi.__setReducedMotion(true)

    renderMenu()

    const container = screen.getByRole('menu')
    expect(container.querySelectorAll('[role="menuitem"]').length).toBe(6)
    expect(container.querySelectorAll('[data-hidden="true"]').length).toBe(0)

    vi.useRealTimers()
  })
})

// ===========================================================================
// Suite 6 — Container-level accessibility (AC 11)
// ===========================================================================

describe('container-level accessibility labels and roles', () => {
  it('list container has aria-label="Main menu" (AC 11)', () => {
    renderMenu()
    expect(screen.getByRole('menu', { name: /main menu/i })).toBeTruthy()
  })

  it('container carries role="menu" (AC 4)', () => {
    renderMenu()
    expect(screen.getByRole('menu')).toBeTruthy()
  })
})

// ===========================================================================
// Suite 7 — Per-item accessibility and touch-target sizing (AC 4, 5)
// ===========================================================================

describe('per-item accessibility and minimum touch-target', () => {
  it('all six items have role="menuitem" (AC 4)', () => {
    renderMenu()
    expect(screen.getAllByRole('menuitem').length).toBe(6)
  })

  it('each item element carries a minimum height of 44 px via inline style (AC 5)', () => {
    renderMenu()
    for (const item of screen.getAllByRole('menuitem')) {
      const style = item.getAttribute('style') ?? ''
      const hasMinHeight =
        style.includes('min-height: 44') ||
        style.includes('minHeight: 44') ||
        style.includes('min-height:44')
      expect(hasMinHeight, `"${item.textContent}" does not meet 44px touch target`).toBe(true)
    }
  })
})

// ===========================================================================
// Suite 8 — MENU_ITEMS immutability (AC 14)
// ===========================================================================

describe('MENU_ITEMS is a frozen / readonly array that preserves the locked order', () => {
  it('MENU_ITEMS has exactly 6 entries (AC 14)', () => {
    if (!MENU_ITEMS) throw new Error('MENU_ITEMS not exported — implementation missing')
    expect(MENU_ITEMS).toHaveLength(6)
  })

  it('attempting to push a new item does not change the array length (AC 14)', () => {
    if (!MENU_ITEMS) throw new Error('MENU_ITEMS not exported — implementation missing')
    // TypeScript makes .push() a compile error via `as const`.
    // At runtime a frozen array throws; a readonly tuple silently no-ops.
    // @ts-expect-error — intentional mutation attempt to verify runtime guard
    const mutate = () => MENU_ITEMS!.push({ key: 'hack', label: 'Hack', route: '/hack' } as never)
    try { mutate() } catch (_) { /* expected for Object.freeze */ }
    expect(MENU_ITEMS).toHaveLength(6)
  })
})

// ===========================================================================
// Suite 9 — signOut called exactly once even on double-tap (AC 12)
// ===========================================================================

describe('signOut is invoked at most once on the Log out item regardless of tap count', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockIsAuthenticated = true
    mockSignOut.mockResolvedValue({ error: null })
  })
  afterEach(() => vi.useRealTimers())

  it('double-tapping Log out calls signOut exactly once (AC 12)', async () => {
    renderMenu()
    const el = screen.getByText(/log out/i)
    fireEvent.click(el)
    fireEvent.click(el)
    await act(async () => {
      vi.advanceTimersByTime(50)
      await Promise.resolve()
    })
    expect(mockSignOut).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// Suite 10 — Auth-flip race condition (AC 3)
// ===========================================================================

describe('auth-flip race: navigation fires exactly once when auth state changes mid-press', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('navigation to /auth fires once even when isAuthenticated flips before signOut resolves (AC 3)', async () => {
    mockIsAuthenticated = true
    mockSignOut.mockImplementation(
      () =>
        new Promise<{ error: null }>((resolve) => {
          setTimeout(() => {
            mockIsAuthenticated = false
            resolve({ error: null })
          }, 100)
        })
    )

    renderMenu()
    fireEvent.click(screen.getByText(/log out/i))

    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(__pushSpy).toHaveBeenCalledWith('/auth')
    expect(__pushSpy).toHaveBeenCalledTimes(1)
  })

  it('re-rendering with isAuthed=false does NOT trigger a second router.push (AC 3)', async () => {
    mockIsAuthenticated = true
    mockSignOut.mockResolvedValue({ error: null })

    const { rerender } = renderMenu()
    fireEvent.click(screen.getByText(/log out/i))

    await act(async () => {
      vi.advanceTimersByTime(50)
      await Promise.resolve()
    })

    mockIsAuthenticated = false
    if (MenuSurface) rerender(React.createElement(MenuSurface))

    await act(async () => { vi.advanceTimersByTime(200) })

    expect(__pushSpy).toHaveBeenCalledTimes(1)
  })
})
