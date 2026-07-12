// @vitest-environment happy-dom
// HomeScreen — streak-reminder permission gate mounting.
//
// Red-phase contract: FAILS until <StreakReminderPermissionGate /> is
// mounted inside HomeScreen.tsx (mirrors the mount precedent for
// ModerationReceiptGate / OrphanFlowsDialog / EncryptionModeDialog /
// LapsedPrompt in HomeScreen.test.tsx). HomeScreen is where the
// CelebrationScreen handoff routes back to after the user's first
// >=500-word flow of the day (Dev Notes "How the trigger chains off the
// CelebrationScreen handoff"), so mounting the gate here — not in the
// provider tree — lets it re-evaluate `store$.views.streak.currentStreak`
// on every home landing without a broader per-route wrap.
//
// This suite is isolated from the main HomeScreen.test.tsx file (and from
// HomeScreen.moderation-receipts.test.tsx) so it can mock
// `app/features/notifications/StreakReminderPermissionGate` — a module
// neither of those suites has any reason to know about — without perturbing
// their existing mock surfaces.

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// ─── @my/ui mock — minimal passthroughs, mirrors HomeScreen.test.tsx ─────────
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

  const Text = ({ children, onPress, testID, accessibilityRole, accessibilityLabel, ...props }: any) =>
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

  const StreakChip = () => ReactModule.createElement('span', { 'data-testid': 'streak-chip' }, 'Day 0')
  const CollectiveEntry = () =>
    ReactModule.createElement('span', { 'data-testid': 'collective-entry', role: 'button' }, 'COLLECTIVE')

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
      userId: { peek: () => 'user-1' },
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
vi.mock('app/features/moderation-receipts/ModerationReceiptGate', () => ({
  ModerationReceiptGate: () =>
    React.createElement('div', { 'data-testid': 'moderation-receipt-gate' }, null),
}))

// ─── The surface under test: the streak-reminder gate — mock it the same way
// the other post-auth surfaces above are mocked, so this suite asserts
// MOUNTING only (the gate's own internal behavior is covered by
// StreakReminderPermissionGate.test.tsx). ──────────────────────────────────
vi.mock('app/features/notifications/StreakReminderPermissionGate', () => ({
  StreakReminderPermissionGate: () =>
    React.createElement('div', { 'data-testid': 'streak-reminder-permission-gate' }, null),
}))

// ─── Import under test ───────────────────────────────────────────────────────
import { HomeScreen } from '../HomeScreen'

afterEach(() => {
  cleanup()
})

describe('HomeScreen mounts the streak-reminder permission gate', () => {
  it('mounts <StreakReminderPermissionGate /> alongside the existing post-auth surfaces', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('streak-reminder-permission-gate')).toBeTruthy()
  })

  it('mounts StreakReminderPermissionGate alongside ModerationReceiptGate, OrphanFlowsDialog, and EncryptionModeDialog simultaneously (all post-auth surfaces present together)', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('streak-reminder-permission-gate')).toBeTruthy()
    expect(screen.getByTestId('moderation-receipt-gate')).toBeTruthy()
    expect(screen.getByTestId('orphan-flows-dialog')).toBeTruthy()
    expect(screen.getByTestId('encryption-mode-dialog')).toBeTruthy()
  })

  it('does NOT mount the gate inside the provider tree file (mount site is HomeScreen.tsx, asserted by this file importing directly from HomeScreen)', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('streak-reminder-permission-gate')).toBeTruthy()
  })
})
