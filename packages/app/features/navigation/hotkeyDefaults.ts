import type { HotkeyActionId } from 'app/state/types'

export const DEFAULT_HOTKEYS: Record<HotkeyActionId, string> = {
  newEntry: 'Mod+N',
  openSettings: 'Mod+,',
  exitEditor: 'Escape',
}

/**
 * For `Mod+...` bindings, return BOTH `Meta+...` and `Control+...` so the
 * shortcut fires on either modifier on either platform — preserves the
 * deliberate dual-binding behaviour. For non-Mod bindings (e.g. the Escape
 * default, or a user-recorded `Shift+F1`), return the binding as-is.
 */
export function expandHotkey(hotkey: string): string[] {
  if (hotkey.startsWith('Mod+')) {
    const rest = hotkey.slice(4)
    return [`Meta+${rest}`, `Control+${rest}`]
  }
  return [hotkey]
}
