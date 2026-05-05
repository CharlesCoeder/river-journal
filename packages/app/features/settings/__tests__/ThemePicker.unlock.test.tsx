// @vitest-environment happy-dom
/**
 * ThemePicker unlock surface tests — user-chosen unlock tokens (Model B).
 *
 * Tests lock-state rendering, token-spend confirm strip, paid-tier bypass,
 * and "Unlock everything now" affordance.
 *
 * Separate file from ThemePicker.test.tsx to keep the unlock-surface diff scoped.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// --- Mocks ---

const mockSetTheme = vi.fn()
const mockSpendUnlockToken = vi.fn()
const mockRouterPush = vi.fn()

// Mutable streak state for tests to override
let mockStreakState = {
  currentStreak: 0,
  longestStreak: 0,
  unlockTokensEarned: 0,
  unlockedThemes: [] as string[],
  nextUnlockMilestone: 7 as number | null,
  lastQualifyingDate: null as string | null,
}

// Mutable profile state for tests to override
let mockThemeName = 'ink'
let mockUnlockedThemes: string[] = []
let mockCustomTheme: null | object = null

// Mock @my/ui with passthrough components
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const mapped: Record<string, unknown> = {}
    if (props.testID) mapped['data-testid'] = props.testID
    if (props.onPress) mapped['onClick'] = props.onPress
    if (props.children) mapped['children'] = props.children
    if (props['aria-label']) mapped['aria-label'] = props['aria-label']
    if (props.role) mapped['role'] = props.role
    return mapped
  }

  const passthrough = (tagName: keyof HTMLElementTagNameMap) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(tagName, mapProps(props), children)
    Component.displayName = tagName
    return Component
  }

  const ExpandingLineButton = ({ children, onPress }: any) =>
    ReactModule.createElement('button', { onClick: onPress }, children)
  ExpandingLineButton.displayName = 'ExpandingLineButton'

  return {
    Circle: passthrough('div'),
    Text: passthrough('span'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
    View: passthrough('div'),
    ExpandingLineButton,
    isWeb: true,
  }
})

// Mock @legendapp/state/react — use$() reads observable.get() synchronously
vi.mock('@legendapp/state/react', () => ({
  use$: (obs: any) => {
    if (obs && typeof obs.get === 'function') return obs.get()
    return obs
  },
}))

// Mock solito/navigation
vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

// Mock app/state/store — expose mutable mock state
vi.mock('app/state/store', () => ({
  store$: {
    profile: {
      themeName: { get: () => mockThemeName },
      customTheme: { get: () => mockCustomTheme },
      unlockedThemes: { get: () => mockUnlockedThemes },
    },
    views: {
      streak: { get: () => mockStreakState },
    },
  },
  setTheme: (...args: unknown[]) => mockSetTheme(...args),
  spendUnlockToken: (...args: unknown[]) => mockSpendUnlockToken(...args),
}))

// Mock app/state/streak — expose useUnlockedThemes and getThemePickerTier seam
let mockTier = 'free'

vi.mock('app/state/streak', () => ({
  useUnlockedThemes: (tier: string) => {
    if (tier === 'paid_monthly' || tier === 'paid_yearly') {
      return ['ink', 'night', 'forest-morning', 'forest-night', 'leather', 'fireside']
    }
    return mockUnlockedThemes
  },
  getThemePickerTier: () => mockTier as any,
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

// CustomThemeEditor stub
vi.mock('../components/CustomThemeEditor', () => ({
  CustomThemeEditor: () => null,
}))

import { ThemePicker } from '../components/ThemePicker'

// Non-default lockable themes
const LOCKABLE_THEMES = ['forest-morning', 'leather', 'forest-night', 'fireside']

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  // Reset to default free-tier state
  mockTier = 'free'
  mockThemeName = 'ink'
  mockCustomTheme = null
  mockUnlockedThemes = []
  mockStreakState = {
    currentStreak: 0,
    longestStreak: 0,
    unlockTokensEarned: 0,
    unlockedThemes: [],
    nextUnlockMilestone: 7,
    lastQualifyingDate: null,
  }
})

// ==========================================================================
// Locked-state rendering (free tier)
// ==========================================================================

describe('locked-state rendering on free tier', () => {
  it('shows token-spend affordance text when a token is available', () => {
    // fixture: tier='free', unlockTokensEarned=1, unlockedThemes=[]
    mockStreakState = { ...mockStreakState, unlockTokensEarned: 1, longestStreak: 7 }
    mockUnlockedThemes = []

    render(<ThemePicker />)

    // Non-default lockable themes should show "1 token to unlock"
    for (const name of LOCKABLE_THEMES) {
      const affordance = screen.getByTestId(`lock-affordance-${name}`)
      expect(affordance.textContent).toBe('1 token to unlock')
    }
  })

  it('shows day-until-next-milestone microcopy when zero tokens available', () => {
    // fixture: tier='free', unlockTokensEarned=0, nextUnlockMilestone=7, unlockedThemes=[]
    mockStreakState = { ...mockStreakState, unlockTokensEarned: 0, nextUnlockMilestone: 7 }
    mockUnlockedThemes = []

    render(<ThemePicker />)

    for (const name of LOCKABLE_THEMES) {
      const affordance = screen.getByTestId(`lock-affordance-${name}`)
      expect(affordance.textContent).toBe('Day 7 to unlock another')
    }

    // Should NOT show "1 token to unlock"
    expect(screen.queryByText('1 token to unlock')).toBeNull()
  })

  it('shows no locked affordances when all themes unlocked', () => {
    // fixture: all 4 lockable themes already in unlockedThemes, 4 tokens earned
    mockStreakState = {
      ...mockStreakState,
      unlockTokensEarned: 4,
      longestStreak: 180,
      nextUnlockMilestone: null,
    }
    mockUnlockedThemes = ['forest-morning', 'leather', 'forest-night', 'fireside']

    render(<ThemePicker />)

    // No lock affordance for any theme
    for (const name of LOCKABLE_THEMES) {
      expect(screen.queryByTestId(`lock-affordance-${name}`)).toBeNull()
    }
  })

  it('never shows locked affordances on default themes', () => {
    // fixture: same as L2 — zero tokens
    mockStreakState = { ...mockStreakState, unlockTokensEarned: 0, nextUnlockMilestone: 7 }
    mockUnlockedThemes = []

    render(<ThemePicker />)

    // Default themes should NOT have lock affordances
    expect(screen.queryByTestId('lock-affordance-ink')).toBeNull()
    expect(screen.queryByTestId('lock-affordance-night')).toBeNull()
  })
})

// ==========================================================================
// Token-spend confirm strip
// ==========================================================================

describe('token-spend confirm strip', () => {
  it('shows confirm strip when tapping locked theme with tokens', () => {
    mockStreakState = { ...mockStreakState, unlockTokensEarned: 1, longestStreak: 7 }
    mockUnlockedThemes = []

    render(<ThemePicker />)

    // Tap forest-morning lock affordance row
    const themeRow = screen.getByTestId('theme-option-forest-morning')
    fireEvent.click(themeRow)

    // Confirm strip should appear
    expect(screen.getByText('Unlock Forest Morning?')).toBeTruthy()
    expect(screen.getByText('Confirm')).toBeTruthy()
    expect(screen.getByText('Cancel')).toBeTruthy()
  })

  it('calls spendUnlockToken and dismisses strip on confirm', () => {
    mockStreakState = { ...mockStreakState, unlockTokensEarned: 1, longestStreak: 7 }
    mockUnlockedThemes = []

    render(<ThemePicker />)

    // Tap locked row
    fireEvent.click(screen.getByTestId('theme-option-forest-morning'))
    expect(screen.getByText('Unlock Forest Morning?')).toBeTruthy()

    // Tap Confirm
    fireEvent.click(screen.getByText('Confirm'))

    expect(mockSpendUnlockToken).toHaveBeenCalledOnce()
    expect(mockSpendUnlockToken).toHaveBeenCalledWith('forest-morning')
    // Confirm strip dismissed
    expect(screen.queryByText('Unlock Forest Morning?')).toBeNull()
  })

  it('dismisses without spending when cancel tapped', () => {
    mockStreakState = { ...mockStreakState, unlockTokensEarned: 1, longestStreak: 7 }
    mockUnlockedThemes = []

    render(<ThemePicker />)

    fireEvent.click(screen.getByTestId('theme-option-forest-morning'))
    expect(screen.getByText('Unlock Forest Morning?')).toBeTruthy()

    fireEvent.click(screen.getByText('Cancel'))

    expect(mockSpendUnlockToken).not.toHaveBeenCalled()
    expect(screen.queryByText('Unlock Forest Morning?')).toBeNull()
  })

  it('replaces previous confirm strip when tapping different theme', () => {
    mockStreakState = { ...mockStreakState, unlockTokensEarned: 1, longestStreak: 7 }
    mockUnlockedThemes = []

    render(<ThemePicker />)

    // Tap forest-morning
    fireEvent.click(screen.getByTestId('theme-option-forest-morning'))
    expect(screen.getByText('Unlock Forest Morning?')).toBeTruthy()

    // Now tap leather — should replace the previous strip
    fireEvent.click(screen.getByTestId('theme-option-leather'))

    // Forest Morning strip dismissed; Leather strip shown
    expect(screen.queryByText('Unlock Forest Morning?')).toBeNull()
    expect(screen.getByText('Unlock Worn Leather?')).toBeTruthy()
  })
})

// ==========================================================================
// Paid tier
// ==========================================================================

describe('paid tier', () => {
  it('shows no locked overlays and no "Unlock everything now" on paid tier', () => {
    // Force paid tier via mock seam
    mockTier = 'paid_monthly'
    mockUnlockedThemes = [] // even with nothing unlocked, paid tier bypasses locks
    mockStreakState = { ...mockStreakState, unlockTokensEarned: 0 }

    render(<ThemePicker />)

    // No lock affordances
    for (const name of LOCKABLE_THEMES) {
      expect(screen.queryByTestId(`lock-affordance-${name}`)).toBeNull()
    }

    // "Unlock everything now" should NOT be present on paid tier
    expect(screen.queryByText('Unlock everything now')).toBeNull()
  })
})

// ==========================================================================
// "Unlock everything now" affordance
// ==========================================================================

describe('"Unlock everything now" affordance', () => {
  it('renders on free tier and routes to /paid/coming-soon when tapped', () => {
    mockTier = 'free'

    render(<ThemePicker />)

    const button = screen.getByText('Unlock everything now')
    expect(button).toBeTruthy()

    fireEvent.click(button)

    expect(mockRouterPush).toHaveBeenCalledWith('/paid/coming-soon')
  })

  it('is absent on paid tier', () => {
    mockTier = 'paid_monthly'

    render(<ThemePicker />)

    expect(screen.queryByText('Unlock everything now')).toBeNull()
  })
})
