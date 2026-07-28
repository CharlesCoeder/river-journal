// @vitest-environment happy-dom
/**
 * Red-phase unit tests for `features/notifications/ReminderSettings.tsx` —
 * the reminder-settings preferences surface (three category toggles + a
 * streak time-of-day picker), mounted inside SettingsScreen.
 *
 * Red-phase contract: every test MUST fail until the target module exists —
 * the whole file fails at the top-level `import { ReminderSettings } from
 * '../ReminderSettings'` with a module-resolution error, per this repo's
 * established red-phase convention (see `StreakReminderPermissionGate.test.tsx`).
 *
 * Tests are written against ACCESSIBLE BEHAVIOR (role="switch" + checked state
 * + accessible name), not a specific toggle-widget implementation — the story
 * leaves the choice between Tamagui `Switch` and an extended
 * `ExpandingLineButton` to the implementer, and either choice must satisfy the
 * same a11y contract. The `@my/ui` mock below stubs BOTH `Switch` and
 * `ExpandingLineButton` with equivalent accessible output so this file
 * collects and passes regardless of which the implementation picks.
 *
 * Contract this file locks in:
 *   - Three category toggles: "Streak reminders" / "Collective replies" /
 *     "Moderation actions", each `role="switch"` with `aria-checked`
 *     reflecting `reminders.{streak,replies,moderation}.enabled` (absent/
 *     undefined reads as unchecked/off).
 *   - Toggling a category calls `setReminderCategoryEnabled(category, next)`
 *     (mocked `../reminderPreferences`); enabling ALSO calls
 *     `requestAndRegisterPushToken()` (mocked `app/utils/pushTokens`) on every
 *     platform (the web/desktop stub no-ops harmlessly); disabling calls only
 *     the writer, never the registration call. An explicit toggle bypasses the
 *     deny cooldown — it always attempts registration on enable regardless of
 *     a stored `permissionLastDeniedAt`.
 *   - The streak time picker is hidden when the streak toggle is off, visible
 *     when on, defaulting to `'20:00'` when `local_time` is unset. Its
 *     hour/minute controls are focusable, individually labelled
 *     ("...hour"/"...minute"), and commit a new `'HH:mm'` value via
 *     `setStreakReminderTime()`.
 *   - Web/desktop (`Platform.OS === 'web'`): renders the mobile-only
 *     microcopy; never calls `getPushPermissionStatus()` (no OS check needed
 *     off-native).
 *   - Native: reads `getPushPermissionStatus()` on mount; renders the denied
 *     microcopy (naming iOS/Android per `Platform.OS`) only on a `'denied'`
 *     result; never auto-fires another permission request from that read.
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

// ─── Legend-State use$ mock — reads any observable-shaped `{ get() }` leaf ──
vi.mock('@legendapp/state/react', () => ({
  use$: vi.fn((obs: any) => {
    if (obs && typeof obs === 'object' && typeof obs.get === 'function') {
      return obs.get()
    }
    return obs
  }),
}))

// ─── app/state/store mock — reminders sub-tree, nested-getter pattern ──────
// Mirrors StreakReminderPermissionGate.test.tsx's `store$.views.streak`
// getter-returning-observable-shape pattern, extended to the four leaf
// reads this component needs.
let mockReminders: {
  streak?: { enabled?: boolean; local_time?: string }
  replies?: { enabled?: boolean }
  moderation?: { enabled?: boolean }
} = {}

vi.mock('app/state/store', () => ({
  store$: {
    profile: {
      get preferences() {
        return {
          get reminders() {
            return {
              get streak() {
                return {
                  get enabled() {
                    return { get: () => mockReminders.streak?.enabled }
                  },
                  get local_time() {
                    return { get: () => mockReminders.streak?.local_time }
                  },
                }
              },
              get replies() {
                return {
                  get enabled() {
                    return { get: () => mockReminders.replies?.enabled }
                  },
                }
              },
              get moderation() {
                return {
                  get enabled() {
                    return { get: () => mockReminders.moderation?.enabled }
                  },
                }
              },
            }
          },
        }
      },
    },
  },
}))

// ─── app/utils/pushTokens mock — the platform-agnostic boundary import ─────
const requestAndRegisterPushTokenMock = vi.fn()
const getPushPermissionStatusMock = vi.fn()
const hasLivePushTokenMock = vi.fn()
vi.mock('app/utils/pushTokens', () => ({
  requestAndRegisterPushToken: () => requestAndRegisterPushTokenMock(),
  hasLivePushToken: (userId: string) => hasLivePushTokenMock(userId),
  getPushPermissionStatus: () => getPushPermissionStatusMock(),
}))

// ─── ../reminderPreferences mock — write helpers as spies ──────────────────
const setReminderCategoryEnabledMock = vi.fn()
const setStreakReminderTimeMock = vi.fn()
vi.mock('../reminderPreferences', () => ({
  setReminderCategoryEnabled: (category: string, enabled: boolean) =>
    setReminderCategoryEnabledMock(category, enabled),
  setStreakReminderTime: (next: string) => setStreakReminderTimeMock(next),
}))

// ─── @my/ui mock — passthroughs covering BOTH documented toggle-widget
// choices (Tamagui `Switch` or an extended `ExpandingLineButton`), each
// forwarding `accessibilityRole` / `accessibilityState` / `accessibilityLabel`
// onto real DOM `role` / `aria-checked` / `aria-label` attributes so RTL's
// `getByRole('switch', { name, checked })` works regardless of which the
// implementation uses. ────────────────────────────────────────────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const a11yProps = (props: Record<string, any>) => {
    const out: Record<string, unknown> = {}
    if (props.accessibilityRole) out.role = props.accessibilityRole
    if (props.accessibilityState?.checked !== undefined) {
      out['aria-checked'] = props.accessibilityState.checked
    }
    if (props.accessibilityLabel) out['aria-label'] = props.accessibilityLabel
    if (props.testID) out['data-testid'] = props.testID
    if (props.id) out.id = props.id
    return out
  }

  const Text = ({ children }: any) => ReactModule.createElement('span', null, children)
  const XStack = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-stack': 'x' }, children)
  const YStack = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-stack': 'y' }, children)
  const View = ({ children, ...rest }: any) =>
    ReactModule.createElement('div', a11yProps(rest), children)

  const ExpandingLineButton = ({ children, onPress, disabled, ...rest }: any) =>
    ReactModule.createElement(
      'button',
      {
        onClick: disabled ? undefined : onPress,
        disabled: !!disabled,
        ...a11yProps({
          accessibilityRole: rest.accessibilityRole ?? 'button',
          accessibilityState: rest.accessibilityState,
          accessibilityLabel:
            rest.accessibilityLabel ?? (typeof children === 'string' ? children : undefined),
          testID: rest.testID,
          id: rest.id,
        }),
      },
      children
    )

  const Switch = ({
    checked,
    defaultChecked,
    onCheckedChange,
    disabled,
    children,
    ...rest
  }: any) => {
    const isChecked = rest.accessibilityState?.checked ?? checked ?? defaultChecked ?? false
    return ReactModule.createElement(
      'button',
      {
        onClick: disabled ? undefined : () => onCheckedChange?.(!isChecked),
        disabled: !!disabled,
        ...a11yProps({
          accessibilityRole: rest.accessibilityRole ?? 'switch',
          accessibilityState: { checked: isChecked },
          accessibilityLabel: rest.accessibilityLabel,
          testID: rest.testID,
          id: rest.id,
        }),
      },
      children
    )
  }
  Switch.Thumb = () => null

  return {
    AnimatePresence: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    Text,
    XStack,
    YStack,
    View,
    ExpandingLineButton,
    Switch,
    useReducedMotion: () => false,
  }
})

// ─── Import under test — fails until the component exists ──────────────────
import { ReminderSettings } from '../ReminderSettings'

beforeEach(() => {
  mockPlatformOS = 'ios'
  mockReminders = {}
  setReminderCategoryEnabledMock.mockReset()
  setStreakReminderTimeMock.mockReset()
  requestAndRegisterPushTokenMock.mockReset().mockResolvedValue({ outcome: 'granted' })
  getPushPermissionStatusMock.mockReset().mockResolvedValue('undetermined')
  hasLivePushTokenMock.mockReset().mockReturnValue(false)
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Category toggles — reflect seeded reminders state', () => {
  it('renders all three category toggles with role="switch" and their accessible names', () => {
    render(<ReminderSettings />)
    expect(screen.getByRole('switch', { name: 'Streak reminders' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Collective replies' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Moderation actions' })).toBeTruthy()
  })

  it('an absent/undefined `enabled` reads as OFF (unchecked) for every category — calm opt-in default', () => {
    mockReminders = {}
    render(<ReminderSettings />)
    expect(screen.getByRole('switch', { name: 'Streak reminders', checked: false })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Collective replies', checked: false })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Moderation actions', checked: false })).toBeTruthy()
  })

  it('reflects a seeded ON state per category independently', () => {
    mockReminders = {
      streak: { enabled: true },
      replies: { enabled: false },
      moderation: { enabled: true },
    }
    render(<ReminderSettings />)
    expect(screen.getByRole('switch', { name: 'Streak reminders', checked: true })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Collective replies', checked: false })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Moderation actions', checked: true })).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Toggling a category — writer + reuse-the-6.2-registration-path', () => {
  it('turning Streak reminders ON calls setReminderCategoryEnabled("streak", true) then requestAndRegisterPushToken()', async () => {
    render(<ReminderSettings />)
    fireEvent.click(screen.getByRole('switch', { name: 'Streak reminders' }))

    await waitFor(() => expect(requestAndRegisterPushTokenMock).toHaveBeenCalledTimes(1))
    expect(setReminderCategoryEnabledMock).toHaveBeenCalledWith('streak', true)

    const enableCallOrder = setReminderCategoryEnabledMock.mock.invocationCallOrder[0]
    const registerCallOrder = requestAndRegisterPushTokenMock.mock.invocationCallOrder[0]
    expect(enableCallOrder).toBeLessThan(registerCallOrder as number)
  })

  it('turning Streak reminders OFF calls the writer only — no registration call', async () => {
    mockReminders = { streak: { enabled: true } }
    render(<ReminderSettings />)
    fireEvent.click(screen.getByRole('switch', { name: 'Streak reminders' }))

    await waitFor(() =>
      expect(setReminderCategoryEnabledMock).toHaveBeenCalledWith('streak', false)
    )
    expect(requestAndRegisterPushTokenMock).not.toHaveBeenCalled()
  })

  it('turning Collective replies ON also fires requestAndRegisterPushToken (one token serves all categories)', async () => {
    render(<ReminderSettings />)
    fireEvent.click(screen.getByRole('switch', { name: 'Collective replies' }))

    await waitFor(() => expect(requestAndRegisterPushTokenMock).toHaveBeenCalledTimes(1))
    expect(setReminderCategoryEnabledMock).toHaveBeenCalledWith('replies', true)
  })

  it('turning Moderation actions ON also fires requestAndRegisterPushToken', async () => {
    render(<ReminderSettings />)
    fireEvent.click(screen.getByRole('switch', { name: 'Moderation actions' }))

    await waitFor(() => expect(requestAndRegisterPushTokenMock).toHaveBeenCalledTimes(1))
    expect(setReminderCategoryEnabledMock).toHaveBeenCalledWith('moderation', true)
  })

  it('an explicit enable bypasses the deny cooldown — still registers even with a recent permissionLastDeniedAt', async () => {
    // permissionLastDeniedAt is not part of the reactive reads this component
    // needs (it is read/written by reminderPreferences, not surfaced here),
    // so the only observable behavior is: registration still fires on an
    // explicit enable regardless of any stored cooldown.
    render(<ReminderSettings />)
    fireEvent.click(screen.getByRole('switch', { name: 'Streak reminders' }))
    await waitFor(() => expect(requestAndRegisterPushTokenMock).toHaveBeenCalledTimes(1))
  })

  it('on web/desktop, an enable still calls requestAndRegisterPushToken (resolves to the harmless {outcome: "unsupported"} stub, no throw)', async () => {
    mockPlatformOS = 'web'
    requestAndRegisterPushTokenMock.mockResolvedValue({ outcome: 'unsupported' })
    render(<ReminderSettings />)
    fireEvent.click(screen.getByRole('switch', { name: 'Streak reminders' }))

    await waitFor(() => expect(requestAndRegisterPushTokenMock).toHaveBeenCalledTimes(1))
    expect(setReminderCategoryEnabledMock).toHaveBeenCalledWith('streak', true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Streak time picker — visibility + default', () => {
  it('is hidden when the streak toggle is off (no hour/minute controls in the DOM)', () => {
    mockReminders = { streak: { enabled: false } }
    render(<ReminderSettings />)
    expect(screen.queryByRole('button', { name: /hour/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /minute/i })).toBeNull()
  })

  it('is visible when the streak toggle is on', () => {
    mockReminders = { streak: { enabled: true } }
    render(<ReminderSettings />)
    expect(screen.getByRole('button', { name: /hour/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /minute/i })).toBeTruthy()
  })

  it('defaults the picker to 8:00pm (\'20:00\') when local_time is unset — incrementing the hour once yields "21:..."', async () => {
    mockReminders = { streak: { enabled: true } }
    render(<ReminderSettings />)
    const hourControl = screen.getAllByRole('button', { name: /hour/i })[0]!
    fireEvent.click(hourControl)

    await waitFor(() => expect(setStreakReminderTimeMock).toHaveBeenCalledTimes(1))
    const written = setStreakReminderTimeMock.mock.calls[0]![0] as string
    expect(written).toMatch(/^21:00$/)
  })

  it('starts the picker from a seeded local_time — incrementing the hour from "07:15" yields "08:15"', async () => {
    mockReminders = { streak: { enabled: true, local_time: '07:15' } }
    render(<ReminderSettings />)
    const hourControl = screen.getAllByRole('button', { name: /hour/i })[0]!
    fireEvent.click(hourControl)

    await waitFor(() => expect(setStreakReminderTimeMock).toHaveBeenCalledTimes(1))
    expect(setStreakReminderTimeMock).toHaveBeenCalledWith('08:15')
  })

  it('wraps the hour from 23 back to 00 (24-hour wrap)', async () => {
    mockReminders = { streak: { enabled: true, local_time: '23:30' } }
    render(<ReminderSettings />)
    const hourControl = screen.getAllByRole('button', { name: /hour/i })[0]!
    fireEvent.click(hourControl)

    await waitFor(() => expect(setStreakReminderTimeMock).toHaveBeenCalledTimes(1))
    expect(setStreakReminderTimeMock).toHaveBeenCalledWith('00:30')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Streak time picker — commits a change via setStreakReminderTime', () => {
  it('clicking the minute control commits a new, validly-formatted HH:mm value (never a Date)', async () => {
    mockReminders = { streak: { enabled: true, local_time: '10:00' } }
    render(<ReminderSettings />)
    const minuteControl = screen.getAllByRole('button', { name: /minute/i })[0]!
    fireEvent.click(minuteControl)

    await waitFor(() => expect(setStreakReminderTimeMock).toHaveBeenCalledTimes(1))
    const written = setStreakReminderTimeMock.mock.calls[0]![0]
    expect(typeof written).toBe('string')
    expect(written).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
    expect(written).not.toBe('10:00')
  })

  it('changing the time does NOT call setReminderCategoryEnabled (independent writers)', async () => {
    mockReminders = { streak: { enabled: true, local_time: '10:00' } }
    render(<ReminderSettings />)
    fireEvent.click(screen.getAllByRole('button', { name: /hour/i })[0]!)

    await waitFor(() => expect(setStreakReminderTimeMock).toHaveBeenCalledTimes(1))
    expect(setReminderCategoryEnabledMock).not.toHaveBeenCalled()
  })

  it('the hour and minute controls are independently focusable (keyboard-operable, native button semantics)', () => {
    mockReminders = { streak: { enabled: true } }
    render(<ReminderSettings />)
    const hourControl = screen.getAllByRole('button', { name: /hour/i })[0]! as HTMLElement
    const minuteControl = screen.getAllByRole('button', { name: /minute/i })[0]! as HTMLElement

    hourControl.focus()
    expect(document.activeElement).toBe(hourControl)
    minuteControl.focus()
    expect(document.activeElement).toBe(minuteControl)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Web/desktop — mobile-only microcopy, no OS permission check', () => {
  it('renders the mobile-only microcopy on web', () => {
    mockPlatformOS = 'web'
    render(<ReminderSettings />)
    expect(screen.getByText(/Push notifications are mobile-only at launch\./)).toBeTruthy()
    expect(
      screen.getByText(/Web and desktop see in-app reminders when you open the app\./)
    ).toBeTruthy()
  })

  it('never calls getPushPermissionStatus on web (no OS-level check needed off-native)', async () => {
    mockPlatformOS = 'web'
    render(<ReminderSettings />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getPushPermissionStatusMock).not.toHaveBeenCalled()
  })

  it('never renders the mobile denied microcopy on web, even if permission status would resolve denied', async () => {
    mockPlatformOS = 'web'
    getPushPermissionStatusMock.mockResolvedValue('denied')
    render(<ReminderSettings />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText(/Notifications are off at the OS level\./)).toBeNull()
  })

  it('toggles still persist state on web (setReminderCategoryEnabled still fires)', async () => {
    mockPlatformOS = 'web'
    render(<ReminderSettings />)
    fireEvent.click(screen.getByRole('switch', { name: 'Streak reminders' }))
    await waitFor(() => expect(setReminderCategoryEnabledMock).toHaveBeenCalledWith('streak', true))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Mobile — denied-permission microcopy', () => {
  it('shows the denied microcopy naming "iOS Settings" when getPushPermissionStatus resolves "denied" on iOS', async () => {
    mockPlatformOS = 'ios'
    getPushPermissionStatusMock.mockResolvedValue('denied')
    render(<ReminderSettings />)

    await waitFor(() =>
      expect(screen.getByText(/Notifications are off at the OS level\./)).toBeTruthy()
    )
    expect(screen.getByText(/re-enable in iOS Settings/)).toBeTruthy()
  })

  it('shows the denied microcopy naming "Android Settings" on android', async () => {
    mockPlatformOS = 'android'
    getPushPermissionStatusMock.mockResolvedValue('denied')
    render(<ReminderSettings />)

    await waitFor(() => expect(screen.getByText(/re-enable in Android Settings/)).toBeTruthy())
  })

  it('does not show the denied microcopy when permission is "granted"', async () => {
    mockPlatformOS = 'ios'
    getPushPermissionStatusMock.mockResolvedValue('granted')
    render(<ReminderSettings />)
    await waitFor(() => expect(getPushPermissionStatusMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/Notifications are off at the OS level\./)).toBeNull()
  })

  it('does not show the denied microcopy when permission is "undetermined"', async () => {
    mockPlatformOS = 'ios'
    getPushPermissionStatusMock.mockResolvedValue('undetermined')
    render(<ReminderSettings />)
    await waitFor(() => expect(getPushPermissionStatusMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/Notifications are off at the OS level\./)).toBeNull()
  })

  it('reading denied status on mount never itself calls requestAndRegisterPushToken (microcopy only, no auto-reprompt)', async () => {
    mockPlatformOS = 'ios'
    getPushPermissionStatusMock.mockResolvedValue('denied')
    render(<ReminderSettings />)
    await waitFor(() =>
      expect(screen.getByText(/Notifications are off at the OS level\./)).toBeTruthy()
    )
    expect(requestAndRegisterPushTokenMock).not.toHaveBeenCalled()
  })

  it('the category toggles remain fully functional even in the denied state', async () => {
    mockPlatformOS = 'ios'
    getPushPermissionStatusMock.mockResolvedValue('denied')
    render(<ReminderSettings />)
    await waitFor(() =>
      expect(screen.getByText(/Notifications are off at the OS level\./)).toBeTruthy()
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Streak reminders' }))
    await waitFor(() => expect(setReminderCategoryEnabledMock).toHaveBeenCalledWith('streak', true))
    // An explicit toggle attempts registration regardless of the earlier
    // denied read (bypasses the automatic-gate cooldown).
    expect(requestAndRegisterPushTokenMock).toHaveBeenCalledTimes(1)
  })
})
