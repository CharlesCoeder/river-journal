// @vitest-environment happy-dom
/**
 * TDD red-phase unit tests for a new, auth-gated "Notifications" section in
 * SettingsScreen mounting the reminder-settings preferences surface.
 *
 * Red-phase contract: every test in this file MUST fail until SettingsScreen.tsx
 * gains a new staggered "Notifications" section (bumping the section-reveal
 * count by one) rendering a `<ReminderSettings />` child, auth-gated the same
 * way as the existing Linked Accounts section (visible only when the user is
 * authenticated).
 *
 * Sibling file to `SettingsScreen.collective.test.tsx` (same `use$`-sentinel-
 * string mocking convention, same "own lightweight mocks" approach) rather
 * than an edit to it — this keeps each new section's red-phase coverage
 * independently attributable and avoids perturbing an already-green suite.
 * `ReminderSettings` itself is mocked to a stub here (its own behavior is
 * covered by `ReminderSettings.test.tsx`) — this file asserts MOUNTING,
 * auth-gating, and stagger-count correctness only.
 *
 * Coverage:
 *   t1 — a new "Notifications" section renders a `<ReminderSettings />` stub
 *        once fully revealed, for an authenticated user
 *   t2 — the section is auth-gated: it does NOT render for an unauthenticated
 *        user, even once fully revealed
 *   t3 — the staggered reveal count grew by exactly one: at the OLD
 *        section-count threshold, the footer must NOT yet be visible
 *   t4 — after full reveal, every pre-existing section AND the new
 *        Notifications section AND the footer are all present (nothing
 *        dropped by the renumber)
 *   t5 — the footer remains the LAST section to reveal
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

// ─── Controlled mock state ─────────────────────────────────────────────────────
let mockIsAuthenticated = true
let mockUserId: string | null = 'user-reminders-1'

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

// ─── The surface under test's child — mocked to a stub; its own behavior is
// covered by ReminderSettings.test.tsx. This file asserts mounting +
// auth-gating + stagger correctness only. ───────────────────────────────────
vi.mock('app/features/notifications/ReminderSettings', () => ({
  ReminderSettings: () =>
    React.createElement('div', { 'data-testid': 'reminder-settings-stub' }, 'ReminderSettingsStub'),
}))

vi.mock('app/features/paid/BillingSection', () => ({
  BillingSection: () => null,
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
// The stagger slot immediately before the footer (the footer reveals at
// SECTION_COUNT). If a section-addition forgets to bump SECTION_COUNT, the
// footer will already be visible by this point — the regression this file
// guards against. The Notifications section itself reveals well before this
// slot.
const OLD_SECTION_COUNT = 10
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
  mockUserId = 'user-reminders-1'
  mockPush.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
// t1 — Notifications section renders a ReminderSettings stub (authenticated)
// ─────────────────────────────────────────────────────────────────────────────

describe('t1 — new "Notifications" section mounts <ReminderSettings /> (authenticated)', () => {
  it('renders a "Notifications" section header once fully revealed', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(NEW_SECTION_COUNT)
    expect(screen.getByText('Notifications')).toBeTruthy()
  })

  it('renders the <ReminderSettings /> stub inside the section', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(NEW_SECTION_COUNT)
    expect(screen.getByTestId('reminder-settings-stub')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t2 — auth gate
// ─────────────────────────────────────────────────────────────────────────────

describe('t2 — the Notifications section is auth-gated (mirrors Linked Accounts, section 6)', () => {
  it('does NOT render for an unauthenticated user, even once fully revealed', () => {
    mockIsAuthenticated = false
    render(React.createElement(SettingsScreen))
    flushStagger(NEW_SECTION_COUNT)
    expect(screen.queryByText('Notifications')).toBeNull()
    expect(screen.queryByTestId('reminder-settings-stub')).toBeNull()
  })

  it('DOES render for an authenticated user', () => {
    mockIsAuthenticated = true
    render(React.createElement(SettingsScreen))
    flushStagger(NEW_SECTION_COUNT)
    expect(screen.getByText('Notifications')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t3 — off-by-one / renumber regression guard
// ─────────────────────────────────────────────────────────────────────────────

describe('t3 — SECTION_COUNT grew by exactly one (renumber correctness)', () => {
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
// t4 — nothing dropped by the renumber
// ─────────────────────────────────────────────────────────────────────────────

describe('t4 — all pre-existing sections still render after the renumber', () => {
  it('renders every pre-existing section marker plus Notifications plus the footer', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(NEW_SECTION_COUNT)

    // Section 1 (authenticated) — Privacy Tier
    expect(screen.getByText('Privacy Tier')).toBeTruthy()
    // Section 2 — Data & Sync
    expect(screen.getByText('Data & Sync')).toBeTruthy()
    // Section 4 — Theme / Font
    expect(screen.getByText('Theme')).toBeTruthy()
    expect(screen.getByText('Font')).toBeTruthy()
    // Section 5 — Keyboard Shortcuts
    expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy()
    // Section 6 — Log Out (authenticated)
    expect(screen.getByText(/Log Out/)).toBeTruthy()
    // Section 7 — Editor
    expect(screen.getByText('Focus mode')).toBeTruthy()
    // Section 8 — Collective
    expect(screen.getByText('Collective')).toBeTruthy()
    expect(screen.getByText('Blocked users')).toBeTruthy()
    // New Notifications section
    expect(screen.getByText('Notifications')).toBeTruthy()
    expect(screen.getByTestId('reminder-settings-stub')).toBeTruthy()
    // Footer
    expect(screen.getByText('River Journal', { exact: false })).toBeTruthy()
    expect(screen.getByText('Privacy Center')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t5 — footer stays last
// ─────────────────────────────────────────────────────────────────────────────

describe('t5 — footer remains the last section to reveal', () => {
  it('the footer is not visible until every other section (including Notifications) is visible', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(NEW_SECTION_COUNT - 1)
    expect(screen.queryByText('River Journal', { exact: false })).toBeNull()

    flushStagger(1)
    expect(screen.getByText('River Journal', { exact: false })).toBeTruthy()
  })
})
