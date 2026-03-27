// @vitest-environment happy-dom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// --- Mocks ---

const mockCurrentMode = vi.fn(() => null)
const mockSyncEnabled = vi.fn(() => false)
const mockIsAuthenticated = vi.fn(() => false)

vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const { testID, onPress } = props
    return {
      ...(testID ? { 'data-testid': testID } : {}),
      ...(onPress ? { onClick: onPress } : {}),
    }
  }

  const passthrough = (tagName: keyof HTMLElementTagNameMap) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(tagName, mapProps(props), children)
    Component.displayName = tagName
    return Component
  }

  const ScrollView = ({ children, ...props }: any) =>
    ReactModule.createElement('div', mapProps(props), children)

  return {
    ScrollView,
    Text: passthrough('span'),
    View: passthrough('div'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
  }
})

vi.mock('@legendapp/state/react', () => ({
  use$: (obs$: any) => {
    if (obs$ === '__mock_isAuthenticated') return mockIsAuthenticated()
    if (obs$ === '__mock_syncEnabled') return mockSyncEnabled()
    if (obs$ === '__mock_currentMode') return mockCurrentMode()
    return undefined
  },
}))

vi.mock('app/state/store', () => ({
  store$: {
    session: {
      isAuthenticated: '__mock_isAuthenticated',
      syncEnabled: '__mock_syncEnabled',
    },
  },
}))

vi.mock('app/state/encryptionSetup', () => ({
  encryptionSetup$: {
    currentMode: '__mock_currentMode',
  },
}))

vi.mock('solito/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))

import { PrivacyCenterScreen } from '../PrivacyCenterScreen'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PrivacyCenterScreen', () => {
  describe('renders all content sections', () => {
    it('renders header and description', () => {
      render(React.createElement(PrivacyCenterScreen))

      expect(screen.getByTestId('privacy-center-screen')).toBeTruthy()
      expect(screen.getByText('Privacy Center')).toBeTruthy()
      expect(screen.getByText('How River Journal handles your data and encryption.')).toBeTruthy()
    })

    it('renders privacy mode cards', () => {
      render(React.createElement(PrivacyCenterScreen))

      expect(screen.getAllByText('Strict Privacy Mode').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Cloud Backup Mode').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('You hold the only key to unlock your journal.')).toBeTruthy()
      expect(screen.getByText('We securely handle the encryption behind the scenes.')).toBeTruthy()
    })

    it('renders what we can and cannot access section', () => {
      render(React.createElement(PrivacyCenterScreen))

      expect(screen.getByText('What We Can & Cannot Access')).toBeTruthy()
      expect(screen.getByText('Local Only (No Sync)')).toBeTruthy()
      expect(screen.getByText('Synced Metadata')).toBeTruthy()
    })

    it('renders retention and deletion section', () => {
      render(React.createElement(PrivacyCenterScreen))

      expect(screen.getByText('Data Retention & Deletion')).toBeTruthy()
      expect(screen.getByText('Cloud Data')).toBeTruthy()
      expect(screen.getByText('Account Deletion')).toBeTruthy()
      expect(screen.getByText('Local Data')).toBeTruthy()
    })
  })
})
