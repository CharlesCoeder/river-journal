// @vitest-environment happy-dom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// --- Mocks ---

const mockSetCustomTheme = vi.fn()
const mockClearCustomTheme = vi.fn()
const mockCustomTheme = vi.fn(() => null)
const mockThemeName = vi.fn(() => 'ink')
const mockOnClose = vi.fn()

vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const { testID, onPress, onChangeText, disabled, ...rest } = props as any
    return {
      ...(testID ? { 'data-testid': testID } : {}),
      ...(onPress ? { onClick: onPress } : {}),
      ...(onChangeText
        ? { onChange: (e: any) => onChangeText(e.target.value) }
        : {}),
      ...(disabled ? { disabled } : {}),
    }
  }

  const passthrough = (tagName: keyof HTMLElementTagNameMap) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(tagName, mapProps(props), children)
    Component.displayName = tagName
    return Component
  }

  return {
    Button: passthrough('button'),
    Input: ({ testID, value, onChangeText, ...rest }: any) =>
      ReactModule.createElement('input', {
        'data-testid': testID,
        value,
        onChange: (e: any) => onChangeText?.(e.target.value),
      }),
    Text: passthrough('span'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
    View: passthrough('div'),
    Circle: passthrough('div'),
  }
})

vi.mock('@legendapp/state/react', () => ({
  use$: (obs$: any) => {
    if (obs$ === '__mock_customTheme') return mockCustomTheme()
    if (obs$ === '__mock_themeName') return mockThemeName()
    return undefined
  },
}))

vi.mock('app/state/store', () => ({
  store$: {
    profile: {
      customTheme: '__mock_customTheme',
      themeName: '__mock_themeName',
    },
  },
  setCustomTheme: (...args: unknown[]) => mockSetCustomTheme(...args),
  clearCustomTheme: (...args: unknown[]) => mockClearCustomTheme(...args),
}))

vi.mock('app/state/types', () => ({
  DEFAULT_THEME: 'ink',
}))

vi.mock('@my/config/src/themes', () => ({
  hexToRgb: (hex: string): [number, number, number] => {
    const n = Number.parseInt(hex.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  },
  THEME_DEFS: {
    ink: { bg: '#F9F6F0', text: '#2C2A28', stone: '#8A8680', isDark: false },
    night: { bg: '#1C1A18', text: '#E6E2DA', stone: '#8C8B85', isDark: true },
    'forest-morning': { bg: '#E8EDE4', text: '#2B3A30', stone: '#819183', isDark: false },
    'forest-night': { bg: '#1A221C', text: '#DCE3DD', stone: '#788C7D', isDark: true },
    leather: { bg: '#F0E7DA', text: '#4A3525', stone: '#9C8B81', isDark: false },
    fireside: { bg: '#2B1D14', text: '#E6DACB', stone: '#8A786B', isDark: true },
  },
}))

import { CustomThemeEditor } from '../components/CustomThemeEditor'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CustomThemeEditor', () => {
  it('renders three color inputs', () => {
    render(<CustomThemeEditor onClose={mockOnClose} />)
    expect(screen.getByTestId('color-input-background')).toBeTruthy()
    expect(screen.getByTestId('color-input-text')).toBeTruthy()
    expect(screen.getByTestId('color-input-stone')).toBeTruthy()
  })

  it('shows live preview when all colors are valid', () => {
    render(<CustomThemeEditor onClose={mockOnClose} />)
    expect(screen.getByTestId('custom-theme-preview')).toBeTruthy()
  })

  it('shows contrast warning for low-contrast colors', () => {
    render(<CustomThemeEditor onClose={mockOnClose} />)
    // Change text to a similar color as default bg (#F9F6F0)
    const textInput = screen.getByTestId('color-input-text')
    fireEvent.change(textInput, { target: { value: '#E8E5E0' } })
    expect(screen.getByTestId('contrast-warning')).toBeTruthy()
  })

  it('does not show contrast warning for high-contrast colors', () => {
    render(<CustomThemeEditor onClose={mockOnClose} />)
    // Default values (#F9F6F0 bg, #2C2A28 text) have high contrast
    expect(screen.queryByTestId('contrast-warning')).toBeNull()
  })

  it('calls setCustomTheme and onClose on save', () => {
    render(<CustomThemeEditor onClose={mockOnClose} />)
    fireEvent.click(screen.getByTestId('save-custom-theme'))
    expect(mockSetCustomTheme).toHaveBeenCalledWith({
      bg: '#F9F6F0',
      text: '#2C2A28',
      stone: '#8A8680',
    })
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('shows delete button when custom theme exists', () => {
    mockCustomTheme.mockReturnValue({ bg: '#F9F6F0', text: '#2C2A28', stone: '#8A8680' })
    render(<CustomThemeEditor onClose={mockOnClose} />)
    expect(screen.getByTestId('delete-custom-theme')).toBeTruthy()
  })

  it('does not show delete button when no custom theme exists', () => {
    mockCustomTheme.mockReturnValue(null)
    render(<CustomThemeEditor onClose={mockOnClose} />)
    expect(screen.queryByTestId('delete-custom-theme')).toBeNull()
  })

  it('calls clearCustomTheme and onClose on delete', () => {
    mockCustomTheme.mockReturnValue({ bg: '#F9F6F0', text: '#2C2A28', stone: '#8A8680' })
    render(<CustomThemeEditor onClose={mockOnClose} />)
    fireEvent.click(screen.getByTestId('delete-custom-theme'))
    expect(mockClearCustomTheme).toHaveBeenCalled()
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('calls onClose on cancel', () => {
    render(<CustomThemeEditor onClose={mockOnClose} />)
    fireEvent.click(screen.getByTestId('cancel-custom-theme'))
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('pre-populates with existing custom theme colors', () => {
    mockCustomTheme.mockReturnValue({ bg: '#112233', text: '#AABBCC', stone: '#667788' })
    render(<CustomThemeEditor onClose={mockOnClose} />)
    expect(screen.getByTestId('color-input-background')).toHaveProperty('value', '#112233')
    expect(screen.getByTestId('color-input-text')).toHaveProperty('value', '#AABBCC')
    expect(screen.getByTestId('color-input-stone')).toHaveProperty('value', '#667788')
  })
})
