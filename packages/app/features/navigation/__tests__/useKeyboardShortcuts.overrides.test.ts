/**
 * useKeyboardShortcuts — override-aware registration tests.
 *
 * Verifies that when the user has stored a custom binding for an action,
 * the hook registers the new chord (expanded for Mod+ when applicable) and
 * NOT the default chord.
 *
 * The hook is exercised by mocking @tanstack/react-hotkeys.useHotkeys and
 * inspecting the definitions array passed in.
 */

// @vitest-environment happy-dom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Capture the definitions array passed to useHotkeys on each render.
// ---------------------------------------------------------------------------
let capturedDefs: Array<{ hotkey: string; callback: any; options?: any }> = []

vi.mock('@tanstack/react-hotkeys', () => ({
  useHotkeys: (defs: any) => {
    capturedDefs = defs
  },
}))

// ---------------------------------------------------------------------------
// solito navigation
// ---------------------------------------------------------------------------
vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
}))

// ---------------------------------------------------------------------------
// store mock — controllable profile shape per test
// ---------------------------------------------------------------------------
let mockProfile: { hotkeyOverrides?: Record<string, string | undefined> } | null = null

vi.mock('@legendapp/state/react', () => ({
  use$: (obs$: any) => {
    if (obs$ === '__mock_profile') return mockProfile
    return obs$
  },
}))

vi.mock('app/state/store', () => ({
  store$: {
    profile: '__mock_profile',
    session: { isAuthenticated: { get: () => false } },
  },
  hidePersistentEditor: vi.fn(),
}))

vi.mock('app/state/persistConfig', () => ({
  persistPlugin: { getTable: vi.fn(), setTable: vi.fn(), deleteTable: vi.fn() },
  configurePersistence: vi.fn(),
}))

vi.mock('@my/ui', () => ({
  useMedia: () => ({ sm: false, md: true, lg: true, xl: false }),
  useReducedMotion: () => false,
}))

import { useKeyboardShortcuts } from '../useKeyboardShortcuts'

function Host() {
  useKeyboardShortcuts()
  return React.createElement('div')
}

beforeEach(() => {
  capturedDefs = []
  mockProfile = null
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const hotkeysOf = () => capturedDefs.map((d) => d.hotkey)

describe('useKeyboardShortcuts — default registrations (no overrides)', () => {
  it('registers Meta+N AND Control+N for the new-entry action', () => {
    render(React.createElement(Host))
    const ks = hotkeysOf()
    expect(ks).toContain('Meta+N')
    expect(ks).toContain('Control+N')
  })

  it('registers Meta+, AND Control+, for the open-settings action', () => {
    render(React.createElement(Host))
    const ks = hotkeysOf()
    expect(ks).toContain('Meta+,')
    expect(ks).toContain('Control+,')
  })

  it('registers Escape for the exit-editor action', () => {
    render(React.createElement(Host))
    expect(hotkeysOf()).toContain('Escape')
  })
})

describe('useKeyboardShortcuts — honors stored overrides', () => {
  it('uses a Mod+ override expanded into both Meta+ and Control+ entries', () => {
    mockProfile = { hotkeyOverrides: { newEntry: 'Mod+E' } }
    render(React.createElement(Host))
    const ks = hotkeysOf()
    expect(ks).toContain('Meta+E')
    expect(ks).toContain('Control+E')
    // Old default chord must NOT be registered any more.
    expect(ks).not.toContain('Meta+N')
    expect(ks).not.toContain('Control+N')
  })

  it('uses an explicit Control+ override as-is (no Meta+ expansion)', () => {
    mockProfile = { hotkeyOverrides: { newEntry: 'Control+N' } }
    render(React.createElement(Host))
    const ks = hotkeysOf()
    expect(ks).toContain('Control+N')
    expect(ks).not.toContain('Meta+N')
  })

  it('uses a non-Mod override (e.g. Shift+F1) as-is', () => {
    mockProfile = { hotkeyOverrides: { exitEditor: 'Shift+F1' } }
    render(React.createElement(Host))
    const ks = hotkeysOf()
    expect(ks).toContain('Shift+F1')
    expect(ks).not.toContain('Escape')
  })

  it('falls back to defaults when only some overrides are present', () => {
    mockProfile = { hotkeyOverrides: { openSettings: 'Mod+;' } }
    render(React.createElement(Host))
    const ks = hotkeysOf()
    // Overridden:
    expect(ks).toContain('Meta+;')
    expect(ks).toContain('Control+;')
    expect(ks).not.toContain('Meta+,')
    expect(ks).not.toContain('Control+,')
    // Defaults still in place for the others:
    expect(ks).toContain('Meta+N')
    expect(ks).toContain('Control+N')
    expect(ks).toContain('Escape')
  })

  it('treats a null profile (anonymous user) as "use all defaults"', () => {
    mockProfile = null
    render(React.createElement(Host))
    const ks = hotkeysOf()
    expect(ks).toContain('Meta+N')
    expect(ks).toContain('Control+N')
    expect(ks).toContain('Meta+,')
    expect(ks).toContain('Control+,')
    expect(ks).toContain('Escape')
  })
})
