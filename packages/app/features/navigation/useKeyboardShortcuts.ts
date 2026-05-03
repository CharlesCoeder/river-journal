import { useHotkeys } from '@tanstack/react-hotkeys'
import { useRouter, usePathname } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import { hidePersistentEditor, store$ } from 'app/state/store'
import type { HotkeyActionId } from 'app/state/types'
import { DEFAULT_HOTKEYS, expandHotkey } from './hotkeyDefaults'

export { DEFAULT_HOTKEYS, expandHotkey }

// ---------------------------------------------------------------------------
// useKeyboardShortcuts
//
// Registers keyboard shortcuts for web/desktop via @tanstack/react-hotkeys.
// The library handles lifecycle (add/remove event listeners on mount/unmount).
//
// Shortcuts:
//   Cmd/Ctrl+N   — open editor (/journal)
//   Cmd/Ctrl+,   — open preferences (/settings)
//   Esc          — exit editor to home (only when on /journal, no modal open)
//
// Suppression contract:
//   - ignoreInputs: true (per-definition) — library suppresses input/textarea/select/contenteditable
//   - isEditableTarget() guard — fallback for bare contenteditable="" (library uses
//     isContentEditable which some environments return false for the empty-string form)
//   - isComposing / keyCode===229 (IME) guard — library does NOT suppress IME events
//   - defaultPrevented guard — check runs before our own preventDefault call to
//     detect events pre-prevented by external code
//
// Note on Mod: 'Mod+N' resolves to a single platform modifier (Meta on mac,
// Control elsewhere). Since both metaKey and ctrlKey must work cross-platform,
// we register Meta+N / Control+N (and Meta+, / Control+,) explicitly.
//
// Note on preventDefault: called manually inside callbacks (not via library
// option) so the `if (event.defaultPrevented) return` guard correctly detects
// events pre-prevented by external code before our call.
// ---------------------------------------------------------------------------

function isEditableTarget(e: KeyboardEvent): boolean {
  const target = (e.target as HTMLElement | null) ?? document.activeElement
  if (!target) return false
  const tag = (target as HTMLElement).tagName?.toLowerCase()
  // Include <select> in editable tag set
  const editableTags = new Set(['input', 'textarea', 'select'])
  // isContentEditable handles contenteditable="true" and inherited cases.
  // Also check for the empty-string form (contenteditable="") which the HTML
  // spec treats as equivalent to "true" but some environments do not.
  const ce = (target as HTMLElement).getAttribute?.('contenteditable')
  const isContentEditable =
    !!(target as HTMLElement).isContentEditable || ce === '' || ce === 'true'
  return editableTags.has(tag) || isContentEditable
}

export function useKeyboardShortcuts(): void {
  const profile = use$(store$.profile) as
    | { hotkeyOverrides?: Partial<Record<HotkeyActionId, string>> }
    | null
    | undefined
  const newEntryKey = profile?.hotkeyOverrides?.newEntry ?? DEFAULT_HOTKEYS.newEntry
  const openSettingsKey = profile?.hotkeyOverrides?.openSettings ?? DEFAULT_HOTKEYS.openSettings
  const exitEditorKey = profile?.hotkeyOverrides?.exitEditor ?? DEFAULT_HOTKEYS.exitEditor

  const router = useRouter()
  const pathname = usePathname()

  const openEditorCallback = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return // IME guard
    if (event.defaultPrevented) return // pre-prevented by external code
    if (isEditableTarget(event)) return // fallback editable guard
    event.preventDefault() // block browser default (e.g. "New Window")
    if (pathname !== '/journal') router.push('/journal')
  }

  const openSettingsCallback = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return
    if (event.defaultPrevented) return
    if (isEditableTarget(event)) return
    event.preventDefault()
    if (pathname !== '/settings') router.push('/settings')
  }

  const exitEditorCallback = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return
    if (event.defaultPrevented) return
    if (isEditableTarget(event)) return
    if (pathname !== '/journal') return
    const openDialog = document.querySelector('[role="dialog"][data-state="open"]')
    if (openDialog) return // defer to Dialog's own Esc (modal-open guard)
    hidePersistentEditor()
    router.push('/')
    // Do NOT call preventDefault for Esc — Dialog primitives need it unhandled
  }

  const modNOptions = { ignoreInputs: true, preventDefault: false } as const
  const modCommaOptions = { ignoreInputs: true, preventDefault: false } as const
  const escOptions = { ignoreInputs: true, preventDefault: false } as const

  useHotkeys(
    [
      ...expandHotkey(newEntryKey).map((hotkey) => ({
        hotkey: hotkey as Parameters<typeof useHotkeys>[0][number]['hotkey'],
        callback: openEditorCallback,
        options: modNOptions,
      })),
      ...expandHotkey(openSettingsKey).map((hotkey) => ({
        hotkey: hotkey as Parameters<typeof useHotkeys>[0][number]['hotkey'],
        callback: openSettingsCallback,
        options: modCommaOptions,
      })),
      ...expandHotkey(exitEditorKey).map((hotkey) => ({
        hotkey: hotkey as Parameters<typeof useHotkeys>[0][number]['hotkey'],
        callback: exitEditorCallback,
        options: escOptions,
      })),
    ],
    {
      stopPropagation: false,
      enabled: typeof window !== 'undefined',
    },
  )
}

export default useKeyboardShortcuts
