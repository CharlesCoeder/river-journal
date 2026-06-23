/**
 * SentenceFocusPlugin — the STYLING half of per-sentence focus mode (Story 2.11).
 *
 * Mounted as a SIBLING of FocusModeParagraphPlugin (dev's choice, documented
 * here) so the proven paragraph-level logic is left completely untouched. The
 * paragraph plugin keeps dimming non-active <p> blocks; this plugin additionally
 * dims the non-active SENTENCES inside the active paragraph.
 *
 * On every selection change it toggles `rj-sentence-active` / `rj-sentence-dim`
 * on the EXISTING SentenceNode span elements (via getElementByKey().classList) —
 * the same imperative pattern FocusModeParagraphPlugin uses. The spans are the
 * stable DOM created by SentenceNode and are NOT recreated on cursor move, so
 * the CSS `transition` on `.rj-sentence` runs the fade. When the cursor sits
 * past a completed sentence (activeSentence → null), every sentence in the
 * active paragraph dims (the "delay-bug fix" state).
 *
 * Active only when focusMode is ON, granularity is 'sentence', and editable.
 */

import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical'
import { $isSentenceNode } from '../nodes/SentenceNode'
import { activeSentence, getBlockOffset } from '../focus/sentenceSegmentation'

export const CLASS_SENTENCE_ACTIVE = 'rj-sentence-active'
export const CLASS_SENTENCE_DIM = 'rj-sentence-dim'

/**
 * Toggle `rj-sentence-active`/`rj-sentence-dim` on the SentenceNode spans based
 * on the editor's CURRENT selection. Exported so tests can drive it directly
 * against a real (DOM-attached) editor. Reads only — never mutates the tree.
 */
export function applySentenceFocusClasses(editor: LexicalEditor): void {
  editor.getEditorState().read(() => {
    const selection = $getSelection()
    const root = $getRoot()

    // Find the top-level block containing the cursor + the raw anchor.
    let activeBlockKey: string | null = null
    let anchorNode: LexicalNode | null = null
    let anchorOffset = 0
    if ($isRangeSelection(selection)) {
      anchorNode = selection.anchor.getNode()
      anchorOffset = selection.anchor.offset
      let node: LexicalNode | null = anchorNode
      while (node) {
        // Explicit annotation breaks a circular-inference (TS7022) that surfaces
        // under the apps' stricter `noImplicitAny`.
        const parent: LexicalNode | null = node.getParent()
        if (!parent) break
        if (parent.getKey() === root.getKey() && $isElementNode(node)) {
          activeBlockKey = node.getKey()
          break
        }
        node = parent
      }
    }

    for (const block of root.getChildren()) {
      if (!$isElementNode(block)) continue

      const sentenceChildren = block.getChildren().filter($isSentenceNode)
      if (sentenceChildren.length === 0) continue

      const isActiveBlock = activeBlockKey !== null && block.getKey() === activeBlockKey

      if (!isActiveBlock) {
        // Non-active paragraphs inherit dim from the parent <p>; their sentence
        // spans carry no sentence class.
        for (const sentence of sentenceChildren) {
          const el = editor.getElementByKey(sentence.getKey())
          if (el) {
            el.classList.remove(CLASS_SENTENCE_ACTIVE)
            el.classList.remove(CLASS_SENTENCE_DIM)
          }
        }
        continue
      }

      // Active paragraph: compute the active sentence from the cursor's
      // cumulative block offset, then activate the matching span.
      const blockText = block.getTextContent()
      const blockOffset = anchorNode !== null ? getBlockOffset(block, anchorNode, anchorOffset) : 0
      const span = activeSentence(blockText, blockOffset)

      let cursor = 0
      for (const sentence of sentenceChildren) {
        const start = cursor
        cursor += sentence.getTextContentSize()
        const el = editor.getElementByKey(sentence.getKey())
        if (!el) continue
        const isActiveSentence = span !== null && span.start === start
        if (isActiveSentence) {
          el.classList.add(CLASS_SENTENCE_ACTIVE)
          el.classList.remove(CLASS_SENTENCE_DIM)
        } else {
          el.classList.add(CLASS_SENTENCE_DIM)
          el.classList.remove(CLASS_SENTENCE_ACTIVE)
        }
      }
    }
  })
}

/** Strip every sentence focus class (used when the plugin deactivates). */
export function clearSentenceFocusClasses(editor: LexicalEditor): void {
  editor.getEditorState().read(() => {
    for (const block of $getRoot().getChildren()) {
      if (!$isElementNode(block)) continue
      for (const child of block.getChildren()) {
        if (!$isSentenceNode(child)) continue
        const el = editor.getElementByKey(child.getKey())
        if (el) {
          el.classList.remove(CLASS_SENTENCE_ACTIVE)
          el.classList.remove(CLASS_SENTENCE_DIM)
        }
      }
    }
  })
}

export function SentenceFocusPlugin({
  focusMode,
  focusGranularity,
  readOnly,
}: {
  focusMode: boolean
  focusGranularity: 'paragraph' | 'sentence'
  readOnly: boolean
}): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (readOnly) return
    const active = focusMode && focusGranularity === 'sentence'

    if (!active) {
      try {
        clearSentenceFocusClasses(editor)
      } catch {
        // editor not ready — nothing wrapped yet anyway
      }
      return
    }

    const unregister = editor.registerUpdateListener(() => applySentenceFocusClasses(editor))
    // Eager apply so toggling sentence mode paints immediately.
    try {
      applySentenceFocusClasses(editor)
    } catch {
      // editor not fully initialized — the listener will catch up
    }

    return () => {
      unregister()
      try {
        clearSentenceFocusClasses(editor)
      } catch {
        // editor destroyed — best-effort cleanup
      }
    }
  }, [editor, focusMode, focusGranularity, readOnly])

  return null
}
