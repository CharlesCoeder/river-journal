/**
 * expandHotkey helper — behavior tests.
 *
 * Verifies that Mod+-prefixed bindings are registered for BOTH Meta and Control
 * (preserving the deliberate dual-modifier UX shipped earlier), while non-Mod
 * bindings are passed through unchanged.
 *
 * Also confirms DEFAULT_HOTKEYS exposes the canonical default for each action.
 */

import { describe, expect, it } from 'vitest'

// Both must be exported from useKeyboardShortcuts after implementation.
import { expandHotkey, DEFAULT_HOTKEYS } from '../useKeyboardShortcuts'

describe('expandHotkey', () => {
  it('expands Mod+N into Meta+N and Control+N', () => {
    expect(expandHotkey('Mod+N')).toEqual(['Meta+N', 'Control+N'])
  })

  it('expands Mod+, into Meta+, and Control+,', () => {
    expect(expandHotkey('Mod+,')).toEqual(['Meta+,', 'Control+,'])
  })

  it('expands Mod+ with multi-char tail', () => {
    expect(expandHotkey('Mod+Enter')).toEqual(['Meta+Enter', 'Control+Enter'])
  })

  it('passes Escape through unchanged (not Mod-prefixed)', () => {
    expect(expandHotkey('Escape')).toEqual(['Escape'])
  })

  it('passes an explicit Control+N recording through unchanged', () => {
    // A user who deliberately recorded Ctrl+N on macOS should NOT see their
    // binding silently rewritten to also fire on Cmd+N.
    expect(expandHotkey('Control+N')).toEqual(['Control+N'])
  })

  it('passes an explicit Meta+N recording through unchanged', () => {
    expect(expandHotkey('Meta+N')).toEqual(['Meta+N'])
  })

  it('passes a non-Mod chord like Shift+F1 through unchanged', () => {
    expect(expandHotkey('Shift+F1')).toEqual(['Shift+F1'])
  })
})

describe('DEFAULT_HOTKEYS', () => {
  it('defaults newEntry to Mod+N', () => {
    expect(DEFAULT_HOTKEYS.newEntry).toBe('Mod+N')
  })

  it('defaults openSettings to Mod+,', () => {
    expect(DEFAULT_HOTKEYS.openSettings).toBe('Mod+,')
  })

  it('defaults exitEditor to Escape', () => {
    expect(DEFAULT_HOTKEYS.exitEditor).toBe('Escape')
  })
})
