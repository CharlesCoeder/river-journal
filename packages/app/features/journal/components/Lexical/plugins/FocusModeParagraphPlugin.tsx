/**
 * FocusModeParagraphPlugin
 *
 * Lexical update-listener plugin that dims all paragraphs except the one
 * containing the current cursor when focus mode is ON.
 *
 * CSS classes applied to paragraph <p> DOM elements:
 *   rj-focus-active — the paragraph containing the cursor (full opacity)
 *   rj-focus-dim    — all other paragraphs (0.4 opacity)
 *
 * When focusMode is OFF, both classes are removed from all paragraphs.
 * When readOnly is true, plugin is a no-op (returns null immediately).
 */

import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $getSelection, $isRangeSelection, $isElementNode } from 'lexical'

// ─── CSS class name constants ──────────────────────────────────────────────────
export const CLASS_ACTIVE = 'rj-focus-active'
export const CLASS_DIM = 'rj-focus-dim'

// ─── Pure helper: compute which keys are active vs dim ─────────────────────────

/**
 * Pure function that computes which paragraph keys should receive each CSS class.
 *
 * @param activeKey  - The nodeKey of the paragraph containing the cursor, or null.
 * @param allKeys    - All paragraph node keys in document order.
 * @param focusMode  - Whether focus mode is enabled.
 * @returns { active: string[], dim: string[] } — keys for each class set.
 */
export function computeFocusClasses(
  activeKey: string | null,
  allKeys: string[],
  focusMode: boolean
): { active: string[]; dim: string[] } {
  if (!focusMode || activeKey === null) {
    return { active: [], dim: [] }
  }

  const active: string[] = []
  const dim: string[] = []

  for (const key of allKeys) {
    if (key === activeKey) {
      active.push(key)
    } else {
      dim.push(key)
    }
  }

  return { active, dim }
}

// ─── Plugin component ──────────────────────────────────────────────────────────

export function FocusModeParagraphPlugin({
  focusMode,
  readOnly,
}: {
  focusMode: boolean
  readOnly: boolean
}): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (readOnly) return

    const apply = (state: ReturnType<typeof editor.getEditorState>) => {
      state.read(() => {
        const selection = $getSelection()
        const root = $getRoot()
        const children = root.getChildren()

        // All top-level block elements (paragraphs, headings, list items at root, code, quotes)
        const allKeys: string[] = []
        for (const child of children) {
          if ($isElementNode(child)) {
            allKeys.push(child.getKey())
          }
        }

        // Find the top-level block containing the selection anchor by walking up
        // until the parent is root.
        let activeKey: string | null = null
        if ($isRangeSelection(selection)) {
          let node = selection.anchor.getNode()
          while (node) {
            const parent = node.getParent()
            if (!parent) break
            if (parent.getKey() === root.getKey() && $isElementNode(node)) {
              activeKey = node.getKey()
              break
            }
            node = parent
          }
        }

        const { active, dim } = computeFocusClasses(activeKey, allKeys, focusMode)
        const activeSet = new Set(active)
        const dimSet = new Set(dim)

        for (const key of allKeys) {
          const el = editor.getElementByKey(key)
          if (!el) continue

          if (activeSet.has(key)) {
            el.classList.add(CLASS_ACTIVE)
            el.classList.remove(CLASS_DIM)
          } else if (dimSet.has(key)) {
            el.classList.add(CLASS_DIM)
            el.classList.remove(CLASS_ACTIVE)
          } else {
            el.classList.remove(CLASS_ACTIVE)
            el.classList.remove(CLASS_DIM)
          }
        }
      })
    }

    const unregister = editor.registerUpdateListener(({ editorState }) => apply(editorState))
    // Eager apply on mount / dependency change so toggle-on paints immediately
    try {
      apply(editor.getEditorState())
    } catch {
      // editor may not be fully initialized yet — listener will catch up on next update
    }

    return () => {
      unregister()
      try {
        editor.getEditorState().read(() => {
          const children = $getRoot().getChildren()
          for (const child of children) {
            if ($isElementNode(child)) {
              const el = editor.getElementByKey(child.getKey())
              if (el) {
                el.classList.remove(CLASS_ACTIVE)
                el.classList.remove(CLASS_DIM)
              }
            }
          }
        })
      } catch {
        // editor may have been destroyed — cleanup is best-effort
      }
    }
  }, [editor, focusMode, readOnly])

  return null
}
