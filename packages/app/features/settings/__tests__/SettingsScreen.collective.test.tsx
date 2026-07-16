// @vitest-environment happy-dom
/**
 * TDD red-phase unit tests for the Settings → Collective → Blocked users entry.
 *
 * Red-phase contract: every test in this file MUST fail until SettingsScreen.tsx
 * gains a new staggered "Collective" section (bumping the section-reveal count by
 * one) with a "Blocked users" navigation row.
 *
 * This is a sibling test file (not an edit to the pre-existing, wholesale-skipped
 * `SettingsScreen.encryption.test.tsx`, whose entire describe block is
 * `describe.skip` and therefore cannot participate in red/green verification).
 * It exercises SettingsScreen with its own lightweight mocks, following the
 * `use$`-sentinel-string mocking convention used by
 * `SuspensionStatusSection.test.tsx` / `PrivacyCenterScreen.test.tsx`.
 *
 * Coverage:
 *   t1 — a new "Collective" section renders with a "Blocked users" row
 *   t2 — tapping the row's control navigates to /collective/blocked-users
 *   t3 — the staggered reveal count grew by exactly one: at the OLD
 *        section-count threshold the footer must NOT yet be visible (it
 *        moved one slot later), and the Collective section must already be
 *        visible — this is the off-by-one/duplicate-key regression the
 *        renumber is prone to
 *   t4 — after the full reveal, every pre-existing section AND the new
 *        Collective section AND the footer are all present (nothing dropped)
 *   t5 — the footer remains the LAST section to reveal
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─── Controlled mock state ─────────────────────────────────────────────────────
let mockIsAuthenticated = true
let mockUserId: string | null = 'user-collective-1'

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

// The reminder-settings child is stubbed here — its own behavior is covered by
// its dedicated suite; this file only asserts the existing section mounting +
// stagger correctness after the new section was added.
vi.mock('app/features/paid/BillingSection', () => ({
  BillingSection: () => null,
}))

vi.mock('app/features/notifications/ReminderSettings', () => ({
  ReminderSettings: () => null,
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
// The stagger slot immediately before the footer (footer reveals at
// SECTION_COUNT). If a later section-addition forgets to bump SECTION_COUNT,
// the footer will already be visible by this point — the regression this file
// guards against. The Collective section itself reveals well before this slot.
const OLD_SECTION_COUNT = 11

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
  mockUserId = 'user-collective-1'
  mockPush.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
// t1 — Collective section renders with a Blocked users row
// ─────────────────────────────────────────────────────────────────────────────

describe('t1 — new "Collective" section with a "Blocked users" row', () => {
  it('renders a "Collective" section header once fully revealed', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(9)
    expect(screen.getByText('Collective')).toBeTruthy()
  })

  it('renders "Blocked users" label text', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(9)
    expect(screen.getByText('Blocked users')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t2 — navigation
// ─────────────────────────────────────────────────────────────────────────────

describe('t2 — tapping the Blocked users control navigates', () => {
  it('calls router.push("/collective/blocked-users")', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(9)

    // The row mirrors the "Local-only entries" nav-row shape: a Text label and
    // an ExpandingLineButton as siblings inside one XStack. Locate the button
    // within that same row container rather than assuming its label text.
    const label = screen.getByText('Blocked users')
    const row = label.closest('div')
    const button = row?.querySelector('button')
    expect(button).toBeTruthy()

    fireEvent.click(button!)

    expect(mockPush).toHaveBeenCalledWith('/collective/blocked-users')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t3 — off-by-one / renumber regression guard
// ─────────────────────────────────────────────────────────────────────────────

describe('t3 — SECTION_COUNT grew by exactly one (renumber correctness)', () => {
  it('at the OLD section-count stagger point, "Collective" is visible but the footer is NOT yet', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(OLD_SECTION_COUNT)

    expect(screen.getByText('Collective')).toBeTruthy()
    expect(screen.queryByText('River Journal')).toBeNull()
  })

  it('after one more stagger step, the footer appears', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(OLD_SECTION_COUNT + 1)

    expect(screen.getByText('River Journal', { exact: false })).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t4 — nothing dropped by the renumber
// ─────────────────────────────────────────────────────────────────────────────

describe('t4 — all pre-existing sections still render after the renumber', () => {
  it('renders every pre-existing section marker plus Collective plus the footer', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(12)

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
    // New Collective section
    expect(screen.getByText('Collective')).toBeTruthy()
    expect(screen.getByText('Blocked users')).toBeTruthy()
    // Footer
    expect(screen.getByText('River Journal', { exact: false })).toBeTruthy()
    expect(screen.getByText('Privacy Center')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t5 — footer stays last
// ─────────────────────────────────────────────────────────────────────────────

describe('t5 — footer remains the last section to reveal', () => {
  it('the footer is not visible until every other section (including Collective) is visible', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(11)
    expect(screen.queryByText('River Journal', { exact: false })).toBeNull()

    flushStagger(1)
    expect(screen.getByText('River Journal', { exact: false })).toBeTruthy()
  })
})
