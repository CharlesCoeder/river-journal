// @vitest-environment happy-dom
/**
 * Red-phase unit tests for `features/notifications/StreakReminderPermissionGate.tsx`.
 *
 * Red-phase contract: every test MUST fail until the target module (AND its
 * `../streakReminderPrompt` pure-helper dependency) exist — the whole file
 * fails at the top-level `import { StreakReminderPermissionGate } from
 * '../StreakReminderPermissionGate'` with a module-resolution error, per this
 * repo's established red-phase convention (see `ModerationReceiptGate.test.tsx`,
 * `OnboardingGate.test.tsx`).
 *
 * Contract this file locks in for the implementation:
 *   - Renders `null` on any non-native platform (`Platform.OS`), before any
 *     async permission/registration check fires.
 *   - Reads `store$.views.streak` reactively via `use$()` (whole
 *     function-shaped computed object, per Dev Notes) for `currentStreak`.
 *   - Reads the once-ever "seen" state via `hasSeenStreakPrompt()`
 *     (`../reminderPreferences`) and the live-token state via a non-reactive
 *     `pushTokens$.peek()` scan for the current user (`store$.session.userId`),
 *     mirroring `ModerationReceiptGate`'s synchronous `hasAcknowledgedReceipt`
 *     read pattern.
 *   - Checks `getPushPermissionStatus()` (`app/utils/pushTokens` — the
 *     platform-agnostic boundary import, NOT `.native` directly) to resolve
 *     `permissionAlreadyGranted` before deciding modal-vs-silent-register.
 *   - Modal copy: "Want a daily reminder to write? You can change this
 *     anytime in Preferences." with **Enable** / **Not now** buttons.
 *   - Enable → `requestAndRegisterPushToken()`, then `markStreakPromptSeen()`
 *     always; `setPushPermissionDenied()` ONLY when the outcome is `'denied'`
 *     (never on `'granted'` / `'granted-no-token'`). Disabled/pending while
 *     in-flight (no double-fire on a fast double-tap).
 *   - Not now → `markStreakPromptSeen()` only; no native call, no cooldown.
 *   - Silent-register edge: OS permission already granted but no live token
 *     → no modal; calls `requestAndRegisterPushToken()` directly, then
 *     `markStreakPromptSeen()` (never `setPushPermissionDenied()`).
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ─── react-native Platform mock ─────────────────────────────────────────────
let mockPlatformOS = 'ios'
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOS
    },
  },
}))

// ─── Legend-State use$ mock — mirrors ModerationReceiptGate/HomeScreen tests ─
vi.mock('@legendapp/state/react', () => ({
  use$: vi.fn((obs: any) => {
    if (obs && typeof obs === 'object' && typeof obs.get === 'function') {
      return obs.get()
    }
    return obs
  }),
}))

// ─── app/state/store mock — streak (reactive), session.userId (peek) ───────
let mockStreakState: { currentStreak: number } | undefined = { currentStreak: 1 }
let mockUserId: string | null = 'user-1'
vi.mock('app/state/store', () => ({
  store$: {
    views: {
      get streak() {
        return { get: () => mockStreakState }
      },
    },
    session: {
      userId: {
        peek: () => mockUserId,
      },
    },
  },
}))

// ─── app/state/push_tokens mock — non-reactive peek scan ───────────────────
let mockPushTokenRows: Record<string, { userId: string }> = {}
vi.mock('app/state/push_tokens', () => ({
  pushTokens$: {
    peek: () => mockPushTokenRows,
  },
}))

// ─── ../reminderPreferences mock — read + write helpers as spies ───────────
// NOTE: enableStreakRemindersDefault MUST be added to this fixed-object mock
// factory in the SAME edit that makes the component call it — every existing
// test in this file throws "not a function" otherwise (the component's
// `handleEnable` / silent-register branch call it unconditionally once wired).
const hasSeenStreakPromptMock = vi.fn()
const markStreakPromptSeenMock = vi.fn()
const setPushPermissionDeniedMock = vi.fn()
const enableStreakRemindersDefaultMock = vi.fn()
vi.mock('../reminderPreferences', () => ({
  hasSeenStreakPrompt: () => hasSeenStreakPromptMock(),
  markStreakPromptSeen: (now?: string) => markStreakPromptSeenMock(now),
  setPushPermissionDenied: (now?: string) => setPushPermissionDeniedMock(now),
  enableStreakRemindersDefault: () => enableStreakRemindersDefaultMock(),
}))

// ─── app/utils/pushTokens mock — the platform-agnostic boundary import ─────
const requestAndRegisterPushTokenMock = vi.fn()
const hasLivePushTokenMock = vi.fn()
const getPushPermissionStatusMock = vi.fn()
vi.mock('app/utils/pushTokens', () => ({
  requestAndRegisterPushToken: () => requestAndRegisterPushTokenMock(),
  hasLivePushToken: (userId: string) => hasLivePushTokenMock(userId),
  getPushPermissionStatus: () => getPushPermissionStatusMock(),
}))

// ─── @my/ui mock — Dialog/ExpandingLineButton passthroughs ─────────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const DialogPortal = ({ children }: any) => ReactModule.createElement('div', null, children)
  const DialogOverlay = () => ReactModule.createElement('div', { 'data-dialog-overlay': 'true' })
  const DialogContent = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-dialog-content': 'true' }, children)
  const DialogTitle = ({ children }: any) => ReactModule.createElement('h2', null, children)

  const DialogComponent = ({ children, open }: any) =>
    open === false
      ? null
      : ReactModule.createElement(
          'div',
          { 'data-dialog': 'true', role: 'dialog', 'aria-modal': 'true' },
          children
        )
  Object.assign(DialogComponent, {
    Portal: DialogPortal,
    Overlay: DialogOverlay,
    Content: DialogContent,
    Title: DialogTitle,
  })

  return {
    Text: ({ children }: any) => ReactModule.createElement('span', null, children),
    XStack: ({ children }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x' }, children),
    YStack: ({ children }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y' }, children),
    Dialog: DialogComponent,
    ExpandingLineButton: ({ children, onPress, disabled }: any) =>
      ReactModule.createElement(
        'button',
        {
          onClick: onPress,
          disabled: !!disabled,
          'data-testid': `btn-${String(children).toLowerCase().replace(/\s+/g, '-')}`,
        },
        children
      ),
    useReducedMotion: () => false,
  }
})

// ─── Import under test — fails until both files exist ──────────────────────
import { StreakReminderPermissionGate } from '../StreakReminderPermissionGate'

beforeEach(() => {
  mockPlatformOS = 'ios'
  mockStreakState = { currentStreak: 1 }
  mockUserId = 'user-1'
  mockPushTokenRows = {}
  hasSeenStreakPromptMock.mockReset().mockReturnValue(false)
  markStreakPromptSeenMock.mockReset()
  setPushPermissionDeniedMock.mockReset()
  enableStreakRemindersDefaultMock.mockReset()
  requestAndRegisterPushTokenMock.mockReset().mockResolvedValue({ outcome: 'granted' })
  hasLivePushTokenMock.mockReset().mockReturnValue(false)
  getPushPermissionStatusMock.mockReset().mockResolvedValue('undetermined')
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Platform gate', () => {
  it('renders null on web', async () => {
    mockPlatformOS = 'web'
    const { container } = render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('renders null on an unrecognized desktop platform string', async () => {
    mockPlatformOS = 'windows'
    const { container } = render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('does not call getPushPermissionStatus on a non-native platform (no async work off-native)', async () => {
    mockPlatformOS = 'web'
    render(<StreakReminderPermissionGate />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getPushPermissionStatusMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Trigger evaluation — modal shown (happy path)', () => {
  it('shows the modal with the exact copy on iOS when all conditions hold', async () => {
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByText(/Want a daily reminder to write\?/)).toBeTruthy()
    expect(screen.getByText(/You can change this anytime in Preferences\./)).toBeTruthy()
  })

  it('shows the modal on Android too', async () => {
    mockPlatformOS = 'android'
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
  })

  it('renders both an Enable and a Not now button', async () => {
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(screen.getByTestId('btn-enable')).toBeTruthy())
    expect(screen.getByTestId('btn-not-now')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Trigger evaluation — modal suppressed', () => {
  it('renders null when currentStreak is not 1', async () => {
    mockStreakState = { currentStreak: 3 }
    const { container } = render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('renders null when the prompt has already been seen', async () => {
    hasSeenStreakPromptMock.mockReturnValue(true)
    const { container } = render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('renders null when a live token already exists for the current user', async () => {
    mockPushTokenRows = { 'tok-1': { userId: 'user-1' } }
    const { container } = render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('ignores a live token that belongs to a different user (multi-account hygiene)', async () => {
    mockPushTokenRows = { 'tok-1': { userId: 'someone-else' } }
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Silent-register edge (OS already granted, no live token)', () => {
  it('does NOT render the modal, and calls requestAndRegisterPushToken() then markStreakPromptSeen()', async () => {
    getPushPermissionStatusMock.mockResolvedValue('granted')
    const { container } = render(<StreakReminderPermissionGate />)

    await waitFor(() => expect(requestAndRegisterPushTokenMock).toHaveBeenCalledTimes(1))
    expect(container.firstChild).toBeNull()
    expect(markStreakPromptSeenMock).toHaveBeenCalledTimes(1)
  })

  it('does not set the deny cooldown on the silent-register path', async () => {
    getPushPermissionStatusMock.mockResolvedValue('granted')
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(requestAndRegisterPushTokenMock).toHaveBeenCalledTimes(1))
    expect(setPushPermissionDeniedMock).not.toHaveBeenCalled()
  })

  it('calls enableStreakRemindersDefault() on the silent-register path (closes the 6.2 opt-in gap)', async () => {
    getPushPermissionStatusMock.mockResolvedValue('granted')
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(markStreakPromptSeenMock).toHaveBeenCalledTimes(1))
    expect(enableStreakRemindersDefaultMock).toHaveBeenCalledTimes(1)
  })

  it('does not silently register when a live token already exists (falls through to null, no redundant call)', async () => {
    getPushPermissionStatusMock.mockResolvedValue('granted')
    mockPushTokenRows = { 'tok-1': { userId: 'user-1' } }
    const { container } = render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(container.firstChild).toBeNull())
    expect(requestAndRegisterPushTokenMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Enable interaction', () => {
  it('tapping Enable calls requestAndRegisterPushToken()', async () => {
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(screen.getByTestId('btn-enable')).toBeTruthy())
    fireEvent.click(screen.getByTestId('btn-enable'))
    await waitFor(() => expect(requestAndRegisterPushTokenMock).toHaveBeenCalledTimes(1))
  })

  it('outcome "granted" marks the prompt seen and does NOT set the deny cooldown', async () => {
    requestAndRegisterPushTokenMock.mockResolvedValue({ outcome: 'granted' })
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(screen.getByTestId('btn-enable')).toBeTruthy())
    fireEvent.click(screen.getByTestId('btn-enable'))

    await waitFor(() => expect(markStreakPromptSeenMock).toHaveBeenCalledTimes(1))
    expect(setPushPermissionDeniedMock).not.toHaveBeenCalled()
  })

  it('outcome "granted" calls enableStreakRemindersDefault() (the primary opt-in path now actually enables reminders)', async () => {
    requestAndRegisterPushTokenMock.mockResolvedValue({ outcome: 'granted' })
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(screen.getByTestId('btn-enable')).toBeTruthy())
    fireEvent.click(screen.getByTestId('btn-enable'))

    await waitFor(() => expect(enableStreakRemindersDefaultMock).toHaveBeenCalledTimes(1))
  })

  it('outcome "granted-no-token" marks the prompt seen and does NOT set the deny cooldown', async () => {
    requestAndRegisterPushTokenMock.mockResolvedValue({ outcome: 'granted-no-token' })
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(screen.getByTestId('btn-enable')).toBeTruthy())
    fireEvent.click(screen.getByTestId('btn-enable'))

    await waitFor(() => expect(markStreakPromptSeenMock).toHaveBeenCalledTimes(1))
    expect(setPushPermissionDeniedMock).not.toHaveBeenCalled()
  })

  it('outcome "granted-no-token" also calls enableStreakRemindersDefault() (a grant whose token issuance failed still reflects intent)', async () => {
    requestAndRegisterPushTokenMock.mockResolvedValue({ outcome: 'granted-no-token' })
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(screen.getByTestId('btn-enable')).toBeTruthy())
    fireEvent.click(screen.getByTestId('btn-enable'))

    await waitFor(() => expect(enableStreakRemindersDefaultMock).toHaveBeenCalledTimes(1))
  })

  it('outcome "denied" marks the prompt seen AND sets the deny cooldown', async () => {
    requestAndRegisterPushTokenMock.mockResolvedValue({ outcome: 'denied' })
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(screen.getByTestId('btn-enable')).toBeTruthy())
    fireEvent.click(screen.getByTestId('btn-enable'))

    await waitFor(() => expect(markStreakPromptSeenMock).toHaveBeenCalledTimes(1))
    expect(setPushPermissionDeniedMock).toHaveBeenCalledTimes(1)
  })

  it('outcome "denied" does NOT call enableStreakRemindersDefault() (respect the deny)', async () => {
    requestAndRegisterPushTokenMock.mockResolvedValue({ outcome: 'denied' })
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(screen.getByTestId('btn-enable')).toBeTruthy())
    fireEvent.click(screen.getByTestId('btn-enable'))

    await waitFor(() => expect(markStreakPromptSeenMock).toHaveBeenCalledTimes(1))
    expect(enableStreakRemindersDefaultMock).not.toHaveBeenCalled()
  })

  it('a fast double-tap on Enable only fires ONE requestAndRegisterPushToken() call (re-entrancy guard)', async () => {
    let resolveRegister!: (value: { outcome: string }) => void
    requestAndRegisterPushTokenMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRegister = resolve
        })
    )
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(screen.getByTestId('btn-enable')).toBeTruthy())

    const enableButton = screen.getByTestId('btn-enable')
    fireEvent.click(enableButton)
    fireEvent.click(enableButton)

    resolveRegister({ outcome: 'granted' })
    await waitFor(() => expect(markStreakPromptSeenMock).toHaveBeenCalled())

    expect(requestAndRegisterPushTokenMock).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Not now interaction', () => {
  it('tapping Not now calls markStreakPromptSeen() only — no native call, no cooldown', async () => {
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(screen.getByTestId('btn-not-now')).toBeTruthy())
    fireEvent.click(screen.getByTestId('btn-not-now'))

    await waitFor(() => expect(markStreakPromptSeenMock).toHaveBeenCalledTimes(1))
    expect(requestAndRegisterPushTokenMock).not.toHaveBeenCalled()
    expect(setPushPermissionDeniedMock).not.toHaveBeenCalled()
  })

  it('tapping Not now does NOT call enableStreakRemindersDefault()', async () => {
    render(<StreakReminderPermissionGate />)
    await waitFor(() => expect(screen.getByTestId('btn-not-now')).toBeTruthy())
    fireEvent.click(screen.getByTestId('btn-not-now'))

    await waitFor(() => expect(markStreakPromptSeenMock).toHaveBeenCalledTimes(1))
    expect(enableStreakRemindersDefaultMock).not.toHaveBeenCalled()
  })
})
