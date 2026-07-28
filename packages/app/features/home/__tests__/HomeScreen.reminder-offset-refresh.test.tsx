// @vitest-environment happy-dom
// HomeScreen — app-open reminder-offset refresh effect.
//
// Red-phase contract: FAILS until a `useEffect(() => {
// refreshReminderOffsetOnAppOpen() }, [])` fires from HomeScreen.tsx for an
// authenticated user (mirrors the mount precedent set by
// `HomeScreen.streak-reminder-gate.test.tsx` for `StreakReminderPermissionGate`,
// itself following ModerationReceiptGate / OrphanFlowsDialog /
// EncryptionModeDialog / LapsedPrompt). HomeScreen is the guaranteed
// post-auth landing surface on every platform, so it is the natural mount
// point for a once-per-app-open refresh that keeps `last_local_offset_minutes`
// current for a user who travels or crosses a DST boundary between sessions.
//
// This suite is isolated from the main HomeScreen.test.tsx and the streak-
// reminder-gate suite so it can mock
// `app/features/notifications/reminderPreferences` without perturbing their
// existing mock surfaces (per the isolation precedent those two files already
// established for each other).
//
// Judgment call (unattended mode): the exact import specifier HomeScreen.tsx
// uses for the helper is not pinned by the story text beyond "add a
// `refreshReminderOffsetOnAppOpen()` helper to `reminderPreferences.ts`" and
// "invoke it once per app open ... in HomeScreen.tsx". This file assumes the
// absolute `app/features/notifications/reminderPreferences` specifier,
// mirroring how HomeScreen.tsx already imports its sibling
// `app/features/notifications/StreakReminderPermissionGate` from the same
// feature folder (rather than a relative `../notifications/reminderPreferences`
// path). If the implementation imports it differently, only this file's
// `vi.mock(...)` target needs updating — no other test depends on this path.
//
// The "guarded by an authenticated userId / loaded profile" gate is asserted
// against BOTH `isAuthenticated` and `session.userId` being falsy in the
// "unauthenticated" case, so this file collects a true negative regardless of
// which of the two the implementation reads.

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

// ─── @my/ui mock — minimal passthroughs, mirrors HomeScreen.streak-reminder-gate.test.tsx ─
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

let mockIsAuthenticated = true
let mockUserId: string | null = 'user-1'
vi.mock('app/state/store', () => ({
  store$: {
    views: {
      statsByDate: vi.fn(() => ({ get: vi.fn(() => null) })),
      get streak() {
        return { get: () => undefined }
      },
    },
    session: {
      get isAuthenticated() {
        return { get: () => mockIsAuthenticated }
      },
      userId: {
        peek: () => mockUserId,
      },
      get: vi.fn(() => ({ isAuthenticated: mockIsAuthenticated })),
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

// ─── The surface under test: the app-open offset-refresh side effect ───────
const refreshReminderOffsetOnAppOpenMock = vi.fn()
vi.mock('app/features/notifications/reminderPreferences', () => ({
  refreshReminderOffsetOnAppOpen: () => refreshReminderOffsetOnAppOpenMock(),
}))

// ─── Import under test ───────────────────────────────────────────────────────
import { HomeScreen } from '../HomeScreen'

beforeEach(() => {
  mockIsAuthenticated = true
  mockUserId = 'user-1'
  refreshReminderOffsetOnAppOpenMock.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('HomeScreen — app-open reminder offset refresh', () => {
  it('calls refreshReminderOffsetOnAppOpen() once on mount for an authenticated user with a userId', async () => {
    render(React.createElement(HomeScreen))
    await waitFor(() => expect(refreshReminderOffsetOnAppOpenMock).toHaveBeenCalledTimes(1))
  })

  it('does not call refreshReminderOffsetOnAppOpen() for an unauthenticated / no-profile user', async () => {
    mockIsAuthenticated = false
    mockUserId = null
    render(React.createElement(HomeScreen))
    // Let any pending microtasks/effects flush before asserting the negative.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(refreshReminderOffsetOnAppOpenMock).not.toHaveBeenCalled()
  })

  it('does not call it again on a re-render (mount-once effect, per the `useEffect(..., [])` contract)', async () => {
    const { rerender } = render(React.createElement(HomeScreen))
    await waitFor(() => expect(refreshReminderOffsetOnAppOpenMock).toHaveBeenCalledTimes(1))
    rerender(React.createElement(HomeScreen))
    expect(refreshReminderOffsetOnAppOpenMock).toHaveBeenCalledTimes(1)
  })

  it('fires alongside the other existing post-auth mount surfaces (nothing else broke)', async () => {
    const { getByTestId } = render(React.createElement(HomeScreen))
    await waitFor(() => expect(refreshReminderOffsetOnAppOpenMock).toHaveBeenCalledTimes(1))
    expect(getByTestId('moderation-receipt-gate')).toBeTruthy()
    expect(getByTestId('streak-reminder-permission-gate')).toBeTruthy()
    expect(getByTestId('encryption-mode-dialog')).toBeTruthy()
  })
})
