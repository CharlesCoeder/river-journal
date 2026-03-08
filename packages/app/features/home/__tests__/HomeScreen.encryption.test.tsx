import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create } from 'react-test-renderer'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mockPush = vi.fn()
const mockReadUserEncryptionSettings = vi.fn()
const mockUpsertUserEncryptionMode = vi.fn()
const mockStartE2EEncryptionBootstrap = vi.fn()

vi.mock('../../../utils/userEncryption', () => ({
  readUserEncryptionSettings: (...args: unknown[]) => mockReadUserEncryptionSettings(...args),
  upsertUserEncryptionMode: (...args: unknown[]) => mockUpsertUserEncryptionMode(...args),
  startE2EEncryptionBootstrap: (...args: unknown[]) => mockStartE2EEncryptionBootstrap(...args),
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

  const passthrough = (name: string) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(name, props, children)
    Component.displayName = name
    return Component
  }

  const Button = ({ children, ...props }: any) => ReactModule.createElement('Button', props, children)
  const Switch = ({ children, ...props }: any) => ReactModule.createElement('Switch', props, children)
  const AlertDialog = ({ children, open, ...props }: any) =>
    open ? ReactModule.createElement('AlertDialog', props, children) : null

  Switch.Thumb = passthrough('SwitchThumb')
  AlertDialog.Portal = passthrough('AlertDialogPortal')
  AlertDialog.Overlay = passthrough('AlertDialogOverlay')
  AlertDialog.Content = passthrough('AlertDialogContent')
  AlertDialog.Title = passthrough('AlertDialogTitle')
  AlertDialog.Description = passthrough('AlertDialogDescription')
  AlertDialog.Cancel = ({ children }: any) => ReactModule.createElement(ReactModule.Fragment, null, children)
  AlertDialog.Action = ({ children }: any) => ReactModule.createElement(ReactModule.Fragment, null, children)

  return {
    AlertDialog,
    Button,
    Card: passthrough('Card'),
    H1: passthrough('H1'),
    Input: ({ children, ...props }: any) => ReactModule.createElement('Input', props, children),
    Label: passthrough('Label'),
    ScrollView: passthrough('ScrollView'),
    Separator: passthrough('Separator'),
    Switch,
    Text: passthrough('Text'),
    ThemeSwitcher: passthrough('ThemeSwitcher'),
    XStack: passthrough('XStack'),
    YStack: passthrough('YStack'),
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
  LinkedProviders: () => React.createElement('LinkedProviders'),
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

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const renderHomeScreen = async () => {
  let renderer!: ReturnType<typeof create>

  await act(async () => {
    renderer = create(React.createElement(HomeScreen))
    await Promise.resolve()
    await Promise.resolve()
  })

  return renderer
}

const getTextContent = (root: ReturnType<typeof create>['root']) =>
  root
    .findAll(
      node =>
        String(node.type) === 'Text' ||
        String(node.type) === 'AlertDialogTitle' ||
        String(node.type) === 'AlertDialogDescription' ||
        String(node.type) === 'Button'
    )
    .flatMap(node => {
      const children = node.props.children
      return Array.isArray(children) ? children : [children]
    })
    .filter((value): value is string => typeof value === 'string')

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
      data: { mode: null, salt: null },
      error: null,
    })
    mockUpsertUserEncryptionMode.mockResolvedValue({
      data: { mode: 'managed', salt: null },
      error: null,
    })
    mockStartE2EEncryptionBootstrap.mockResolvedValue({
      error: { message: 'pending', code: 'e2e_bootstrap_pending' },
    })
  })

  it('opens the chooser from the authenticated home sync toggle', async () => {
    const renderer = await renderHomeScreen()

    const toggle = renderer.root.findByProps({ testID: 'sync-toggle' })

    await act(async () => {
      toggle.props.onCheckedChange(true)
      await Promise.resolve()
    })

    expect(store$.session.syncEnabled.get()).toBe(false)
    expect(encryptionSetup$.isOpen.get()).toBe(true)
    expect(getTextContent(renderer.root)).toContain('Choose your encryption mode')
  })

  it('renders E2E as the default choice with the required warnings', async () => {
    const renderer = await renderHomeScreen()

    await act(async () => {
      encryptionSetup$.assign({
        isOpen: true,
        selectedMode: 'e2e',
        step: 'choice',
        hasLoadedMode: true,
      })
    })

    const text = getTextContent(renderer.root)

    expect(text).toContain('Confirm End-to-End Encryption')
    expect(text).toContain('E2E Encryption')
    expect(text).toContain('Managed Encryption')
    expect(text).toContain('This choice cannot be changed later.')
    expect(text).toContain('If you forget this password, your cloud data is unrecoverable.')
  })

  it('shows the current encryption mode as read-only on the home screen', async () => {
    mockReadUserEncryptionSettings.mockResolvedValue({
      data: { mode: 'managed', salt: null },
      error: null,
    })

    const renderer = await renderHomeScreen()
    await act(async () => {
      await loadCurrentEncryptionMode()
    })

    const text = getTextContent(renderer.root)

    expect(text).toContain('Encryption mode')
    expect(text).toContain('Managed encryption')
    expect(text).toContain('This choice is read-only for now.')
  })
})
