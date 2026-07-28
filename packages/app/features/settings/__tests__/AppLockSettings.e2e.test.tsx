// @vitest-environment happy-dom
/**
 * AppLockSettings.e2e.test.tsx — TDD red-phase E2E tests for the App Lock
 * settings component itself: the full enable/setup/disable user workflow on
 * both the mobile-capability branch and the web/desktop passcode
 * branch, the reactive toggle default, the interval selector,
 * and the honest threat-model copy.
 *
 * A sibling file to `SettingsScreen.appLock.e2e.test.tsx`, which covers only
 * the SettingsScreen MOUNT POINT (section-count bump, no auth-gating) with
 * `AppLockSettings` stubbed out — mirrors the existing
 * `ThemePicker.unlock.test.tsx` vs. `SettingsScreen.*.test.tsx` split in this
 * codebase. This file renders the real component with real `appLock$` /
 * `ephemeral$` state; only true externals are mocked (`react-native`
 * Platform, `app/utils/appLockAuth`, the expensive scrypt KDF entry point,
 * and `@my/ui`).
 *
 * Red-phase contract: `packages/app/features/settings/AppLockSettings.tsx`
 * and `packages/app/state/appLock.ts` do not exist yet — this whole file
 * fails at the top-level `import` with a module-resolution error until both
 * are created, per this repo's established red-phase convention (see
 * `BillingDisclosure.test.tsx`).
 *
 * ASSUMED CONTRACT (the story doesn't pin testIDs verbatim; chosen to mirror
 * `ReminderSettings`' `CategoryToggle` shape and `E2EPasswordForm`'s
 * two-field passcode pattern, both explicitly named as the UI-shape
 * templates in the design notes):
 *   - Toggle: `accessibilityRole="switch"`, `accessibilityLabel="App Lock"`.
 *   - Interval options: `accessibilityRole="radio"`, testIDs
 *     `app-lock-interval-immediately` / `-1m` / `-5m`.
 *   - Passcode setup fields: testIDs `app-lock-passcode-input` /
 *     `app-lock-passcode-confirm-input`, submit testID
 *     `app-lock-passcode-submit`.
 *   - The threat-model copy and the mobile disabled-capability copy
 *     are quoted VERBATIM from the story — these strings are
 *     load-bearing per the story text itself, not an assumption.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─── react-native Platform mock — mutable OS ────────────────────────────────
let mockPlatformOS: 'web' | 'ios' | 'android' = 'web'
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOS
    },
  },
}))

// ─── Real crypto module, with ONLY the expensive KDF entry point swapped for
// a fast deterministic stand-in — salt generation and the verifier's AES
// encrypt/decrypt stay real, so this exercises the real verifier shape
// without paying real N=2^17 scrypt cost on every render. ───────────────────
vi.mock('../../../utils/encryption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/encryption')>()
  const { createHash } = await import('node:crypto')
  return {
    ...actual,
    deriveMasterKeyFromPassword: async (password: string, saltB64: string) =>
      new Uint8Array(createHash('sha256').update(`${password}::${saltB64}`).digest()),
  }
})

// ─── app/utils/appLockAuth — the platform-split capability surface. Mocked
// per design notes: "Mock the auth surface — never the real native module." ───
let mockCapability: { available: boolean; kind: 'biometric' | 'credential' | 'none' } = {
  available: true,
  kind: 'biometric',
}
const promptAppLockAuthMock = vi.fn()
vi.mock('app/utils/appLockAuth', () => ({
  getAppLockCapability: () => Promise.resolve(mockCapability),
  promptAppLockAuth: () => promptAppLockAuthMock(),
}))

// ─── @my/ui mock — passthrough preserving accessibility props + a minimal
// Input, mirroring E2EPasswordForm's testID/value/onChangeText contract. ────
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
    return out
  }

  const Text = ({ children }: any) => ReactModule.createElement('span', null, children)
  const XStack = ({ children }: any) => ReactModule.createElement('div', null, children)
  const YStack = ({ children }: any) => ReactModule.createElement('div', null, children)
  const View = ({ children }: any) => ReactModule.createElement('div', null, children)

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
        }),
      },
      children
    )

  const Input = ({ testID, value, onChangeText, secureTextEntry }: any) =>
    ReactModule.createElement('input', {
      'data-testid': testID,
      value,
      onChange: (e: any) => onChangeText?.(e.target.value),
      type: secureTextEntry ? 'password' : 'text',
    })

  return { Text, XStack, YStack, View, ExpandingLineButton, Input }
})

// ─── Import under test — fails until AppLockSettings.tsx + state/appLock.ts
// exist. ─────────────────────────────────────────────────────────────────
import { AppLockSettings } from '../AppLockSettings'
import { appLock$ } from '../../../state/appLock'
import { ephemeral$ } from '../../../state/store'

beforeEach(() => {
  mockPlatformOS = 'web'
  mockCapability = { available: true, kind: 'biometric' }
  promptAppLockAuthMock.mockReset()
  appLock$.set({
    enabled: false,
    autoLockInterval: 'immediately',
    passcodeSalt: null,
    passcodeVerifier: null,
  })
  ephemeral$.isLocked.set(false)
})

afterEach(() => {
  cleanup()
})

async function submitWebPasscode(passcode: string, confirm = passcode) {
  fireEvent.click(screen.getByRole('switch', { name: 'App Lock' }))
  fireEvent.change(screen.getByTestId('app-lock-passcode-input'), { target: { value: passcode } })
  fireEvent.change(screen.getByTestId('app-lock-passcode-confirm-input'), {
    target: { value: confirm },
  })
  await act(async () => {
    fireEvent.click(screen.getByTestId('app-lock-passcode-submit'))
  })
}

// ============================================================================
// Toggle default OFF, reflects appLock$.enabled reactively
// ============================================================================

describe('toggle default and reactivity', () => {
  it('defaults to OFF', () => {
    render(React.createElement(AppLockSettings))
    const toggle = screen.getByRole('switch', { name: 'App Lock' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('reflects an already-enabled appLock$ state on mount (reactive read, not local-only state)', () => {
    appLock$.enabled.set(true)
    render(React.createElement(AppLockSettings))
    const toggle = screen.getByRole('switch', { name: 'App Lock' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })
})

// ============================================================================
// Honest threat-model copy
// ============================================================================

describe('threat-model copy', () => {
  it('shows the exact threat-model copy pointing at Privacy Center, on every platform', () => {
    render(React.createElement(AppLockSettings))
    expect(
      screen.getByText(
        'App Lock prevents casual access on a shared device. It does not add encryption — your data protection settings are in Privacy Center.'
      )
    ).toBeTruthy()
  })
})

// ============================================================================
// Interval selector: hidden when off, 3 options defaulting to
// Immediately when on
// ============================================================================

describe('auto-lock interval selector', () => {
  it('is hidden while App Lock is off', () => {
    render(React.createElement(AppLockSettings))
    expect(screen.queryByText('After 1 minute')).toBeNull()
    expect(screen.queryByText('After 5 minutes')).toBeNull()
  })

  it('shows 3 options defaulting to Immediately once enabled (web passcode flow)', async () => {
    render(React.createElement(AppLockSettings))
    await submitWebPasscode('secret123')

    expect(screen.getByText('Immediately')).toBeTruthy()
    expect(screen.getByText('After 1 minute')).toBeTruthy()
    expect(screen.getByText('After 5 minutes')).toBeTruthy()
    expect(screen.getByTestId('app-lock-interval-immediately').getAttribute('aria-checked')).toBe(
      'true'
    )
  })

  it('selecting a different interval persists it to appLock$.autoLockInterval', async () => {
    render(React.createElement(AppLockSettings))
    await submitWebPasscode('secret123')

    fireEvent.click(screen.getByTestId('app-lock-interval-5m'))

    expect(appLock$.autoLockInterval.get()).toBe('5m')
  })
})

// ============================================================================
// Web/desktop passcode setup workflow
// ============================================================================

describe('web/desktop passcode setup', () => {
  beforeEach(() => {
    mockPlatformOS = 'web'
  })

  it('enabling opens passcode setup with two fields', () => {
    render(React.createElement(AppLockSettings))
    fireEvent.click(screen.getByRole('switch', { name: 'App Lock' }))
    expect(screen.getByTestId('app-lock-passcode-input')).toBeTruthy()
    expect(screen.getByTestId('app-lock-passcode-confirm-input')).toBeTruthy()
  })

  it('rejects a passcode under 6 characters — App Lock stays disabled, nothing persisted', async () => {
    render(React.createElement(AppLockSettings))
    await submitWebPasscode('12345')

    expect(appLock$.enabled.get()).toBe(false)
    expect(appLock$.passcodeSalt.get()).toBeNull()
    expect(appLock$.passcodeVerifier.get()).toBeNull()
  })

  it('rejects mismatched passcodes — App Lock stays disabled, nothing persisted', async () => {
    render(React.createElement(AppLockSettings))
    await submitWebPasscode('secret123', 'different123')

    expect(appLock$.enabled.get()).toBe(false)
    expect(appLock$.passcodeSalt.get()).toBeNull()
  })

  it('accepts a valid, matching 6+ character passcode — enables App Lock and persists ONLY salt+verifier (never plaintext)', async () => {
    render(React.createElement(AppLockSettings))
    await submitWebPasscode('secret123')

    expect(appLock$.enabled.get()).toBe(true)
    expect(appLock$.passcodeSalt.get()).not.toBeNull()
    expect(appLock$.passcodeVerifier.get()).not.toBeNull()
    expect(JSON.stringify(appLock$.get())).not.toContain('secret123')
  })

  it('shows the unrecoverable-passcode warning copy during setup', () => {
    render(React.createElement(AppLockSettings))
    fireEvent.click(screen.getByRole('switch', { name: 'App Lock' }))
    expect(screen.getByText(/cannot be recovered/i)).toBeTruthy()
  })

  it('disabling clears the passcode (both salt + verifier) and immediately clears any active lock', async () => {
    render(React.createElement(AppLockSettings))
    await submitWebPasscode('secret123')
    ephemeral$.isLocked.set(true)

    fireEvent.click(screen.getByRole('switch', { name: 'App Lock' }))

    expect(appLock$.enabled.get()).toBe(false)
    expect(appLock$.passcodeSalt.get()).toBeNull()
    expect(appLock$.passcodeVerifier.get()).toBeNull()
    expect(ephemeral$.isLocked.get()).toBe(false)
  })
})

// ============================================================================
// Mobile biometric/credential capability
// ============================================================================

describe('mobile capability detection', () => {
  beforeEach(() => {
    mockPlatformOS = 'ios'
  })

  it('when biometric capability is available, enabling proceeds without a passcode prompt', async () => {
    mockCapability = { available: true, kind: 'biometric' }
    render(React.createElement(AppLockSettings))

    fireEvent.click(screen.getByRole('switch', { name: 'App Lock' }))
    await act(async () => {
      await Promise.resolve()
    })

    expect(appLock$.enabled.get()).toBe(true)
    expect(screen.queryByTestId('app-lock-passcode-input')).toBeNull()
  })

  it('when only a device credential (no biometric) is available, enabling still proceeds via the OS fallback', async () => {
    mockCapability = { available: true, kind: 'credential' }
    render(React.createElement(AppLockSettings))

    fireEvent.click(screen.getByRole('switch', { name: 'App Lock' }))
    await act(async () => {
      await Promise.resolve()
    })

    expect(appLock$.enabled.get()).toBe(true)
  })

  it('when NEITHER biometric nor device credential exists, the toggle renders disabled with the explanatory copy', async () => {
    mockCapability = { available: false, kind: 'none' }
    render(React.createElement(AppLockSettings))

    await act(async () => {
      await Promise.resolve()
    })

    const toggle = screen.getByRole('switch', { name: 'App Lock' })
    expect(toggle.hasAttribute('disabled')).toBe(true)
    expect(
      screen.getByText(
        "Set up Face ID, Touch ID, or a device passcode in your phone's settings to use App Lock."
      )
    ).toBeTruthy()
    expect(appLock$.enabled.get()).toBe(false)
  })
})
