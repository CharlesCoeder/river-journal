'use client'

import { useKeyboardShortcuts } from './useKeyboardShortcuts'

/**
 * KeyboardShortcuts — mounts the keyboard shortcut hook.
 * Renders null; exists only to call useKeyboardShortcuts() inside
 * the NextTamaguiProvider tree (SSR boundary safe).
 */
export function KeyboardShortcuts() {
  useKeyboardShortcuts()
  return null
}

export default KeyboardShortcuts
