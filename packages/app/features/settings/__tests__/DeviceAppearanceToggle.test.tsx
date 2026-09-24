// @vitest-environment happy-dom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

let mockIsAuthenticated = true
let mockAppearanceScope: 'account' | 'device' | undefined

vi.mock('@legendapp/state/react', () => ({
  use$: (obs: any) =>
    obs && typeof obs === 'object' && typeof obs.get === 'function' ? obs.get() : obs,
}))

vi.mock('app/state/store', () => ({
  store$: {
    session: {
      get isAuthenticated() {
        return { get: () => mockIsAuthenticated }
      },
    },
    profile: {
      get appearanceScope() {
        return { get: () => mockAppearanceScope }
      },
    },
  },
}))

const setAppearanceScopeMock = vi.fn()
vi.mock('app/state/preferencesSync', () => ({
  setAppearanceScope: (scope: string) => setAppearanceScopeMock(scope),
}))

vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')
  const Text = ({ children }: any) => ReactModule.createElement('span', null, children)
  const Stack = ({ children }: any) => ReactModule.createElement('div', null, children)
  const ExpandingLineButton = ({ children, onPress, ...rest }: any) =>
    ReactModule.createElement(
      'button',
      {
        onClick: onPress,
        role: rest.accessibilityRole,
        'aria-checked': rest.accessibilityState?.checked,
        'aria-label': rest.accessibilityLabel,
      },
      children
    )
  return { Text, XStack: Stack, YStack: Stack, ExpandingLineButton }
})

import { DeviceAppearanceToggle } from '../components/DeviceAppearanceToggle'

const NAME = 'Keep this look on this device only'

beforeEach(() => {
  mockIsAuthenticated = true
  mockAppearanceScope = undefined
  setAppearanceScopeMock.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('DeviceAppearanceToggle', () => {
  it('renders nothing when signed out', () => {
    mockIsAuthenticated = false
    const { container } = render(<DeviceAppearanceToggle />)
    expect(container.innerHTML).toBe('')
  })

  it('defaults to off (following the account) and turns device-only on', () => {
    render(<DeviceAppearanceToggle />)
    const toggle = screen.getByRole('switch', { name: NAME, checked: false })
    expect(screen.getByText(/follow your account across devices/)).toBeTruthy()

    fireEvent.click(toggle)

    expect(setAppearanceScopeMock).toHaveBeenCalledWith('device')
  })

  it('when on, turning it off returns to the account’s look', () => {
    mockAppearanceScope = 'device'
    render(<DeviceAppearanceToggle />)
    const toggle = screen.getByRole('switch', { name: NAME, checked: true })
    expect(screen.getByText(/stay on this device/)).toBeTruthy()

    fireEvent.click(toggle)

    expect(setAppearanceScopeMock).toHaveBeenCalledWith('account')
  })
})
