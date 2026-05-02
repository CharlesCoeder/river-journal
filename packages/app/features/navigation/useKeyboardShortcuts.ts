import { useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'solito/navigation'
import { hidePersistentEditor } from 'app/state/store'

// ---------------------------------------------------------------------------
// useKeyboardShortcuts
//
// Registers a single keydown listener on `document` for web/desktop.
// Short-circuits on non-web platforms (React Native, etc.).
//
// Shortcuts:
//   Cmd/Ctrl+N  — open editor (/journal)
//   Cmd/Ctrl+,  — open preferences (/settings)
//   Esc         — exit editor to home (only when on /journal, no modal open)
//
// Suppression contract (AC 7):
//   - event.isComposing or keyCode===229 (IME) → bail
//   - event.defaultPrevented → bail
//   - event target is input/textarea/select or isContentEditable → bail
// ---------------------------------------------------------------------------

function isEditableTarget(e: KeyboardEvent): boolean {
  const target = (e.target as HTMLElement | null) ?? document.activeElement
  if (!target) return false
  const tag = (target as HTMLElement).tagName?.toLowerCase()
  // Include <select> in editable tag set
  const editableTags = new Set(['input', 'textarea', 'select'])
  // isContentEditable handles contenteditable="true" and inherited cases.
  // Also check for the empty-string form (contenteditable="") which the HTML
  // spec treats as equivalent to "true" but some test environments do not.
  const ce = (target as HTMLElement).getAttribute?.('contenteditable')
  const isContentEditable =
    !!(target as HTMLElement).isContentEditable || ce === '' || ce === 'true'
  return editableTags.has(tag) || isContentEditable
}

export function useKeyboardShortcuts(): void {
  const router = useRouter()
  const pathname = usePathname()

  // Use a ref to avoid stale closure on pathname
  const pathnameRef = useRef(pathname)
  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  useEffect(() => {
    // Short-circuit on non-web environments
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    function handleKeyDown(e: KeyboardEvent) {
      // Suppression guards (AC 7)
      if (e.isComposing || e.keyCode === 229) return
      if (e.defaultPrevented) return
      if (isEditableTarget(e)) return

      const currentPath = pathnameRef.current

      // Cmd/Ctrl+N — open editor
      if (e.key === 'n' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (currentPath !== '/journal') {
          router.push('/journal')
        }
        return
      }

      // Cmd/Ctrl+, — open preferences
      if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (currentPath !== '/settings') {
          router.push('/settings')
        }
        return
      }

      // Esc — exit editor to home (only on /journal, no modal open)
      if (e.key === 'Escape') {
        if (currentPath !== '/journal') return

        // Check for open modal (AC 8) — defer to Tamagui/Radix if dialog is open
        const openDialog = document.querySelector('[role="dialog"][data-state="open"]')
        if (openDialog) return

        // Do NOT call preventDefault for Esc — let Dialog primitives handle
        hidePersistentEditor()
        router.push('/')
        return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [router])
}

export default useKeyboardShortcuts
