// @vitest-environment happy-dom
/**
 * SettingsScreen.appLock.e2e.test.tsx — TDD red-phase E2E tests for the App
 * Lock section's MOUNT POINT inside SettingsScreen → Preferences → Privacy.
 *
 * A sibling file to `SettingsScreen.billing.test.tsx` / `SettingsScreen.reminders.test.tsx`
 * (same `use$`-sentinel-string mocking convention, same "own lightweight
 * mocks" approach) rather than an edit to either — this keeps the new
 * section's red-phase coverage independently attributable. `AppLockSettings`
 * itself is mocked to a stub here (its own toggle/setup/capability workflow
 * is covered by `AppLockSettings.e2e.test.tsx`) — this file asserts
 * MOUNTING, the absence of auth-gating, and stagger-count correctness only.
 *
 * Red-phase: `SettingsScreen.tsx` does not yet mount `AppLockSettings` and
 * `../AppLockSettings` does not exist — every assertion here fails until
 * both land.
 *
 * Coverage map:
 *   - the "App Lock" section renders once fully revealed; SECTION_COUNT
 *          bumped by exactly one (currently 11 → 12); renders identically
 *          for an authenticated user AND an anonymous/unauthenticated user
 *          (App Lock is device-scoped, never auth-gated); nothing dropped by
 *          the renumber.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

// ─── Controlled mock state ─────────────────────────────────────────────────────
let mockIsAuthenticated = true
let mockUserId: string | null = 'user-app-lock-1'
const mockPush = vi.fn()

// ─── @legendapp/state/react — sentinel-string use$ mock ───────────────────────
vi.mock('@legendapp/state/react', () => ({
  use$: (obs$: any) => {
    if (obs$ === '__mock_isAuthenticated') return mockIsAuthenticated
    if (obs$ === '__mock_userId') return mockUserId
    if (obs$ === '__mock_syncEnabled') return false
    if (obs$ === '__mock_currentMode') return null
    if (obs$ === '__mock_focusMode') return false
    if (obs$ === '__mock_focusGranularity') return 'paragraph'
    if (obs$ === '__mock_flows') return {}
    if (obs$ === '__mock_entries') return {}
    return undefined
  },
}))

vi.mock('app/state/store', () => ({
  store$: {
    session: {
      isAuthenticated: '__mock_isAuthenticated',
      userId: '__mock_userId',
      syncEnabled: '__mock_syncEnabled',
    },
    profile: {
      editor: {
        focusMode: '__mock_focusMode',
        focusGranularity: '__mock_focusGranularity',
      },
    },
  },
  flows$: '__mock_flows',
  entries$: '__mock_entries',
  setFocusMode: vi.fn(),
  setFocusGranularity: vi.fn(),
  countLocallyExcludedEntries: () => 0,
}))

vi.mock('app/state/encryptionSetup', () => ({
  encryptionSetup$: { currentMode: '__mock_currentMode' },
}))

vi.mock('app/utils', () => ({
  signOut: vi.fn().mockResolvedValue({ error: null }),
}))

vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('app/features/navigation/WordLinkNav', () => ({
  WordLinkNav: () => null,
}))

vi.mock('app/features/home/components/SyncToggle', () => ({
  SyncToggle: () => React.createElement('div', null, 'SyncToggleStub'),
}))

vi.mock('app/features/home/components/EncryptionModeDialog', () => ({
  EncryptionModeDialog: () => null,
}))

vi.mock('app/features/home/components/KeyringPrompt', () => ({
  KeyringPrompt: () => null,
}))

vi.mock('app/features/home/components/TrustedBrowsersList', () => ({
  TrustedBrowsersList: () => React.createElement('div', null, 'TrustedBrowsersListStub'),
}))

vi.mock('app/features/auth/components/LinkedProviders', () => ({
  LinkedProviders: () => React.createElement('div', null, 'LinkedProvidersStub'),
}))

vi.mock('../components/ThemePicker', () => ({
  ThemePicker: () => React.createElement('div', null, 'ThemePickerStub'),
}))

vi.mock('../components/FontPicker', () => ({
  FontPicker: () => React.createElement('div', null, 'FontPickerStub'),
}))

vi.mock('../components/ExportJournal', () => ({
  ExportJournal: () => React.createElement('div', null, 'ExportJournalStub'),
}))

vi.mock('../components/KeyboardShortcutsSection', () => ({
  KeyboardShortcutsSection: () => React.createElement('div', null, 'KeyboardShortcutsSectionStub'),
}))

vi.mock('../PreviousAccountBanner', () => ({
  PreviousAccountBanner: () => null,
}))

vi.mock('../SuspensionStatusSection', () => ({
  SuspensionStatusSection: () => null,
}))

vi.mock('app/features/notifications/ReminderSettings', () => ({
  ReminderSettings: () => null,
}))

vi.mock('app/features/paid/BillingSection', () => ({
  BillingSection: () => null,
}))

// ─── The surface under test's mount point — mocked to a stub; its own
// behavior is covered by AppLockSettings.e2e.test.tsx. This file asserts
// mounting + absence-of-auth-gating + stagger correctness only. ────────────
vi.mock('../AppLockSettings', () => ({
  AppLockSettings: () =>
    React.createElement('div', { 'data-testid': 'app-lock-settings-stub' }, 'AppLockSettingsStub'),
}))

// ─── @my/ui mock — minimal passthrough, preserving onPress/testID ────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const passthrough =
    (tag: string) =>
    ({ children, onPress, testID, ...props }: any) => {
      const domProps: Record<string, unknown> = {}
      if (testID) domProps['data-testid'] = testID
      if (onPress) domProps['onClick'] = onPress
      return ReactModule.createElement(tag, domProps, children)
    }

  return {
    AnimatePresence: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    ScrollView: passthrough('div'),
    View: passthrough('div'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
    Text: passthrough('span'),
    ExpandingLineButton: ({ children, onPress, ...props }: any) =>
      ReactModule.createElement(
        'button',
        {
          onClick: onPress,
          'data-testid': `btn-${String(children).toLowerCase().replace(/\s+/g, '-')}`,
        },
        children
      ),
  }
})

// ─── Import under test ─────────────────────────────────────────────────────────
import { SettingsScreen } from '../SettingsScreen'

const STAGGER_MS = 100
const OLD_SECTION_COUNT = 11
const NEW_SECTION_COUNT = OLD_SECTION_COUNT + 1

function flushStagger(steps: number) {
  act(() => {
    vi.advanceTimersByTime(steps * STAGGER_MS + 10)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  mockIsAuthenticated = true
  mockUserId = 'user-app-lock-1'
  mockPush.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
// Mounts the App Lock section
// ─────────────────────────────────────────────────────────────────────────────

describe('the "App Lock" section mounts <AppLockSettings /> in Preferences → Privacy', () => {
  it('renders an "App Lock" section header once fully revealed', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(NEW_SECTION_COUNT)
    expect(screen.getByText('App Lock')).toBeTruthy()
  })

  it('renders the <AppLockSettings /> stub inside the section', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(NEW_SECTION_COUNT)
    expect(screen.getByTestId('app-lock-settings-stub')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Not auth-gated (the key difference from Linked Accounts / Notifications)
// ─────────────────────────────────────────────────────────────────────────────

describe('the App Lock section is device-scoped and NEVER auth-gated', () => {
  it('renders for an AUTHENTICATED user', () => {
    mockIsAuthenticated = true
    render(React.createElement(SettingsScreen))
    flushStagger(NEW_SECTION_COUNT)
    expect(screen.getByText('App Lock')).toBeTruthy()
  })

  it('ALSO renders for an UNAUTHENTICATED / anonymous user — no server profile dependency', () => {
    mockIsAuthenticated = false
    mockUserId = null
    render(React.createElement(SettingsScreen))
    flushStagger(NEW_SECTION_COUNT)
    expect(screen.getByText('App Lock')).toBeTruthy()
    expect(screen.getByTestId('app-lock-settings-stub')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Off-by-one / renumber regression guard
// ─────────────────────────────────────────────────────────────────────────────

describe('SECTION_COUNT grew by exactly one (renumber correctness)', () => {
  it('at the OLD section-count stagger point, the footer is NOT yet visible', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(OLD_SECTION_COUNT)
    expect(screen.queryByText('River Journal', { exact: false })).toBeNull()
  })

  it('after one more stagger step, the footer appears', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(NEW_SECTION_COUNT)
    expect(screen.getByText('River Journal', { exact: false })).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Nothing dropped by the renumber
// ─────────────────────────────────────────────────────────────────────────────

describe('all pre-existing sections still render after the renumber', () => {
  it('renders every pre-existing section marker plus App Lock plus the footer', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(NEW_SECTION_COUNT)

    expect(screen.getByText('Privacy Tier')).toBeTruthy()
    expect(screen.getByText('Data & Sync')).toBeTruthy()
    expect(screen.getByText('Theme')).toBeTruthy()
    expect(screen.getByText('Font')).toBeTruthy()
    expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy()
    expect(screen.getByText(/Log Out/)).toBeTruthy()
    expect(screen.getByText('Focus mode')).toBeTruthy()
    expect(screen.getByText('Collective')).toBeTruthy()
    expect(screen.getByText('App Lock')).toBeTruthy()
    expect(screen.getByTestId('app-lock-settings-stub')).toBeTruthy()
    expect(screen.getByText('River Journal', { exact: false })).toBeTruthy()
    expect(screen.getByText('Privacy Center')).toBeTruthy()
  })
})
