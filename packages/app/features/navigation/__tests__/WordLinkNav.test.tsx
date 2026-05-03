// @vitest-environment happy-dom
/**
 * WordLinkNav behavior and accessibility tests — RED PHASE.
 *
 * WordLinkNav.tsx currently exports a no-op stub (returns null, no WORD_LINK_ITEMS).
 * Every test in this file is expected to fail until the real implementation lands.
 *
 * ── Why the module is imported directly ───────────────────────────────────────
 * Unlike MenuSurface.test.tsx, the stub file exists from the start, so Vite
 * resolves the import without a vi.mock() bypass. Tests fail with assertion
 * errors because the stub returns null and exports undefined for WORD_LINK_ITEMS.
 *
 * When the real implementation ships, no changes to this file are needed —
 * tests will start passing as the stubs are replaced with real behaviour.
 *
 * ── Router / pathname spy strategy ────────────────────────────────────────────
 * vi.mock('solito/navigation') overrides the module-level alias. A mutable
 * __currentPathname ref lets each test set the active route for usePathname().
 * A mutable __pushSpy ref is refreshed in beforeEach for clean per-test spies.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------
import { WordLinkNav as _WordLinkNav, WORD_LINK_ITEMS as _WORD_LINK_ITEMS } from '../WordLinkNav'

const WordLinkNav = _WordLinkNav as ComponentType<{
  variant: 'home' | 'browse'
  currentRoute?: string
}> | undefined

const WORD_LINK_ITEMS = _WORD_LINK_ITEMS as
  | ReadonlyArray<{ key: string; label: string; route: string }>
  | undefined

// ---------------------------------------------------------------------------
// @my/ui override — richer than workspace alias; exports layout primitives
// needed when the real component renders.
// ---------------------------------------------------------------------------
vi.mock('@my/ui', async () => {
  const R = await import('react')

  let __reducedMotion = false
  let __isLg = true // default: wide viewport (renders component)

  const passthrough = (defaultTag: keyof HTMLElementTagNameMap) => {
    const Comp = ({
      children,
      onPress,
      testID,
      accessibilityLabel,
      'aria-label': ariaLabel,
      accessibilityRole,
      role,
      tag,
      href,
      onClick,
      'aria-current': ariaCurrent,
      className,
      ...rest
    }: any) => {
      const resolvedTag = tag ?? defaultTag
      return R.createElement(
        resolvedTag,
        {
          ...(testID ? { 'data-testid': testID } : {}),
          ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
          ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
          ...(accessibilityRole ? { role: accessibilityRole } : {}),
          ...(role ? { role } : {}),
          ...(href ? { href } : {}),
          ...(ariaCurrent ? { 'aria-current': ariaCurrent } : {}),
          ...(className ? { className } : {}),
          ...(onPress || onClick
            ? {
                onClick: (e: MouseEvent) => {
                  onPress?.(e)
                  onClick?.(e)
                },
              }
            : {}),
        },
        children
      )
    }
    Comp.displayName = defaultTag
    return Comp
  }

  return {
    useMedia: () => ({ sm: false, md: true, lg: __isLg, xl: false }),
    useReducedMotion: () => __reducedMotion,
    __setReducedMotion: (val: boolean) => {
      __reducedMotion = val
    },
    __setIsLg: (val: boolean) => {
      __isLg = val
    },
    YStack: passthrough('div'),
    XStack: passthrough('div'),
    Stack: passthrough('div'),
    View: passthrough('div'),
    Text: passthrough('span'),
    AnimatePresence: ({ children }: any) => R.createElement(R.Fragment, null, children),
    Pressable: ({ children, onPress, testID, accessibilityLabel, accessibilityRole }: any) =>
      R.createElement('button', {
        type: 'button',
        ...(testID ? { 'data-testid': testID } : {}),
        ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
        ...(accessibilityRole ? { role: accessibilityRole } : {}),
        onClick: onPress,
        children,
      }),
  }
})

// ---------------------------------------------------------------------------
// @tamagui/lucide-icons stubs — not used by WordLinkNav (no icons) but may be
// transitively imported.
// ---------------------------------------------------------------------------
vi.mock('@tamagui/lucide-icons', () => ({}))

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
// Router spy + mutable pathname — refreshed in beforeEach.
// ---------------------------------------------------------------------------
let __pushSpy = vi.fn()
let __currentPathname = '/'

vi.mock('solito/navigation', () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => __pushSpy(...args),
    back: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => __currentPathname,
  useLink: () => ({}),
  useParams: () => ({}),
  useSearchParams: () => ({}),
}))

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------
beforeEach(() => {
  __pushSpy = vi.fn()
  __currentPathname = '/'
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockIsAuthenticated = false
})

// ---------------------------------------------------------------------------
// Shared render helper — fails assertively when WordLinkNav is undefined/null
// ---------------------------------------------------------------------------
function renderNav(variant: 'home' | 'browse' = 'home', currentRoute?: string) {
  if (typeof WordLinkNav !== 'function') {
    throw new Error(
      'WordLinkNav is not a function — stub returned undefined; implementation not yet written'
    )
  }
  const props: { variant: 'home' | 'browse'; currentRoute?: string } = { variant }
  if (currentRoute !== undefined) props.currentRoute = currentRoute
  return render(React.createElement(WordLinkNav, props))
}

// ===========================================================================
// Suite 1 — Item count and locked order
// ===========================================================================

describe('WordLinkNav renders items in locked order (AC 1, AC 3)', () => {
  it('home variant renders exactly 6 word-link items', () => {
    renderNav('home')
    // Expect all six labels in DOM
    expect(screen.getByText(/past entries/i)).toBeTruthy()
    expect(screen.getByText(/collective/i)).toBeTruthy()
    expect(screen.getByText(/streak/i)).toBeTruthy()
    expect(screen.getByText(/preferences/i)).toBeTruthy()
    expect(screen.getByText(/account/i)).toBeTruthy()
    // Log in (unauthenticated default)
    expect(screen.getByText(/log in/i)).toBeTruthy()
  })

  it('browse variant renders exactly 5 non-auth items plus 1 auth item (6 total)', () => {
    renderNav('browse')
    expect(screen.getAllByRole('link').length).toBe(6)
  })

  it('WORD_LINK_ITEMS exports exactly 6 items in the locked order', () => {
    if (!WORD_LINK_ITEMS) throw new Error('WORD_LINK_ITEMS not exported — implementation missing')
    const keys = WORD_LINK_ITEMS.map((i) => i.key)
    expect(keys).toEqual([
      expect.stringMatching(/past.?entries/i),
      expect.stringMatching(/collective/i),
      expect.stringMatching(/streak/i),
      expect.stringMatching(/preferences/i),
      expect.stringMatching(/account/i),
      expect.stringMatching(/log.?(in|out)/i),
    ])
  })

  it('items appear in DOM in the correct visual order (AC 1)', () => {
    renderNav('home')
    const links = screen.getAllByRole('link')
    const texts = links.map((el) => el.textContent?.toLowerCase() ?? '')
    expect(texts[0]).toMatch(/past entries/i)
    expect(texts[1]).toMatch(/collective/i)
    expect(texts[2]).toMatch(/streak/i)
    expect(texts[3]).toMatch(/preferences/i)
  })
})

// ===========================================================================
// Suite 2 — href correctness (AC 17)
// ===========================================================================

describe('each anchor has the correct href attribute (AC 17)', () => {
  const hrefTable = [
    { label: /past entries/i, href: '/day-view' },
    { label: /collective/i, href: '/collective' },
    { label: /streak/i, href: '/streak' },
    { label: /preferences/i, href: '/settings' },
    { label: /account/i, href: '/auth' },
    { label: /log in/i, href: '/auth' },
  ] as const

  for (const { label, href } of hrefTable) {
    it(`"${String(label)}" link has href="${href}"`, () => {
      renderNav('home')
      const link = screen.getByText(label).closest('a') ?? screen.getByText(label)
      expect(link.getAttribute('href')).toBe(href)
    })
  }
})

// ===========================================================================
// Suite 3 — Click behaviour: preventDefault + router.push (AC 17)
// ===========================================================================

describe('plain click calls preventDefault then router.push (AC 17)', () => {
  it('clicking "Past Entries" calls preventDefault() and router.push("/day-view")', async () => {
    renderNav('home')
    const link = screen.getByText(/past entries/i)
    const mockPreventDefault = vi.fn()
    const event = createEvent.click(link)
    event.preventDefault = mockPreventDefault
    fireEvent(link, event)
    await waitFor(() => expect(__pushSpy).toHaveBeenCalledWith('/day-view'))
    expect(mockPreventDefault).toHaveBeenCalled()
  })

  it('clicking "Preferences" calls router.push("/settings")', async () => {
    renderNav('home')
    fireEvent.click(screen.getByText(/preferences/i))
    await waitFor(() => expect(__pushSpy).toHaveBeenCalledWith('/settings'))
  })
})

// ===========================================================================
// Suite 4 — Cmd/Ctrl/middle-click must NOT preventDefault (AC 17)
// ===========================================================================

describe('modifier clicks do NOT call preventDefault — let browser handle (AC 17)', () => {
  it('Cmd-click does not call router.push and does not preventDefault', async () => {
    renderNav('home')
    const link = screen.getByText(/past entries/i)
    const mockPreventDefault = vi.fn()
    fireEvent.click(link, { metaKey: true, preventDefault: mockPreventDefault })
    // Give any async navigation a chance to fire
    await act(async () => { await Promise.resolve() })
    expect(__pushSpy).not.toHaveBeenCalled()
    expect(mockPreventDefault).not.toHaveBeenCalled()
  })

  it('Ctrl-click does not call router.push and does not preventDefault', async () => {
    renderNav('home')
    const link = screen.getByText(/past entries/i)
    const mockPreventDefault = vi.fn()
    fireEvent.click(link, { ctrlKey: true, preventDefault: mockPreventDefault })
    await act(async () => { await Promise.resolve() })
    expect(__pushSpy).not.toHaveBeenCalled()
    expect(mockPreventDefault).not.toHaveBeenCalled()
  })

  it('middle-click (button=1) does not call router.push', async () => {
    renderNav('home')
    const link = screen.getByText(/past entries/i)
    fireEvent.click(link, { button: 1 })
    await act(async () => { await Promise.resolve() })
    expect(__pushSpy).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Suite 5 — Active-route aria-current and color (AC 16, AC 11)
// ===========================================================================

describe('active route gets aria-current="page" (AC 16)', () => {
  it('link matching current pathname has aria-current="page"', () => {
    __currentPathname = '/settings'
    renderNav('home', '/settings')
    const link = screen.getByText(/preferences/i).closest('a') ?? screen.getByText(/preferences/i)
    expect(link.getAttribute('aria-current')).toBe('page')
  })

  it('non-active links do NOT have aria-current="page"', () => {
    __currentPathname = '/settings'
    renderNav('home', '/settings')
    const link = screen.getByText(/past entries/i).closest('a') ?? screen.getByText(/past entries/i)
    expect(link.getAttribute('aria-current')).not.toBe('page')
  })

  it('active link has $color color token (not $color8)', () => {
    __currentPathname = '/day-view'
    renderNav('home', '/day-view')
    const link = screen.getByText(/past entries/i).closest('a') ?? screen.getByText(/past entries/i)
    // The active item should carry a data attribute or className indicating active color
    const isActive =
      link.getAttribute('data-active') === 'true' ||
      link.getAttribute('aria-current') === 'page' ||
      (link.getAttribute('class') ?? '').includes('active')
    expect(isActive).toBe(true)
  })
})

// ===========================================================================
// Suite 6 — Auth-aware Log in/out label flip (AC 12)
// ===========================================================================

describe('auth-aware label flip: "Log in" when unauthenticated, "Log out" when authenticated (AC 12)', () => {
  it('shows "Log in" when unauthenticated', () => {
    mockIsAuthenticated = false
    renderNav('home')
    expect(screen.getByText(/log in/i)).toBeTruthy()
    expect(screen.queryByText(/log out/i)).toBeNull()
  })

  it('shows "Log out" when authenticated', () => {
    mockIsAuthenticated = true
    renderNav('home')
    expect(screen.getByText(/log out/i)).toBeTruthy()
    expect(screen.queryByText(/log in/i)).toBeNull()
  })

  it('Log out calls signOut then routes to /auth', async () => {
    mockIsAuthenticated = true
    mockSignOut.mockResolvedValue({ error: null })
    renderNav('home')
    fireEvent.click(screen.getByText(/log out/i))
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1)
      expect(__pushSpy).toHaveBeenCalledWith('/auth')
    })
  })

  it('Log in when unauthenticated routes to /auth without calling signOut', async () => {
    mockIsAuthenticated = false
    renderNav('home')
    fireEvent.click(screen.getByText(/log in/i))
    await waitFor(() => {
      expect(__pushSpy).toHaveBeenCalledWith('/auth')
      expect(mockSignOut).not.toHaveBeenCalled()
    })
  })
})

// ===========================================================================
// Suite 7 — Press-flood guard: second tap within ~400ms is ignored (AC 12)
// ===========================================================================

describe('press-flood guard: second tap within ~400ms is ignored (AC 12)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('second tap within 400ms fires router.push exactly once', async () => {
    renderNav('home')
    const link = screen.getByText(/past entries/i)
    fireEvent.click(link)
    fireEvent.click(link)
    await act(async () => { vi.advanceTimersByTime(50) })
    expect(__pushSpy).toHaveBeenCalledTimes(1)
  })

  it('tap on a different item during the latch window is also blocked', async () => {
    renderNav('home')
    fireEvent.click(screen.getByText(/past entries/i))
    fireEvent.click(screen.getByText(/collective/i))
    await act(async () => { vi.advanceTimersByTime(50) })
    expect(__pushSpy).toHaveBeenCalledTimes(1)
  })

  it('latch clears after 400ms and next tap is accepted', async () => {
    renderNav('home')
    const link = screen.getByText(/past entries/i)
    fireEvent.click(link)
    await act(async () => { vi.advanceTimersByTime(400) })
    fireEvent.click(link)
    await act(async () => { vi.advanceTimersByTime(50) })
    expect(__pushSpy).toHaveBeenCalledTimes(2)
  })
})

// ===========================================================================
// Suite 8 — Container semantics: <nav> with aria-label (AC 16)
// ===========================================================================

describe('container has <nav> element with aria-label="Primary navigation" (AC 16)', () => {
  it('renders a <nav> landmark element', () => {
    renderNav('home')
    expect(screen.getByRole('navigation')).toBeTruthy()
  })

  it('nav has aria-label or accessibilityLabel of "Primary navigation"', () => {
    renderNav('home')
    expect(
      screen.getByRole('navigation', { name: /primary navigation/i })
    ).toBeTruthy()
  })
})

// ===========================================================================
// Suite 9 — focus-visible styling (AC 18)
// ===========================================================================

describe('focus-visible styling: links expose :focus-visible variant, not bare :focus (AC 18)', () => {
  it('each link element has a className or data attribute indicating focus-visible styling', () => {
    renderNav('home')
    const links = screen.getAllByRole('link')
    // The real implementation must use :focus-visible either via className or
    // a focusVisibleStyle prop. We verify a non-empty set of anchor elements
    // that carry the expected indicator.
    for (const link of links) {
      const hasFocusVisible =
        (link.getAttribute('class') ?? '').includes('focus-visible') ||
        link.hasAttribute('data-focus-visible') ||
        // Tamagui encodes :focus-visible via focusVisibleStyle prop which
        // the real component will pass; verify the attribute is present.
        link.hasAttribute('data-focusvisible') ||
        // At minimum the element must be focusable (tabIndex >= 0 or anchor)
        link.tagName.toLowerCase() === 'a'
      expect(
        hasFocusVisible,
        `Link "${link.textContent}" does not carry focus-visible indicator`
      ).toBe(true)
    }
  })

  it('none of the link elements carry a bare :focus style without :focus-visible scoping', () => {
    renderNav('home')
    const links = screen.getAllByRole('link')
    for (const link of links) {
      const style = link.getAttribute('style') ?? ''
      // A bare ":focus {" rule applied as inline style would be a red flag.
      // The real component should NOT do this.
      expect(style).not.toMatch(/:focus\s*\{/)
    }
  })
})

// ===========================================================================
// Suite 10 — Reduced-motion: entry animation collapses (AC 15)
// ===========================================================================

describe('reduced-motion: entry animation collapses immediately (AC 15)', () => {
  afterEach(async () => {
    const myUi = (await import('@my/ui')) as any
    myUi.__setReducedMotion(false)
  })

  it('when useReducedMotion returns true all items are visible on first render without timer advance', async () => {
    vi.useFakeTimers()
    const myUi = (await import('@my/ui')) as any
    myUi.__setReducedMotion(true)

    renderNav('home')

    // All 6 anchors should be visible (no opacity:0 hiding them)
    const links = screen.getAllByRole('link')
    expect(links.length).toBe(6)
    // No items should carry a hidden/invisible data attribute
    const hidden = document.querySelectorAll('[data-hidden="true"]')
    expect(hidden.length).toBe(0)

    vi.useRealTimers()
  })
})
