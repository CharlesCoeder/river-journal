/**
 * SentenceNode — a custom inline ElementNode that wraps a single sentence.
 *
 * Why a real node (and not the CSS Custom Highlight API): per-sentence focus mode
 * MUST animate the dim/brighten as the cursor crosses sentence boundaries.
 * Highlight pseudo-elements cannot run CSS transitions (they snap), so we need a
 * persistent DOM element whose class flips. SentenceNode renders a stable
 * `<span class="rj-sentence">`; `updateDOM` returns false so the element is never
 * recreated — the styling plugin toggles `rj-sentence-active` / `rj-sentence-dim`
 * imperatively, and the CSS `transition` on the persistent span runs the fade.
 *
 * A sentence containing `**bold**` spans multiple TextNodes, so a TextNode
 * subclass won't do (adjacent same-format TextNodes get normalized/merged); an
 * inline ElementNode can hold multiple formatted children.
 *
 * Markdown export transparency is engineered in transformers.ts
 * (SENTENCE_TRANSFORMER) — an inline ElementNode with no transformer would be
 * silently dropped by $convertToMarkdownString, deleting the user's text.
 */

import {
  ElementNode,
  $applyNodeReplacement,
  type EditorConfig,
  type LexicalNode,
  type SerializedElementNode,
} from 'lexical'

export type SerializedSentenceNode = SerializedElementNode

export class SentenceNode extends ElementNode {
  static getType(): string {
    return 'sentence'
  }

  static clone(node: SentenceNode): SentenceNode {
    return new SentenceNode(node.__key)
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span')
    span.className = 'rj-sentence'
    return span
  }

  updateDOM(): false {
    // The wrapper element is stable. Class changes (active/dim) are applied
    // imperatively by the styling plugin via getElementByKey().classList, never
    // through reconciliation — recreating the span would make the fade snap.
    return false
  }

  isInline(): true {
    return true
  }

  // Caret ergonomics: text typed at a sentence's edges flows naturally into it,
  // and an emptied sentence wrapper does not linger (the node transform also
  // removes empties). See AC 5 / AC 24.
  canInsertTextBefore(): boolean {
    return true
  }

  canInsertTextAfter(): boolean {
    return true
  }

  canBeEmpty(): boolean {
    return true
  }

  // Allow the node to be merged/extracted at its boundaries so backspace at the
  // start of a sentence merges into the previous sentence's text.
  canMergeWith(node: LexicalNode): boolean {
    return node instanceof SentenceNode
  }

  static importJSON(serializedNode: SerializedSentenceNode): SentenceNode {
    return $createSentenceNode().updateFromJSON(serializedNode)
  }

  exportJSON(): SerializedSentenceNode {
    return {
      ...super.exportJSON(),
      type: 'sentence',
      version: 1,
    }
  }
}

export function $createSentenceNode(): SentenceNode {
  return $applyNodeReplacement(new SentenceNode())
}

export function $isSentenceNode(node: LexicalNode | null | undefined): node is SentenceNode {
  return node instanceof SentenceNode
}
