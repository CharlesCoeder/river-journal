// @vitest-environment happy-dom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// --- Mocks ---

const mockSetTheme = vi.fn()
const mockThemeName = vi.fn(() => 'ink')

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

  return {
    Circle: passthrough('div'),
    Text: passthrough('span'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
    View: passthrough('div'),
  }
})

vi.mock('@legendapp/state/react', () => ({
  use$: (obs$: any) => {
    if (obs$ === '__mock_themeName') return mockThemeName()
    return undefined
  },
}))

vi.mock('app/state/store', () => ({
  store$: {
    profile: {
      themeName: '__mock_themeName',
    },
  },
  setTheme: (...args: unknown[]) => mockSetTheme(...args),
}))

vi.mock('app/state/types', () => ({
  THEME_NAMES: ['ink', 'night', 'forest-morning', 'forest-night', 'leather', 'fireside'],
  LIGHT_THEMES: ['ink', 'forest-morning', 'leather'],
  DARK_THEMES: ['night', 'forest-night', 'fireside'],
}))

vi.mock('@my/config/src/themes', () => ({
  THEME_DEFS: {
    ink: { bg: '#F9F6F0', text: '#2C2A28', stone: '#8A8680', isDark: false },
    night: { bg: '#1C1A18', text: '#E6E2DA', stone: '#8C8B85', isDark: true },
    'forest-morning': { bg: '#E8EDE4', text: '#2B3A30', stone: '#819183', isDark: false },
    'forest-night': { bg: '#1A221C', text: '#DCE3DD', stone: '#788C7D', isDark: true },
    leather: { bg: '#F0E7DA', text: '#4A3525', stone: '#9C8B81', isDark: false },
    fireside: { bg: '#2B1D14', text: '#E6DACB', stone: '#8A786B', isDark: true },
  },
}))

import { ThemePicker } from '../components/ThemePicker'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ThemePicker', () => {
  it('renders all 6 theme options', () => {
    mockThemeName.mockReturnValue('ink')
    render(<ThemePicker />)
    const nonSelected = ['night', 'forest-morning', 'forest-night', 'leather', 'fireside']
    for (const name of nonSelected) {
      expect(screen.getByTestId(`theme-option-${name}`)).toBeTruthy()
    }
    expect(screen.getByTestId('theme-option-ink-selected')).toBeTruthy()
  })

  it('renders the theme labels', () => {
    render(<ThemePicker />)
    expect(screen.getByText('Ink & Paper')).toBeTruthy()
    expect(screen.getByText('Night Study')).toBeTruthy()
    expect(screen.getByText('Forest Morning')).toBeTruthy()
    expect(screen.getByText('Forest Night')).toBeTruthy()
    expect(screen.getByText('Worn Leather')).toBeTruthy()
    expect(screen.getByText('Fireside')).toBeTruthy()
  })

  it('highlights the currently selected theme', () => {
    mockThemeName.mockReturnValue('night')
    render(<ThemePicker />)
    expect(screen.getByTestId('theme-option-night-selected')).toBeTruthy()
  })

  it('calls setTheme when a theme option is tapped', () => {
    mockThemeName.mockReturnValue('ink')
    render(<ThemePicker />)
    fireEvent.click(screen.getByTestId('theme-option-night'))
    expect(mockSetTheme).toHaveBeenCalledWith('night')
  })
})
