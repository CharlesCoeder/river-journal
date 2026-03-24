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
    Button: passthrough('div'),
    Card: passthrough('section'),
    ScrollView,
    Separator: () => ReactModule.createElement('hr'),
    Text: passthrough('span'),
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

vi.mock('@tamagui/lucide-icons', () => ({
  ArrowLeft: () => React.createElement('span', null, 'ArrowLeft'),
}))

vi.mock('solito/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))

vi.mock('app/features/home/components/PrivacyTierExplainer', () => ({
  PrivacyTierExplainer: ({ selectedMode, onModeSelect, showLearnMore }: any) =>
    React.createElement('div', {
      'data-testid': 'privacy-tier-explainer',
      'data-selected-mode': selectedMode ?? 'none',
      'data-interactive': String(!!onModeSelect),
      'data-show-learn-more': String(showLearnMore ?? true),
    }),
}))

import { PrivacyCenterScreen } from '../PrivacyCenterScreen'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PrivacyCenterScreen', () => {
  describe('unauthenticated visitor', () => {
    it('renders correctly with no session', () => {
      mockIsAuthenticated.mockReturnValue(false)
      mockSyncEnabled.mockReturnValue(false)
      mockCurrentMode.mockReturnValue(null)

      render(React.createElement(PrivacyCenterScreen))

      expect(screen.getByTestId('privacy-center-screen')).toBeTruthy()
      expect(screen.getByText('Privacy Center')).toBeTruthy()
      expect(screen.getByText('How River Journal handles your data and encryption.')).toBeTruthy()
    })

    it('renders PrivacyTierExplainer without mode highlight', () => {
      mockIsAuthenticated.mockReturnValue(false)
      mockSyncEnabled.mockReturnValue(false)
      mockCurrentMode.mockReturnValue(null)

      render(React.createElement(PrivacyCenterScreen))

      const explainer = screen.getByTestId('privacy-tier-explainer')
      expect(explainer.getAttribute('data-selected-mode')).toBe('none')
      expect(explainer.getAttribute('data-interactive')).toBe('false')
      expect(explainer.getAttribute('data-show-learn-more')).toBe('false')
    })

    it('renders data handling section', () => {
      mockIsAuthenticated.mockReturnValue(false)
      mockSyncEnabled.mockReturnValue(false)
      mockCurrentMode.mockReturnValue(null)

      render(React.createElement(PrivacyCenterScreen))

      expect(screen.getByTestId('data-handling-section')).toBeTruthy()
      expect(screen.getByText('What we can and cannot access')).toBeTruthy()
      expect(screen.getByText('Local only (no sync)')).toBeTruthy()
    })

    it('renders retention and deletion policies', () => {
      mockIsAuthenticated.mockReturnValue(false)
      mockSyncEnabled.mockReturnValue(false)
      mockCurrentMode.mockReturnValue(null)

      render(React.createElement(PrivacyCenterScreen))

      expect(screen.getByText('Data retention and deletion')).toBeTruthy()
      expect(screen.getByText('Cloud data')).toBeTruthy()
      expect(screen.getByText('Account deletion')).toBeTruthy()
      expect(screen.getByText('Local data')).toBeTruthy()
    })
  })

  describe('authenticated modes', () => {
    it('highlights e2e mode when authenticated with e2e encryption and sync enabled', () => {
      mockIsAuthenticated.mockReturnValue(true)
      mockSyncEnabled.mockReturnValue(true)
      mockCurrentMode.mockReturnValue('e2e')

      render(React.createElement(PrivacyCenterScreen))

      const explainer = screen.getByTestId('privacy-tier-explainer')
      expect(explainer.getAttribute('data-selected-mode')).toBe('e2e')
    })

    it('highlights managed mode when authenticated with managed encryption and sync enabled', () => {
      mockIsAuthenticated.mockReturnValue(true)
      mockSyncEnabled.mockReturnValue(true)
      mockCurrentMode.mockReturnValue('managed')

      render(React.createElement(PrivacyCenterScreen))

      const explainer = screen.getByTestId('privacy-tier-explainer')
      expect(explainer.getAttribute('data-selected-mode')).toBe('managed')
    })

    it('does not highlight a mode when authenticated but sync is disabled (local-only)', () => {
      mockIsAuthenticated.mockReturnValue(true)
      mockSyncEnabled.mockReturnValue(false)
      mockCurrentMode.mockReturnValue(null)

      render(React.createElement(PrivacyCenterScreen))

      const explainer = screen.getByTestId('privacy-tier-explainer')
      expect(explainer.getAttribute('data-selected-mode')).toBe('none')
    })

    it('does not highlight a mode when authenticated with sync on but no encryption mode set', () => {
      mockIsAuthenticated.mockReturnValue(true)
      mockSyncEnabled.mockReturnValue(true)
      mockCurrentMode.mockReturnValue(null)

      render(React.createElement(PrivacyCenterScreen))

      const explainer = screen.getByTestId('privacy-tier-explainer')
      expect(explainer.getAttribute('data-selected-mode')).toBe('none')
    })
  })

  describe('no actionable controls', () => {
    it('does not render any buttons or destructive actions', () => {
      mockIsAuthenticated.mockReturnValue(true)
      mockSyncEnabled.mockReturnValue(true)
      mockCurrentMode.mockReturnValue('e2e')

      render(React.createElement(PrivacyCenterScreen))

      const buttons = screen.queryAllByRole('button')
      expect(buttons).toHaveLength(0)
    })
  })
})
