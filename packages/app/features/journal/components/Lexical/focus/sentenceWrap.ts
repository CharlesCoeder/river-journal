/**
 * sentenceWrap — Lexical-coupled engine that partitions a block's text into
 * stable SentenceNode wrappers (and tears them back down).
 *
 * This is the STRUCTURE half of Story 2.11 (the rare, risky part). It is:
 *   - idempotent: re-running on stable text is a no-op (Lexical re-runs node
 *     transforms until the tree stops changing — a non-idempotent transform
 *     infinite-loops). The no-op check compares the current SentenceNode
 *     partition to the desired Intl.Segmenter partition and bails when equal,
 *     so typing WITHIN a sentence never re-partitions.
 *   - minimal in observable effect: the common headline case (space after a
 *     period) does NOT change sentence boundaries — the single SentenceNode just
 *     absorbs the space — so its DOM span persists and the dim animation runs.
 *   - selection-preserving: leaf nodes keep their keys across re-partition
 *     (we move and split them, never recreate them), so the caret stays put.
 *
 * Callers must run these inside an `editor.update(...)`. Mode-toggle / unmount
 * driven wrap/unwrap must additionally pass `{ tag: 'history-merge' }` so
 * structural churn never lands on the undo stack (see helpers at the bottom).
 */

import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type LexicalEditor,
} from 'lexical'
import { $createSentenceNode, $isSentenceNode, type SentenceNode } from '../nodes/SentenceNode'
import { segmentSentences, type SentenceSpan } from './sentenceSegmentation'

// ─── No-op detection ────────────────────────────────────────────────────────

/**
 * True when the block's direct children already ARE exactly the desired
 * SentenceNode partition (right count, right sizes). This is what makes the
 * transform idempotent and a no-op while typing within a sentence.
 */
function matchesDesired(children: LexicalNode[], desired: SentenceSpan[]): boolean {
  if (desired.length === 0) {
    return children.every((c) => !$isSentenceNode(c))
  }
  if (children.length !== desired.length) return false
  for (let i = 0; i < desired.length; i++) {
    const child = children[i]
    if (!$isSentenceNode(child)) return false
    if (child.getTextContentSize() !== desired[i].end - desired[i].start) return false
  }
  return true
}

// ─── Flatten / split / regroup ──────────────────────────────────────────────

/** Unwrap every SentenceNode child in place, preserving leaf keys + selection. */
function flattenBlock(block: ElementNode): void {
  for (const child of block.getChildren()) {
    if ($isSentenceNode(child)) {
      for (const leaf of child.getChildren()) {
        child.insertBefore(leaf) // moves the leaf out, before the wrapper
      }
      child.remove()
    }
  }
}

/**
 * Collect the block's inline leaves in document order, descending INTO existing
 * SentenceNodes (one level — sentences never nest). Other inline elements
 * (LinkNode) and leaves (TextNode, LineBreakNode) are atomic.
 */
function collectSentenceLeaves(block: ElementNode): LexicalNode[] {
  const leaves: LexicalNode[] = []
  for (const child of block.getChildren()) {
    if ($isSentenceNode(child)) {
      for (const inner of child.getChildren()) leaves.push(inner)
    } else {
      leaves.push(child)
    }
  }
  return leaves
}

/** Split TextNode leaves (even inside wrappers) so none straddles a boundary. */
function splitLeavesDeep(block: ElementNode, interior: number[]): void {
  if (interior.length === 0) return
  let pos = 0
  for (const leaf of collectSentenceLeaves(block)) {
    const size = leaf.getTextContentSize()
    const start = pos
    const end = pos + size
    if ($isTextNode(leaf)) {
      const cuts = interior.filter((b) => b > start && b < end).map((b) => b - start)
      if (cuts.length > 0) leaf.splitText(...cuts)
    }
    pos = end
  }
}

// ─── Public: per-block reconcile (the node transform body) ───────────────────

/**
 * Reconcile a single block's SentenceNode partition to match Intl.Segmenter
 * boundaries. No-op when already correct. MUST run inside an editor update.
 *
 * Minimal-diff via POSITIONAL WRAPPER REUSE: the i-th desired sentence reuses
 * the i-th existing SentenceNode wrapper (only the extra/new sentences create or
 * remove wrappers). When a wrapper must SPLIT — e.g. you finish a sentence and
 * type the first character of the next, so one wrapper briefly holds "one. t" —
 * the wrapper is REUSED for the leading sentence ("one. ") and only the new
 * sentence ("t") gets a fresh wrapper. The completed sentence's DOM element
 * therefore persists and merely flips active→dim (a smooth fade), instead of
 * being recreated at full color and flashing. Leaf nodes are split/moved, never
 * recreated, so the caret stays put.
 */
export function reconcileBlockSentences(block: ElementNode): void {
  // Only handle blocks whose children are inline content or SentenceNodes.
  // Inline elements (e.g. LinkNode) are fine — they're treated as atomic leaves.
  // A nested BLOCK element (sub-list, etc.) means "leave this alone".
  const children = block.getChildren()
  for (const child of children) {
    if ($isSentenceNode(child)) continue
    if ($isElementNode(child) && !child.isInline()) return
  }

  const text = block.getTextContent()
  const desired = segmentSentences(text)

  if (matchesDesired(children, desired)) return

  if (desired.length === 0) {
    flattenBlock(block) // empty block — nothing to wrap
    return
  }

  // Align all leaves to the desired boundaries (split inside wrappers too).
  splitLeavesDeep(
    block,
    desired.slice(0, -1).map((span) => span.end)
  )

  // Reuse existing wrappers positionally; append each span's leaves in document
  // order (re-appending a leaf already in the wrapper just reorders it).
  const existingWrappers = block.getChildren().filter($isSentenceNode) as SentenceNode[]
  const leaves = collectSentenceLeaves(block)
  let li = 0
  let pos = 0
  for (let i = 0; i < desired.length; i++) {
    const span = desired[i]
    let wrapper = existingWrappers[i]
    if (wrapper === undefined) {
      wrapper = $createSentenceNode()
      block.append(wrapper)
    }
    while (li < leaves.length) {
      const leaf = leaves[li]
      const size = leaf.getTextContentSize()
      if (pos + size <= span.end) {
        wrapper.append(leaf)
        pos += size
        li++
      } else {
        break
      }
    }
  }

  // Remove now-unused trailing wrappers (a merge left them empty).
  for (let i = desired.length; i < existingWrappers.length; i++) {
    existingWrappers[i].remove()
  }

  // Defensive: any leftover leaves go into the last wrapper so no text is lost.
  const wrappers = block.getChildren().filter($isSentenceNode) as SentenceNode[]
  const last = wrappers[wrappers.length - 1]
  while (li < leaves.length && last) {
    last.append(leaves[li])
    li++
  }
}

/** Unwrap all SentenceNodes in a block (back to the Story 2.6 paragraph state). */
export function unwrapBlockSentences(block: ElementNode): void {
  flattenBlock(block)
}

// ─── Public: whole-editor helpers (history-merged) ───────────────────────────

/** Block element types whose text we partition into sentences. */
export function isWrappableBlock(node: LexicalNode): node is ElementNode {
  return $isElementNode(node) && !node.isInline() && node.getType() !== 'code'
}

/**
 * Walk up to the top-level block (direct child of root) that contains `node`.
 * Returns null if there isn't one (e.g. the node is detached). Used by the
 * TextNode transform: a Lexical node transform only fires when a node's DIRECT
 * children change, so once a paragraph is wrapped (block > sentence > text),
 * typing into the nested TextNode does NOT re-fire the block transform. The
 * TextNode transform reconciles the top-level block on every keystroke instead.
 */
export function topLevelBlockOf(node: LexicalNode): ElementNode | null {
  let current: LexicalNode | null = node
  while (current !== null) {
    const parent: LexicalNode | null = current.getParent()
    if (parent === null) return null
    if (parent.getType() === 'root') {
      return $isElementNode(current) ? (current as ElementNode) : null
    }
    current = parent
  }
  return null
}

/**
 * Walk up to the NEAREST wrappable block ancestor of `node` (the block that
 * directly holds the inline content `node` lives in). Unlike `topLevelBlockOf`,
 * this returns the ListItemNode for text inside a list — not the enclosing
 * ListNode, whose direct children are list items (non-inline), which makes
 * `reconcileBlockSentences` early-return. Used by the TextNode transform so
 * incremental typing re-partitions list items as well as top-level paragraphs.
 */
export function nearestWrappableBlockOf(node: LexicalNode): ElementNode | null {
  let current: LexicalNode | null = node.getParent()
  while (current !== null) {
    if (isWrappableBlock(current)) return current
    current = current.getParent()
  }
  return null
}

/**
 * Eagerly wrap every wrappable block in the document. Runs in a history-merge
 * update so the structural change never enters the undo stack.
 */
export function wrapAllBlocks(editor: LexicalEditor): void {
  editor.update(
    () => {
      for (const block of $getRoot().getChildren()) {
        if (isWrappableBlock(block)) reconcileBlockSentences(block)
      }
    },
    { tag: 'history-merge' }
  )
}

/**
 * Remove every SentenceNode in the document, returning to the plain paragraph
 * state. Runs in a history-merge update.
 */
export function unwrapAllBlocks(editor: LexicalEditor): void {
  editor.update(
    () => {
      for (const block of $getRoot().getChildren()) {
        if (isWrappableBlock(block)) unwrapBlockSentences(block)
      }
    },
    { tag: 'history-merge' }
  )
}
