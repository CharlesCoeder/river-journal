// @vitest-environment happy-dom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSetHotkeyOverride = vi.fn()
const mockResetHotkeyOverride = vi.fn()
const mockStartRecording = vi.fn()
const mockStopRecording = vi.fn()
const mockCancelRecording = vi.fn()
const mockOverrides = vi.fn<[], Record<string, string | undefined>>(() => ({}))

// Capture the latest options passed to useHotkeyRecorder so tests can drive
// onRecord / onCancel callbacks.
let capturedRecorderOptions: {
  onRecord?: (hotkey: string) => void
  onCancel?: () => void
} | null = null

vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const { testID, onPress } = props as { testID?: string; onPress?: () => void }
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
    if (obs$ === '__mock_profile') return { hotkeyOverrides: mockOverrides() }
    return undefined
  },
}))

vi.mock('app/state/store', () => ({
  store$: { profile: '__mock_profile' },
  setHotkeyOverride: (...args: unknown[]) => mockSetHotkeyOverride(...args),
  resetHotkeyOverride: (...args: unknown[]) => mockResetHotkeyOverride(...args),
}))

vi.mock('app/features/navigation/useKeyboardShortcuts', () => ({
  DEFAULT_HOTKEYS: { newEntry: 'Mod+N', openSettings: 'Mod+,', exitEditor: 'Escape' },
}))

vi.mock('@tanstack/react-hotkeys', () => ({
  useHotkeyRecorder: (opts: any) => {
    capturedRecorderOptions = opts
    return {
      isRecording: false,
      recordedHotkey: null,
      startRecording: mockStartRecording,
      stopRecording: mockStopRecording,
      cancelRecording: mockCancelRecording,
    }
  },
}))

import {
  KeyboardShortcutsSection,
  formatHotkeyDisplay,
} from '../components/KeyboardShortcutsSection'

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockOverrides.mockReturnValue({})
  capturedRecorderOptions = null
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// formatHotkeyDisplay (pure function)
// ---------------------------------------------------------------------------

describe('formatHotkeyDisplay', () => {
  const originalNavigator = globalThis.navigator

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
    })
  })

  function setPlatform(platform: string) {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform },
      configurable: true,
    })
  }

  it('renders Mod+N as ⌘N on Mac', () => {
    setPlatform('MacIntel')
    expect(formatHotkeyDisplay('Mod+N')).toBe('⌘N')
  })

  it('renders Mod+N as Ctrl+N on non-Mac', () => {
    setPlatform('Win32')
    expect(formatHotkeyDisplay('Mod+N')).toBe('Ctrl+N')
  })

  it('renders Mod+, as ⌘, on Mac', () => {
    setPlatform('MacIntel')
    expect(formatHotkeyDisplay('Mod+,')).toBe('⌘,')
  })

  it('renders Mod+, as Ctrl+, on non-Mac', () => {
    setPlatform('Win32')
    expect(formatHotkeyDisplay('Mod+,')).toBe('Ctrl+,')
  })

  it('renders Escape as Esc', () => {
    expect(formatHotkeyDisplay('Escape')).toBe('Esc')
  })
})

// ---------------------------------------------------------------------------
// Component — visibility & three rows
// ---------------------------------------------------------------------------

describe('KeyboardShortcutsSection — section content', () => {
  it('renders without crashing', () => {
    expect(() => render(<KeyboardShortcutsSection />)).not.toThrow()
  })

  it('lists rows for the three rebindable actions', () => {
    render(<KeyboardShortcutsSection />)
    expect(screen.getByText('New Entry')).toBeTruthy()
    expect(screen.getByText('Open Settings')).toBeTruthy()
    expect(screen.getByText('Exit Editor')).toBeTruthy()
  })

  it('shows the current default binding chip text for each row when no overrides exist', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32' },
      configurable: true,
    })
    render(<KeyboardShortcutsSection />)
    // Defaults: Mod+N → Ctrl+N, Mod+, → Ctrl+,, Escape → Esc
    expect(screen.getByText('Ctrl+N')).toBeTruthy()
    expect(screen.getByText('Ctrl+,')).toBeTruthy()
    expect(screen.getByText('Esc')).toBeTruthy()
  })

  it('shows the override binding instead of the default when one is stored', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32' },
      configurable: true,
    })
    mockOverrides.mockReturnValue({ newEntry: 'Mod+E' })
    render(<KeyboardShortcutsSection />)
    expect(screen.getByText('Ctrl+E')).toBeTruthy()
    // Default chip text should no longer be present for the overridden row.
    expect(screen.queryByText('Ctrl+N')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Reset affordance visibility
// ---------------------------------------------------------------------------

describe('KeyboardShortcutsSection — reset affordance', () => {
  it('does NOT render any (reset) link when all bindings match defaults', () => {
    render(<KeyboardShortcutsSection />)
    expect(screen.queryAllByText('(reset)')).toHaveLength(0)
  })

  it('renders a (reset) link when an override differs from the default', () => {
    mockOverrides.mockReturnValue({ newEntry: 'Mod+E' })
    render(<KeyboardShortcutsSection />)
    expect(screen.getAllByText('(reset)').length).toBeGreaterThanOrEqual(1)
  })

  it('hides the (reset) link when the override equals the default value', () => {
    mockOverrides.mockReturnValue({ newEntry: 'Mod+N' })
    render(<KeyboardShortcutsSection />)
    expect(screen.queryAllByText('(reset)')).toHaveLength(0)
  })

  it('clicking (reset) calls resetHotkeyOverride for the right action id', () => {
    mockOverrides.mockReturnValue({ openSettings: 'Mod+;' })
    render(<KeyboardShortcutsSection />)
    fireEvent.click(screen.getByText('(reset)'))
    expect(mockResetHotkeyOverride).toHaveBeenCalledWith('openSettings')
  })
})

// ---------------------------------------------------------------------------
// Recording mode
// ---------------------------------------------------------------------------

describe('KeyboardShortcutsSection — recording mode', () => {
  it('clicking a binding chip starts recording for that row', () => {
    render(<KeyboardShortcutsSection />)
    // Click the New Entry chip (default Mod+N → ⌘N or Ctrl+N depending on platform).
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32' },
      configurable: true,
    })
    cleanup()
    render(<KeyboardShortcutsSection />)
    fireEvent.click(screen.getByText('Ctrl+N'))
    expect(mockStartRecording).toHaveBeenCalled()
  })

  it('shows "Press a key…" placeholder while a row is recording', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32' },
      configurable: true,
    })
    render(<KeyboardShortcutsSection />)
    fireEvent.click(screen.getByText('Ctrl+N'))
    expect(screen.getByText(/press a key/i)).toBeTruthy()
  })

  it('renders a × cancel control while recording, and clicking it cancels recording', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32' },
      configurable: true,
    })
    render(<KeyboardShortcutsSection />)
    fireEvent.click(screen.getByText('Ctrl+N'))
    const cancelButton = screen.getByText('×')
    fireEvent.click(cancelButton)
    expect(mockCancelRecording).toHaveBeenCalled()
  })

  it('exits recording mode when the × cancel button is clicked', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32' },
      configurable: true,
    })
    render(<KeyboardShortcutsSection />)
    fireEvent.click(screen.getByText('Ctrl+N'))
    expect(screen.getByText(/press a key/i)).toBeTruthy()
    fireEvent.click(screen.getByText('×'))
    expect(screen.queryByText(/press a key/i)).toBeNull()
  })

  it('only one row can be in recording mode at a time', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32' },
      configurable: true,
    })
    render(<KeyboardShortcutsSection />)
    fireEvent.click(screen.getByText('Ctrl+N'))
    // Exactly one placeholder visible, not three.
    expect(screen.getAllByText(/press a key/i)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Save flow — recorder onRecord callback wired through to setHotkeyOverride
// ---------------------------------------------------------------------------

describe('KeyboardShortcutsSection — save on key press', () => {
  it('saves the recorded chord for the active row via setHotkeyOverride', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32' },
      configurable: true,
    })
    render(<KeyboardShortcutsSection />)

    // Enter recording for "Open Settings" (default chip = Ctrl+,).
    fireEvent.click(screen.getByText('Ctrl+,'))

    // Drive the recorder callback as if the user pressed a key.
    expect(capturedRecorderOptions?.onRecord).toBeTypeOf('function')
    capturedRecorderOptions?.onRecord?.('Mod+;')

    expect(mockSetHotkeyOverride).toHaveBeenCalledWith('openSettings', 'Mod+;')
  })

  it('exits recording mode after a successful save', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32' },
      configurable: true,
    })
    const { rerender } = render(<KeyboardShortcutsSection />)
    fireEvent.click(screen.getByText('Ctrl+N'))
    expect(screen.getByText(/press a key/i)).toBeTruthy()

    capturedRecorderOptions?.onRecord?.('Mod+E')
    rerender(<KeyboardShortcutsSection />)

    expect(screen.queryByText(/press a key/i)).toBeNull()
  })

  it('exits recording mode when the recorder fires onCancel (Esc cancels)', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32' },
      configurable: true,
    })
    const { rerender } = render(<KeyboardShortcutsSection />)
    fireEvent.click(screen.getByText('Ctrl+N'))
    expect(screen.getByText(/press a key/i)).toBeTruthy()

    capturedRecorderOptions?.onCancel?.()
    rerender(<KeyboardShortcutsSection />)

    expect(screen.queryByText(/press a key/i)).toBeNull()
    expect(mockSetHotkeyOverride).not.toHaveBeenCalled()
  })
})
