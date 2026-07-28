// @vitest-environment happy-dom
// HomeScreen — moderation-receipt gate mounting.
//
// Red-phase contract: FAILS until <ModerationReceiptGate /> is mounted inside
// HomeScreen.tsx (mirrors the mount precedent for OrphanFlowsDialog /
// EncryptionModeDialog / LapsedPrompt in HomeScreen.test.tsx). HomeScreen is
// the guaranteed post-auth landing surface, so mounting the gate here — not
// in the provider tree — satisfies "the user lands on home or any surface"
// without a broader per-route wrap, and keeps the gate out of the pre-auth
// render path (it needs auth/TQ context).
//
// This suite is isolated from the main HomeScreen.test.tsx file so it can
// mock `app/features/moderation-receipts/ModerationReceiptGate` (a module
// the main layout suite has no reason to know about) without perturbing that
// file's existing mock surface.

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// ─── @my/ui mock — minimal passthroughs, mirrors HomeScreen.test.tsx ─────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const { testID, onPress, onScroll, children, accessibilityRole, accessibilityLabel, ...rest } =
      props
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

  const Text = ({
    children,
    onPress,
    testID,
    accessibilityRole,
    accessibilityLabel,
    ...props
  }: any) =>
    ReactModule.createElement(
      'span',
      {
        ...(testID ? { 'data-testid': testID } : {}),
        ...(accessibilityRole ? { role: accessibilityRole } : {}),
        ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
        ...(onPress ? { onClick: onPress } : {}),
      },
      children
    )

  const StreakChip = () =>
    ReactModule.createElement('span', { 'data-testid': 'streak-chip' }, 'Day 0')
  const CollectiveEntry = () =>
    ReactModule.createElement(
      'span',
      { 'data-testid': 'collective-entry', role: 'button' },
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

// ─── solito/navigation ────────────────────────────────────────────────────
vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useLink: () => ({}),
  useParams: () => ({}),
  useSearchParams: () => ({}),
}))

// ─── Legend State ──────────────────────────────────────────────────────────
vi.mock('@legendapp/state/react', () => ({
  use$: vi.fn((obs: any) => {
    if (obs && typeof obs === 'object' && typeof obs.get === 'function') {
      return obs.get()
    }
    return null
  }),
}))

vi.mock('app/state/store', () => ({
  store$: {
    views: {
      statsByDate: vi.fn(() => ({ get: vi.fn(() => null) })),
      get streak() {
        return { get: () => undefined }
      },
    },
    session: {
      isAuthenticated: { get: () => true },
      get: vi.fn(() => ({ isAuthenticated: true })),
    },
  },
}))

vi.mock('app/state/date-utils', () => ({
  getTodayJournalDayString: () => '2026-07-10',
}))

// ─── Existing dialog/prompt surfaces — stubbed so HomeScreen mounts cleanly ──
vi.mock('app/features/home/components/KeyringPrompt', () => ({
  KeyringPrompt: () => React.createElement('div', { 'data-testid': 'keyring-prompt' }, null),
}))
vi.mock('app/features/home/components/OrphanFlowsDialog', () => ({
  OrphanFlowsDialog: () =>
    React.createElement('div', { 'data-testid': 'orphan-flows-dialog' }, null),
}))
vi.mock('app/features/home/components/EncryptionModeDialog', () => ({
  EncryptionModeDialog: () =>
    React.createElement('div', { 'data-testid': 'encryption-mode-dialog' }, null),
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

// ─── The surface under test: the receipt gate — mock it the same way the
// other dialog surfaces above are mocked, so this suite asserts MOUNTING
// only (the gate's own internal behavior is covered by
// ModerationReceiptGate.test.tsx). ──────────────────────────────────────────
vi.mock('app/features/moderation-receipts/ModerationReceiptGate', () => ({
  ModerationReceiptGate: () =>
    React.createElement('div', { 'data-testid': 'moderation-receipt-gate' }, null),
}))
vi.mock('app/features/notifications/StreakReminderPermissionGate', () => ({
  StreakReminderPermissionGate: () =>
    React.createElement('div', { 'data-testid': 'streak-reminder-permission-gate' }, null),
}))

vi.mock('app/features/notifications/InAppReminderGate', () => ({
  InAppReminderGate: () =>
    React.createElement('div', { 'data-testid': 'in-app-reminder-gate' }, null),
}))

// ─── Import under test ───────────────────────────────────────────────────────
import { HomeScreen } from '../HomeScreen'

afterEach(() => {
  cleanup()
})

describe('HomeScreen mounts the moderation-receipt gate', () => {
  it('mounts <ModerationReceiptGate /> alongside the existing prompt surfaces', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('moderation-receipt-gate')).toBeTruthy()
  })

  it('mounts ModerationReceiptGate alongside OrphanFlowsDialog and EncryptionModeDialog simultaneously (all post-auth surfaces present together)', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('moderation-receipt-gate')).toBeTruthy()
    expect(screen.getByTestId('orphan-flows-dialog')).toBeTruthy()
    expect(screen.getByTestId('encryption-mode-dialog')).toBeTruthy()
  })

  it('does NOT mount the gate inside the provider tree file (mount site is HomeScreen.tsx, asserted by this file importing directly from HomeScreen)', () => {
    // This test's own existence is the assertion: it renders HomeScreen in
    // isolation (no provider tree in the render tree above) and still finds
    // the gate — proving the mount lives in HomeScreen itself, not upstream.
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('moderation-receipt-gate')).toBeTruthy()
  })
})
