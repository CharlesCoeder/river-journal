// @vitest-environment happy-dom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockPush = vi.fn()
const mockReadUserEncryptionSettings = vi.fn()
const mockUpsertUserEncryptionMode = vi.fn()
const mockStartE2EEncryptionBootstrap = vi.fn()
const mockUnlockE2EEncryptionOnDevice = vi.fn()
const mockFetchManagedEncryptionKey = vi.fn()
vi.mock('../../../utils/userEncryption', () => ({
  readUserEncryptionSettings: (...args: unknown[]) => mockReadUserEncryptionSettings(...args),
  upsertUserEncryptionMode: (...args: unknown[]) => mockUpsertUserEncryptionMode(...args),
  startE2EEncryptionBootstrap: (...args: unknown[]) => mockStartE2EEncryptionBootstrap(...args),
  unlockE2EEncryptionOnDevice: (...args: unknown[]) => mockUnlockE2EEncryptionOnDevice(...args),
  validateE2EMasterKeyForUser: vi.fn().mockResolvedValue({ isValid: true, error: null }),
  persistMasterKeyToKeyring: vi.fn().mockResolvedValue({ error: null }),
  bootstrapManagedEncryption: vi.fn().mockResolvedValue({ error: null, managedKeyHex: 'a'.repeat(64) }),
  fetchManagedEncryptionKey: (...args: unknown[]) => mockFetchManagedEncryptionKey(...args),
}))

vi.mock('../../../utils/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    })),
  },
}))

vi.mock('../../../state/persistConfig', () => ({
  persistPlugin: {
    getTable: vi.fn(() => ({})),
    setTable: vi.fn(),
    deleteTable: vi.fn(),
    getMetadata: vi.fn(),
    setMetadata: vi.fn(),
    deleteMetadata: vi.fn(),
    loadTable: vi.fn(),
    saveTable: vi.fn(),
    set: vi.fn(),
  },
  configurePersistence: vi.fn(),
}))

vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const {
      testID,
      onPress,
      onChangeText,
      id,
      htmlFor,
      disabled,
      value,
      placeholder,
      children,
    } = props

    return {
      ...(id ? { id } : {}),
      ...(htmlFor ? { htmlFor } : {}),
      ...(disabled !== undefined ? { disabled } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(placeholder !== undefined ? { placeholder } : {}),
      ...(testID ? { 'data-testid': testID } : {}),
      ...(onPress ? { onClick: onPress } : {}),
      ...(onChangeText
        ? {
            onChange: (event: Event) => {
              const target = event.target as HTMLInputElement
              onChangeText(target.value)
            },
          }
        : {}),
    }
  }

  const passthrough = (tagName: keyof HTMLElementTagNameMap) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(tagName, mapProps(props), children)
    Component.displayName = tagName
    return Component
  }

  const Button = ({ children, onPress, testID, disabled, ...props }: any) =>
    ReactModule.createElement(
      'button',
      {
        type: 'button',
        disabled,
        ...(testID ? { 'data-testid': testID } : {}),
        onClick: onPress,
      },
      children
    )

  const Switch = ({ children, checked, onCheckedChange, testID, disabled, ...props }: any) =>
    ReactModule.createElement(
      'label',
      mapProps(props),
      ReactModule.createElement('input', {
        type: 'checkbox',
        checked,
        disabled,
        'data-testid': testID,
        onChange: (event: Event) => {
          const target = event.target as HTMLInputElement
          onCheckedChange?.(target.checked)
        },
      }),
      children
    )

  const AlertDialog = ({ children, open, ...props }: any) =>
    open ? ReactModule.createElement('div', mapProps(props), children) : null

  Switch.Thumb = passthrough('span')
  AlertDialog.Portal = passthrough('div')
  AlertDialog.Overlay = passthrough('div')
  AlertDialog.Content = passthrough('div')
  AlertDialog.Title = passthrough('h2')
  AlertDialog.Description = passthrough('p')
  AlertDialog.Cancel = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)
  AlertDialog.Action = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)

  return {
    AlertDialog,
    Button,
    Card: passthrough('section'),
    H1: passthrough('h1'),
    Input: ({ children, testID, value, onChangeText, secureTextEntry, disabled, placeholder, autoComplete }: any) =>
      ReactModule.createElement('input', {
        type: secureTextEntry ? 'password' : 'text',
        value,
        disabled,
        placeholder,
        autoComplete,
        ...(testID ? { 'data-testid': testID } : {}),
        onChange: (event: Event) => {
          const target = event.target as HTMLInputElement
          onChangeText?.(target.value)
        },
      }),
    Label: passthrough('label'),
    ScrollView: passthrough('div'),
    Separator: passthrough('hr'),
    Switch,
    Text: passthrough('span'),
    ThemeSwitcher: passthrough('div'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
  }
})

vi.mock('solito/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('app/utils', () => ({
  signOut: vi.fn(() => Promise.resolve({ error: null })),
}))

vi.mock('app/features/auth/components/LinkedProviders', () => ({
  LinkedProviders: () => React.createElement('div', null, 'LinkedProviders'),
}))

vi.mock('app/features/home/components/OrphanFlowsDialog', () => ({
  OrphanFlowsDialog: () => null,
}))

import { store$ } from '../../../state/store'
import {
  encryptionSetup$,
  loadCurrentEncryptionMode,
  resetEncryptionSetupState,
} from '../../../state/encryptionSetup'
import { HomeScreen } from '../HomeScreen'

afterEach(() => {
  cleanup()
})

describe('HomeScreen encryption flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEncryptionSetupState()
    store$.session.assign({
      localSessionId: 'sess-1',
      userId: 'user-1',
      email: 'charlie@example.com',
      isAuthenticated: true,
      syncEnabled: false,
    })

    mockReadUserEncryptionSettings.mockResolvedValue({
      data: { mode: null, salt: null, managedKeyHex: null },
      error: null,
    })
    mockUpsertUserEncryptionMode.mockResolvedValue({
      data: { mode: 'managed', salt: null, managedKeyHex: null },
      error: null,
    })
    mockStartE2EEncryptionBootstrap.mockResolvedValue({
      error: { message: 'pending', code: 'e2e_bootstrap_pending' },
    })
    mockUnlockE2EEncryptionOnDevice.mockResolvedValue({
      error: null,
    })
    mockFetchManagedEncryptionKey.mockResolvedValue({ data: 'a'.repeat(64), error: null })
    mockFetchManagedEncryptionKey.mockResolvedValue({ data: 'a'.repeat(64), error: null })
  })

  it('opens the chooser from the authenticated home sync toggle', async () => {
    render(React.createElement(HomeScreen))

    fireEvent.click(screen.getByTestId('sync-toggle'))

    await waitFor(() => {
      expect(store$.session.syncEnabled.get()).toBe(false)
      expect(encryptionSetup$.isOpen.get()).toBe(true)
      expect(screen.getByText('Choose your encryption mode')).toBeTruthy()
    })
  })

  it('renders E2E as the default choice with the required warnings', async () => {
    render(React.createElement(HomeScreen))

    await act(async () => {
      encryptionSetup$.assign({
        isOpen: true,
        selectedMode: 'e2e',
        step: 'choice',
        hasLoadedMode: true,
      })
    })

    expect(screen.getByText('Confirm End-to-End Encryption')).toBeTruthy()
    expect(screen.getByText('E2E Encryption')).toBeTruthy()
    expect(screen.getByText('Managed Encryption')).toBeTruthy()
    expect(screen.getByText('This choice cannot be changed later.')).toBeTruthy()
    expect(screen.getByText('If you forget this password, your cloud data is unrecoverable.')).toBeTruthy()
  })

  it('shows the current encryption mode as read-only on the home screen', async () => {
    mockReadUserEncryptionSettings.mockResolvedValue({
      data: { mode: 'managed', salt: null, managedKeyHex: 'a'.repeat(64) },
      error: null,
    })

    render(React.createElement(HomeScreen))

    await act(async () => {
      await loadCurrentEncryptionMode()
    })

    expect(screen.getByText('Encryption mode')).toBeTruthy()
    expect(screen.getByText('Managed encryption')).toBeTruthy()
    expect(screen.getByText('This choice is read-only for now.')).toBeTruthy()
  })

  it('shows key-required messaging when E2E is selected but local key is missing', async () => {
    render(React.createElement(HomeScreen))

    await act(async () => {
      encryptionSetup$.assign({
        hasLoadedMode: true,
        currentMode: 'e2e',
        currentModeSalt: '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df',
        hasLocalE2EKey: false,
        error: {
          message: 'Encryption password required on this device before Cloud Sync can be enabled.',
          code: 'e2e_password_required',
        },
      })
    })

    expect(screen.getByText('End-to-end encryption')).toBeTruthy()
    expect(screen.getByText('Encryption password required on this device')).toBeTruthy()
    expect(
      screen.getByText(
        'This account uses end-to-end encryption. Enter your encryption password on this device to unlock Cloud Sync.'
      )
    ).toBeTruthy()
    expect(screen.getByTestId('sync-toggle')).toHaveProperty('disabled', true)
    expect(screen.getByTestId('continue-e2e-setup')).toBeTruthy()
  })

  it('opens the password step when continuing locked E2E setup', async () => {
    render(React.createElement(HomeScreen))

    await act(async () => {
      encryptionSetup$.assign({
        hasLoadedMode: true,
        currentMode: 'e2e',
        currentModeSalt: null,
        hasLocalE2EKey: false,
        error: {
          message:
            'End-to-end encryption setup is incomplete for this account. Please finish setup again.',
          code: 'e2e_salt_missing',
        },
      })
    })

    fireEvent.click(screen.getByTestId('continue-e2e-setup'))

    await waitFor(() => {
      expect(screen.getByText('Finish end-to-end setup')).toBeTruthy()
      expect(screen.getByText('Create an encryption password')).toBeTruthy()
    })
  })

  it('shows a single-password unlock form for existing E2E devices', async () => {
    render(React.createElement(HomeScreen))

    await act(async () => {
      encryptionSetup$.assign({
        isOpen: true,
        selectedMode: 'e2e',
        step: 'e2e-password',
        isModeLocked: true,
        currentMode: 'e2e',
        currentModeSalt: '57b630cf0eb6e04f24229f7db1389d4fc40f83fa9eb7f4fce4b2605f8c2f86df',
        hasLoadedMode: true,
      })
    })

    expect(screen.getByText('Enter your encryption password')).toBeTruthy()
    expect(screen.queryByText('Confirm encryption password')).toBeNull()
    expect(screen.queryByTestId('e2e-confirm-password-input')).toBeNull()
  })

  it('offers a retry when managed key fetch fails', async () => {
    render(React.createElement(HomeScreen))

    await act(async () => {
      encryptionSetup$.assign({
        hasLoadedMode: true,
        currentMode: 'managed',
        currentModeSalt: null,
        hasLocalE2EKey: false,
        error: {
          message: 'Managed key missing',
          code: 'managed_key_missing',
        },
      })
    })

    const retryButton = screen.getByTestId('managed-key-retry')
    expect(retryButton).toBeTruthy()

    mockFetchManagedEncryptionKey.mockResolvedValueOnce({
      data: 'a'.repeat(64),
      error: null,
    })

    fireEvent.click(retryButton)

    await waitFor(() => {
      expect(encryptionSetup$.error.get()).toBeNull()
    })
  })

  it('offers legacy E2E unlock when managed mode hits an old E2E payload', async () => {
    render(React.createElement(HomeScreen))

    await act(async () => {
      encryptionSetup$.assign({
        hasLoadedMode: true,
        currentMode: 'managed',
        currentModeSalt: 'somesalt',
        hasLocalE2EKey: false,
        error: {
          message: 'Encryption password required on this device before encrypted flows can sync.',
          code: 'e2e_password_required',
        },
      })
    })

    const unlockButton = screen.getByTestId('managed-e2e-unlock')
    expect(unlockButton).toBeTruthy()

    fireEvent.click(unlockButton)

    await waitFor(() => {
      expect(encryptionSetup$.isOpen.get()).toBe(true)
    })
  })
})
