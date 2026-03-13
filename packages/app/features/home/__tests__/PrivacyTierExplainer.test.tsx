// @vitest-environment happy-dom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const { testID, onPress, children } = props
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

  const Card = ({ children, onPress, testID, ...props }: any) =>
    ReactModule.createElement(
      'section',
      {
        ...(testID ? { 'data-testid': testID } : {}),
        ...(onPress ? { onClick: onPress } : {}),
      },
      children
    )

  const AnimatePresence = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)

  return {
    AnimatePresence,
    Button,
    Card,
    Text: passthrough('span'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
  }
})

vi.mock('@tamagui/lucide-icons', () => ({
  Shield: (props: any) => React.createElement('svg', { 'data-testid': 'shield-icon' }),
  Lock: (props: any) => React.createElement('svg', { 'data-testid': 'lock-icon' }),
}))

import { PrivacyTierExplainer } from '../components/PrivacyTierExplainer'

afterEach(() => {
  cleanup()
})

describe('PrivacyTierExplainer', () => {
  it('renders both tier cards with correct content', () => {
    render(React.createElement(PrivacyTierExplainer, {}))

    expect(screen.getByText('Strict Privacy Mode')).toBeTruthy()
    expect(screen.getByText('Cloud Backup Mode')).toBeTruthy()
    expect(screen.getByText('You hold the only key to unlock your journal')).toBeTruthy()
    expect(screen.getByText('We securely handle the encryption behind the scenes')).toBeTruthy()
  })

  it('highlights the selected mode card', () => {
    render(React.createElement(PrivacyTierExplainer, { selectedMode: 'e2e' }))

    const e2eCard = screen.getByTestId('privacy-tier-e2e')
    const managedCard = screen.getByTestId('privacy-tier-managed')
    expect(e2eCard).toBeTruthy()
    expect(managedCard).toBeTruthy()
  })

  it('renders without highlight when selectedMode is null', () => {
    render(React.createElement(PrivacyTierExplainer, { selectedMode: null }))

    const e2eCard = screen.getByTestId('privacy-tier-e2e')
    const managedCard = screen.getByTestId('privacy-tier-managed')
    expect(e2eCard).toBeTruthy()
    expect(managedCard).toBeTruthy()
  })

  it('calls onModeSelect when a tier card is pressed', () => {
    const onModeSelect = vi.fn()
    render(
      React.createElement(PrivacyTierExplainer, {
        selectedMode: 'e2e',
        onModeSelect,
      })
    )

    fireEvent.click(screen.getByTestId('privacy-tier-managed'))
    expect(onModeSelect).toHaveBeenCalledWith('managed')
  })

  it('does not fire onModeSelect when prop is undefined (non-interactive)', () => {
    render(React.createElement(PrivacyTierExplainer, { selectedMode: 'e2e' }))

    // Cards render but have no click handler when onModeSelect is undefined
    const managedCard = screen.getByTestId('privacy-tier-managed')
    fireEvent.click(managedCard)
    // No error — the card simply doesn't respond
  })

  it('expands and collapses Learn More section', () => {
    render(React.createElement(PrivacyTierExplainer, {}))

    // Initially collapsed
    expect(screen.queryByText('How your data is handled')).toBeNull()

    // Expand
    fireEvent.click(screen.getByTestId('learn-more-toggle'))
    expect(screen.getByText('How your data is handled')).toBeTruthy()
    expect(screen.getByText('Show less')).toBeTruthy()

    // Collapse
    fireEvent.click(screen.getByTestId('learn-more-toggle'))
    expect(screen.queryByText('How your data is handled')).toBeNull()
    expect(screen.getByText('Learn more')).toBeTruthy()
  })

  it('shows detailed privacy explanations when Learn More is expanded', () => {
    render(React.createElement(PrivacyTierExplainer, {}))

    fireEvent.click(screen.getByTestId('learn-more-toggle'))

    expect(screen.getByText('Local only (no sync)')).toBeTruthy()
    expect(
      screen.getByText(
        'Your journal stays entirely on this device. Nothing is ever sent to our servers.'
      )
    ).toBeTruthy()
    expect(
      screen.getByText('In both sync modes')
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Metadata (word counts, timestamps) is not encrypted and is visible to us. Only journal entry content is encrypted.'
      )
    ).toBeTruthy()
  })

  it('hides Learn More when showLearnMore is false', () => {
    render(React.createElement(PrivacyTierExplainer, { showLearnMore: false }))

    expect(screen.queryByTestId('learn-more-toggle')).toBeNull()
  })

  it('renders Privacy Center link only when privacyCenterLink prop is provided', () => {
    // Without prop
    const { unmount } = render(React.createElement(PrivacyTierExplainer, {}))
    fireEvent.click(screen.getByTestId('learn-more-toggle'))
    expect(screen.queryByTestId('privacy-center-link')).toBeNull()
    unmount()

    // With prop
    const handler = vi.fn()
    render(React.createElement(PrivacyTierExplainer, { privacyCenterLink: handler }))
    fireEvent.click(screen.getByTestId('learn-more-toggle'))
    const link = screen.getByTestId('privacy-center-link')
    expect(link).toBeTruthy()

    fireEvent.click(link)
    expect(handler).toHaveBeenCalled()
  })
})
