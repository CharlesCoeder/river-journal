import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../utils/supabase', () => ({
  supabase: {},
}))

import { setFontPairing, store$ } from '../store'
import { DEFAULT_FONT_PAIRING } from '../types'

beforeEach(() => {
  store$.profile.set(null)
})

describe('setFontPairing', () => {
  it('creates profile and sets font pairing', () => {
    expect(store$.profile.get()).toBeNull()
    setFontPairing('lato-lora')
    expect(store$.profile.get()).not.toBeNull()
    expect(store$.profile.fontPairing.get()).toBe('lato-lora')
  })

  it('sets default font pairing on profile creation', () => {
    setFontPairing('outfit-newsreader')
    expect(store$.profile.fontPairing.get()).toBe('outfit-newsreader')
  })

  it('updates font pairing on existing profile', () => {
    setFontPairing('outfit-newsreader')
    setFontPairing('inter-source-serif')
    expect(store$.profile.fontPairing.get()).toBe('inter-source-serif')
  })

  it('rejects invalid font pairing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setFontPairing('invalid-font' as any)
    expect(warnSpy).toHaveBeenCalledWith('Invalid font pairing: invalid-font')
    warnSpy.mockRestore()
  })

  it('includes fontPairing in sync defaults', () => {
    setFontPairing('outfit-newsreader')
    expect(store$.profile.sync.fontPairing.get()).toBe(true)
  })

  it('defaults to outfit-newsreader', () => {
    expect(DEFAULT_FONT_PAIRING).toBe('outfit-newsreader')
  })
})
