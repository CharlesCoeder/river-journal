// @vitest-environment happy-dom
// Node-transform idempotency + selection preservation (Story 2.11, AC 19).

import { describe, expect, it } from 'vitest'
import {
  createEditor,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  $createParagraphNode,
  $createTextNode,
  type LexicalEditor,
  type ElementNode,
} from 'lexical'
import { createBaseLexicalConfig } from '../../lexical-config'
import { reconcileBlockSentences } from '../sentenceWrap'
import { getBlockOffset } from '../sentenceSegmentation'

function makeEditor(): LexicalEditor {
  return createEditor({
    namespace: 'rj-test',
    nodes: createBaseLexicalConfig().nodes,
    onError: (e) => {
      throw e
    },
  })
}

function reconcileAll(editor: LexicalEditor): void {
  editor.update(
    () => {
      for (const block of $getRoot().getChildren()) {
        if ($isElementNode(block) && !block.isInline())
          reconcileBlockSentences(block as ElementNode)
      }
    },
    { discrete: true, tag: 'history-merge' }
  )
}

function countSentenceNodes(editor: LexicalEditor): number {
  let count = 0
  editor.getEditorState().read(() => {
    const walk = (node: any) => {
      if (typeof node.getType === 'function' && node.getType() === 'sentence') count++
      if (typeof node.getChildren === 'function') for (const c of node.getChildren()) walk(c)
    }
    walk($getRoot())
  })
  return count
}

describe('node transform idempotency (AC 19)', () => {
  it('running the transform twice on stable text produces an identical tree', () => {
    const editor = makeEditor()
    editor.update(
      () => {
        const p = $createParagraphNode()
        p.append($createTextNode('Hello world. Second sentence. Third one.'))
        $getRoot().append(p)
      },
      { discrete: true }
    )

    reconcileAll(editor)
    const firstJson = JSON.stringify(editor.getEditorState().toJSON())
    const firstCount = countSentenceNodes(editor)

    reconcileAll(editor) // second pass must be a no-op
    const secondJson = JSON.stringify(editor.getEditorState().toJSON())

    expect(firstCount).toBe(3)
    expect(secondJson).toBe(firstJson) // identical tree incl. node keys → no churn
  })
})

describe('selection preservation across re-partition (AC 19)', () => {
  it('inserting a sentence boundary keeps the caret block-offset unchanged', () => {
    const editor = makeEditor()

    // Single sentence, caret after "Hello" (offset 5). The second word is
    // capitalized so the inserted terminator actually creates a new sentence
    // (ICU does not break a sentence before a lowercase continuation).
    editor.update(
      () => {
        const p = $createParagraphNode()
        const t = $createTextNode('Hello World')
        p.append(t)
        $getRoot().append(p)
        t.select(5, 5)
      },
      { discrete: true }
    )
    reconcileAll(editor) // 1 sentence wrapper

    // Insert a boundary at the caret → "Hello. World" → two sentences.
    editor.update(
      () => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) selection.insertText('. ')
      },
      { discrete: true }
    )

    // Caret block-offset BEFORE the structural re-partition.
    const offsetBefore = readCaretBlockOffset(editor)
    expect(offsetBefore).toBe(7) // "Hello. " → caret after the space → 7

    reconcileAll(editor) // re-partition into 2 sentences

    // Caret block-offset AFTER re-partition must be unchanged.
    const offsetAfter = readCaretBlockOffset(editor)
    expect(offsetAfter).toBe(offsetBefore)
    expect(countSentenceNodes(editor)).toBeGreaterThanOrEqual(2)
  })
})

function readCaretBlockOffset(editor: LexicalEditor): number {
  let offset = -1
  editor.getEditorState().read(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return
    const anchorNode = selection.anchor.getNode()
    // Walk up to the top-level block.
    let block: any = anchorNode
    while (
      block &&
      block.getParent &&
      block.getParent() &&
      block.getParent().getType() !== 'root'
    ) {
      block = block.getParent()
    }
    offset = getBlockOffset(block, anchorNode, selection.anchor.offset)
  })
  return offset
}
