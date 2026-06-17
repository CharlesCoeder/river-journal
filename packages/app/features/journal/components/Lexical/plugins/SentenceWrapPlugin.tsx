/**
 * SentenceWrapPlugin
 *
 * Registers Lexical node transforms that partition each block's text into stable
 * SentenceNode wrappers — but ONLY when focus mode is ON, granularity is
 * 'sentence', and the editor is editable. This is the STRUCTURE half of Story
 * 2.11; the STYLING half (the animated dim) lives in FocusModeParagraphPlugin.
 *
 * Lifecycle:
 *   - On activation: eager-wrap all existing blocks (history-merged) and register
 *     per-block-type node transforms so subsequent edits re-partition minimally.
 *   - While active: transforms run inside the user's own update, so wrapping is
 *     coalesced into the triggering edit and never becomes a separate undo step.
 *     Composition (IME) is skipped to avoid corrupting CJK input.
 *   - On deactivation / unmount (granularity → paragraph, focus mode ON→OFF):
 *     unregister the transforms and unwrap every SentenceNode (history-merged),
 *     returning the document to the exact Story 2.6 paragraph state.
 *
 * When inactive the plugin registers nothing and touches no nodes.
 */

import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ParagraphNode, TextNode, type ElementNode, type TextNode as TextNodeType } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode } from '@lexical/list'
import {
  reconcileBlockSentences,
  wrapAllBlocks,
  unwrapAllBlocks,
  nearestWrappableBlockOf,
  isWrappableBlock,
} from '../focus/sentenceWrap'

export function SentenceWrapPlugin({
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
    const active = focusMode && focusGranularity === 'sentence' && !readOnly
    if (!active) return

    // Partition each block's text into sentences. List items are registered
    // directly (the parent ListNode is left untouched). Typing the transform as
    // (node: ElementNode) keeps it assignable to every block class's Transform.
    const transform = (node: ElementNode) => {
      // Skip mid-IME-composition to avoid corrupting CJK input; the next
      // non-composing update re-partitions.
      if (editor.isComposing()) return
      reconcileBlockSentences(node)
    }

    // A Lexical node transform only fires when a node's DIRECT children change.
    // Once a block is wrapped (block > sentence > text), typing mutates the
    // grandchild TextNode, which does NOT re-fire the block transform — so the
    // block would never re-partition. Registering on TextNode (which IS the
    // directly-mutated node on every keystroke) and reconciling its top-level
    // block fixes incremental typing. The block transforms still handle the
    // initial wrap and structural changes (paste, block insertion).
    const textTransform = (node: TextNodeType) => {
      if (editor.isComposing()) return
      const block = nearestWrappableBlockOf(node)
      if (block !== null && isWrappableBlock(block)) reconcileBlockSentences(block)
    }

    const unregisters = [
      editor.registerNodeTransform(ParagraphNode, transform),
      editor.registerNodeTransform(HeadingNode, transform),
      editor.registerNodeTransform(QuoteNode, transform),
      editor.registerNodeTransform(ListItemNode, transform),
      editor.registerNodeTransform(TextNode, textTransform),
    ]

    // registerNodeTransform does not retroactively run on existing nodes, so
    // eagerly wrap what's already in the document.
    wrapAllBlocks(editor)

    return () => {
      for (const unregister of unregisters) unregister()
      // Tear the wrappers back down so no SentenceNode survives mode-off.
      try {
        unwrapAllBlocks(editor)
      } catch {
        // Editor already torn down on unmount — best-effort cleanup.
      }
    }
  }, [editor, focusMode, focusGranularity, readOnly])

  return null
}
