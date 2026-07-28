// @vitest-environment happy-dom
/**
 * SettingsScreen.billing.test.tsx — the Billing section's mount point in
 * Settings (7.4's "View billing settings" link routes to `/settings`, so the
 * surface must actually be reachable there once mounted).
 *
 * A sibling test file (mirrors `SettingsScreen.collective.test.tsx`'s
 * approach rather than editing the wholesale-skipped
 * `SettingsScreen.encryption.test.tsx`), exercising SettingsScreen with its
 * own lightweight mocks and the same `use$`-sentinel-string convention.
 *
 * `BillingSection` itself is mocked at the module boundary — its own
 * paid-tier gating / receipt states / cancel-dialog wiring are independently
 * covered in `BillingSection.test.tsx`; this file only proves SettingsScreen
 * actually mounts it, in the correct staggered-reveal slot, without dropping
 * any pre-existing section.
 *
 * Red-phase: `SettingsScreen.tsx` does not yet import/mount `BillingSection`
 * — every assertion here fails until that wiring lands.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

// ─── Controlled mock state ─────────────────────────────────────────────────────
let mockIsAuthenticated = true
let mockUserId: string | null = 'user-billing-1'

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

// The section under test in this file — stubbed so mounting is observable
// without depending on BillingSection's own (separately-covered) internals.
vi.mock('app/features/paid/BillingSection', () => ({
  BillingSection: () => React.createElement('div', null, 'BillingSectionStub'),
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
// The pre-story section count (before Billing is added). If the
// implementation forgets to bump SECTION_COUNT, the footer is already fully
// visible by this point — the same off-by-one regression signature
// `SettingsScreen.collective.test.tsx` guards against for its own section.
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
  mockUserId = 'user-billing-1'
  mockPush.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Billing section mounts inside Settings (the 7.4 "View billing settings" destination)', () => {
  it('renders the Billing section once fully revealed, for an authenticated user', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(OLD_SECTION_COUNT + 1)
    expect(screen.getByText('BillingSectionStub')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Stagger correctness — SECTION_COUNT grew to accommodate Billing', () => {
  it('at the OLD (pre-Billing) section-count stagger point, the footer is NOT yet visible', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(OLD_SECTION_COUNT)
    expect(screen.queryByText('River Journal', { exact: false })).toBeNull()
  })

  it('after one more stagger step, the footer appears', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(OLD_SECTION_COUNT + 1)
    expect(screen.getByText('River Journal', { exact: false })).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Nothing pre-existing is dropped by the Billing-section renumber', () => {
  it('renders every pre-existing section marker plus Billing plus the footer', () => {
    render(React.createElement(SettingsScreen))
    flushStagger(OLD_SECTION_COUNT + 1)

    expect(screen.getByText('Privacy Tier')).toBeTruthy()
    expect(screen.getByText('Data & Sync')).toBeTruthy()
    expect(screen.getByText('Theme')).toBeTruthy()
    expect(screen.getByText('Font')).toBeTruthy()
    expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy()
    expect(screen.getByText(/Log Out/)).toBeTruthy()
    expect(screen.getByText('Focus mode')).toBeTruthy()
    expect(screen.getByText('BillingSectionStub')).toBeTruthy()
    expect(screen.getByText('River Journal', { exact: false })).toBeTruthy()
    expect(screen.getByText('Privacy Center')).toBeTruthy()
  })
})
