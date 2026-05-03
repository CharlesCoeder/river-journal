/**
 * Hotkey override store actions — behavior tests.
 *
 * Verifies the setHotkeyOverride / resetHotkeyOverride actions, the
 * default-profile shape, and the migration-guard back-fill for profiles
 * that pre-date the hotkeyOverrides field.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../utils/supabase', () => ({
  supabase: {},
}))

import { store$ } from '../store'
// These exports must exist after implementation.
import { setHotkeyOverride, resetHotkeyOverride } from '../store'

beforeEach(() => {
  store$.profile.set(null)
})

describe('setHotkeyOverride', () => {
  it('creates a profile when none exists and writes the override', () => {
    expect(store$.profile.get()).toBeNull()
    setHotkeyOverride('newEntry', 'Mod+E')
    expect(store$.profile.get()).not.toBeNull()
    expect(store$.profile.hotkeyOverrides.newEntry.get()).toBe('Mod+E')
  })

  it('stores overrides for each known action id without affecting the others', () => {
    setHotkeyOverride('newEntry', 'Mod+E')
    setHotkeyOverride('openSettings', 'Mod+;')
    setHotkeyOverride('exitEditor', 'Shift+F1')

    expect(store$.profile.hotkeyOverrides.newEntry.get()).toBe('Mod+E')
    expect(store$.profile.hotkeyOverrides.openSettings.get()).toBe('Mod+;')
    expect(store$.profile.hotkeyOverrides.exitEditor.get()).toBe('Shift+F1')
  })

  it('overwrites an existing override on repeat call', () => {
    setHotkeyOverride('newEntry', 'Mod+E')
    setHotkeyOverride('newEntry', 'Mod+J')
    expect(store$.profile.hotkeyOverrides.newEntry.get()).toBe('Mod+J')
  })

  it('preserves recorder-emitted explicit modifier strings (does not coerce to Mod+)', () => {
    setHotkeyOverride('newEntry', 'Control+N')
    expect(store$.profile.hotkeyOverrides.newEntry.get()).toBe('Control+N')
  })

  it('does not throw for an existing profile that lacks the hotkeyOverrides field (back-fill)', () => {
    // Simulate a profile persisted before this field existed.
    store$.profile.set({
      word_goal: 750,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      // hotkeyOverrides intentionally missing
      sync: {
        word_goal: true,
        themeName: true,
        customTheme: true,
        fontPairing: true,
      },
    } as any)

    expect(() => setHotkeyOverride('newEntry', 'Mod+E')).not.toThrow()
    expect(store$.profile.hotkeyOverrides.newEntry.get()).toBe('Mod+E')
  })
})

describe('resetHotkeyOverride', () => {
  it('removes the override for the given action so absence == use default', () => {
    setHotkeyOverride('newEntry', 'Mod+E')
    expect(store$.profile.hotkeyOverrides.newEntry.get()).toBe('Mod+E')

    resetHotkeyOverride('newEntry')

    expect(store$.profile.hotkeyOverrides.newEntry.get()).toBeUndefined()
  })

  it('does not affect overrides for other actions', () => {
    setHotkeyOverride('newEntry', 'Mod+E')
    setHotkeyOverride('openSettings', 'Mod+;')

    resetHotkeyOverride('newEntry')

    expect(store$.profile.hotkeyOverrides.newEntry.get()).toBeUndefined()
    expect(store$.profile.hotkeyOverrides.openSettings.get()).toBe('Mod+;')
  })

  it('is a safe no-op when there is no profile yet (back-fills empty overrides)', () => {
    expect(store$.profile.get()).toBeNull()
    expect(() => resetHotkeyOverride('newEntry')).not.toThrow()
    // After the call the field exists as an empty object; the action key is absent.
    expect(store$.profile.hotkeyOverrides.newEntry.get()).toBeUndefined()
  })
})

describe('default profile shape', () => {
  it('seeds hotkeyOverrides as an empty object when the profile is first created', () => {
    // Trigger profile creation through any existing setter that calls ensureProfile.
    setHotkeyOverride('newEntry', 'Mod+E')
    resetHotkeyOverride('newEntry')

    const overrides = store$.profile.hotkeyOverrides.get()
    expect(overrides).toBeDefined()
    expect(typeof overrides).toBe('object')
  })
})
