// @vitest-environment happy-dom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// --- Mocks ---

const mockSetFontPairing = vi.fn()
const mockFontPairing = vi.fn(() => 'outfit-newsreader')

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
    Text: passthrough('span'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
    View: passthrough('div'),
    isWeb: true,
  }
})

vi.mock('@legendapp/state/react', () => ({
  use$: (obs$: any) => {
    if (obs$ === '__mock_fontPairing') return mockFontPairing()
    return undefined
  },
}))

vi.mock('app/state/store', () => ({
  store$: {
    profile: {
      fontPairing: '__mock_fontPairing',
    },
  },
  setFontPairing: (...args: unknown[]) => mockSetFontPairing(...args),
}))

vi.mock('app/state/types', () => ({
  FONT_PAIRING_IDS: ['outfit-newsreader', 'lato-lora', 'inter-source-serif'],
  DEFAULT_FONT_PAIRING: 'outfit-newsreader',
}))

import { FontPicker } from '../components/FontPicker'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FontPicker', () => {
  it('renders all 3 font pairing options', () => {
    render(<FontPicker />)
    expect(screen.getByTestId('font-pairing-outfit-newsreader-selected')).toBeTruthy()
    expect(screen.getByTestId('font-pairing-lato-lora')).toBeTruthy()
    expect(screen.getByTestId('font-pairing-inter-source-serif')).toBeTruthy()
  })

  it('renders font names as labels', () => {
    render(<FontPicker />)
    expect(screen.getByText('Outfit')).toBeTruthy()
    expect(screen.getByText('Newsreader')).toBeTruthy()
    expect(screen.getByText('Lato')).toBeTruthy()
    expect(screen.getByText('Lora')).toBeTruthy()
    expect(screen.getByText('Inter')).toBeTruthy()
    expect(screen.getByText('Source Serif 4')).toBeTruthy()
  })

  it('highlights the currently selected pairing', () => {
    mockFontPairing.mockReturnValue('lato-lora')
    render(<FontPicker />)
    expect(screen.getByTestId('font-pairing-lato-lora-selected')).toBeTruthy()
    expect(screen.getByTestId('font-pairing-outfit-newsreader')).toBeTruthy()
  })

  it('calls setFontPairing when a pairing is tapped', () => {
    mockFontPairing.mockReturnValue('outfit-newsreader')
    render(<FontPicker />)
    fireEvent.click(screen.getByTestId('font-pairing-lato-lora'))
    expect(mockSetFontPairing).toHaveBeenCalledWith('lato-lora')
  })

  it('calls setFontPairing with inter-source-serif', () => {
    render(<FontPicker />)
    fireEvent.click(screen.getByTestId('font-pairing-inter-source-serif'))
    expect(mockSetFontPairing).toHaveBeenCalledWith('inter-source-serif')
  })
})
