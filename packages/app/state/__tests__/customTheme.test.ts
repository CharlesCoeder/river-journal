import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../utils/supabase', () => ({
  supabase: {},
}))


import {
  isDarkColor,
  setCustomTheme,
  clearCustomTheme,
  setTheme,
  isDarkTheme,
  store$,
} from '../store'

beforeEach(() => {
  store$.profile.set(null)
})

describe('isDarkColor', () => {
  it('returns true for dark colors', () => {
    expect(isDarkColor('#000000')).toBe(true)
    expect(isDarkColor('#1C1A18')).toBe(true)
    expect(isDarkColor('#2B1D14')).toBe(true)
  })

  it('returns false for light colors', () => {
    expect(isDarkColor('#FFFFFF')).toBe(false)
    expect(isDarkColor('#F9F6F0')).toBe(false)
    expect(isDarkColor('#E8EDE4')).toBe(false)
  })

  it('handles mid-range colors', () => {
    // Pure mid-gray (#808080) has luminance 0.502 → light
    expect(isDarkColor('#808080')).toBe(false)
    // Slightly darker mid-gray
    expect(isDarkColor('#707070')).toBe(true)
  })
})

describe('setCustomTheme', () => {
  it('sets custom theme and activates it', () => {
    const def = { bg: '#F9F6F0', text: '#2C2A28', stone: '#8A8680' }
    setCustomTheme(def)
    expect(store$.profile.customTheme.get()).toEqual(def)
    expect(store$.profile.themeName.get()).toBe('custom')
  })

  it('creates profile if none exists', () => {
    expect(store$.profile.get()).toBeNull()
    setCustomTheme({ bg: '#F9F6F0', text: '#2C2A28', stone: '#8A8680' })
    expect(store$.profile.get()).not.toBeNull()
  })
})

describe('clearCustomTheme', () => {
  it('clears custom theme and reverts to default', () => {
    setCustomTheme({ bg: '#F9F6F0', text: '#2C2A28', stone: '#8A8680' })
    expect(store$.profile.themeName.get()).toBe('custom')

    clearCustomTheme()
    expect(store$.profile.customTheme.get()).toBeNull()
    expect(store$.profile.themeName.get()).toBe('ink')
  })

  it('preserves preset theme if not using custom', () => {
    setCustomTheme({ bg: '#F9F6F0', text: '#2C2A28', stone: '#8A8680' })
    setTheme('night')
    clearCustomTheme()
    expect(store$.profile.themeName.get()).toBe('night')
  })
})

describe('setTheme with custom', () => {
  it('allows setting custom when customTheme exists', () => {
    setCustomTheme({ bg: '#F9F6F0', text: '#2C2A28', stone: '#8A8680' })
    setTheme('ink') // switch away
    setTheme('custom') // switch back
    expect(store$.profile.themeName.get()).toBe('custom')
  })

  it('rejects custom when no customTheme exists', () => {
    setTheme('ink') // ensure profile exists
    setTheme('custom')
    expect(store$.profile.themeName.get()).toBe('ink')
  })
})

describe('isDarkTheme with custom', () => {
  it('returns correct value for custom theme', () => {
    setCustomTheme({ bg: '#1C1A18', text: '#E6E2DA', stone: '#8C8B85' })
    expect(isDarkTheme('custom')).toBe(true)

    setCustomTheme({ bg: '#F9F6F0', text: '#2C2A28', stone: '#8A8680' })
    expect(isDarkTheme('custom')).toBe(false)
  })

  it('returns false for custom when no customTheme exists', () => {
    expect(isDarkTheme('custom')).toBe(false)
  })
})
