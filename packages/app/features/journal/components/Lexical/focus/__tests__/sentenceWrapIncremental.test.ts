// @vitest-environment happy-dom
// Regression: incremental (character-by-character) typing must re-partition.
//
// A Lexical node transform only fires when a node's DIRECT children change.
// Once a block is wrapped (block > sentence > text), typing into the grandchild
// TextNode does NOT re-fire the block transform, so the block never re-splits
// when a new sentence boundary appears mid-typing. The TextNode transform fixes
// this. This test reproduces the live bug by typing one character at a time.

import { afterEach, describe, expect, it } from 'vitest'
import {
  createEditor,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  ParagraphNode,
  TextNode,
  type LexicalEditor,
  type ElementNode,
  type TextNode as TextNodeType,
} from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode } from '@lexical/list'
import { createBaseLexicalConfig } from '../../lexical-config'
import { reconcileBlockSentences, topLevelBlockOf, isWrappableBlock } from '../sentenceWrap'

let rootEl: HTMLElement | null = null

afterEach(() => {
  if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl)
  rootEl = null
})

/** Register the SAME transforms SentenceWrapPlugin registers. */
function makeWrappingEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'rj-test',
    nodes: createBaseLexicalConfig().nodes,
    onError: (e) => {
      throw e
    },
  })
  rootEl = document.createElement('div')
  document.body.appendChild(rootEl)
  editor.setRootElement(rootEl)

  const blockTransform = (node: ElementNode) => {
    if (editor.isComposing()) return
    reconcileBlockSentences(node)
  }
  const textTransform = (node: TextNodeType) => {
    if (editor.isComposing()) return
    const block = topLevelBlockOf(node)
    if (block !== null && isWrappableBlock(block)) reconcileBlockSentences(block)
  }
  editor.registerNodeTransform(ParagraphNode, blockTransform)
  editor.registerNodeTransform(HeadingNode, blockTransform)
  editor.registerNodeTransform(QuoteNode, blockTransform)
  editor.registerNodeTransform(ListItemNode, blockTransform)
  editor.registerNodeTransform(TextNode, textTransform)
  return editor
}

function typeChar(editor: LexicalEditor, ch: string): void {
  editor.update(
    () => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) selection.insertText(ch)
    },
    { discrete: true }
  )
}

function firstSentenceKey(editor: LexicalEditor): string | null {
  let key: string | null = null
  editor.getEditorState().read(() => {
    const p = $getRoot().getFirstChild() as ElementNode
    for (const child of p.getChildren()) {
      if (child.getType() === 'sentence') {
        key = child.getKey()
        break
      }
    }
  })
  return key
}

function sentenceTexts(editor: LexicalEditor): string[] {
  const out: string[] = []
  editor.getEditorState().read(() => {
    const p = $getRoot().getFirstChild() as ElementNode
    for (const child of p.getChildren()) {
      if (child.getType() === 'sentence') out.push(child.getTextContent())
    }
  })
  return out
}

describe('incremental typing re-partitions (live-bug regression)', () => {
  it('typing "okay. well" one char at a time ends with two sentence nodes', () => {
    const editor = makeWrappingEditor()
    editor.update(
      () => {
        const p = $createParagraphNode()
        p.append($createTextNode(''))
        $getRoot().append(p)
        p.selectEnd()
      },
      { discrete: true }
    )

    for (const ch of 'okay. well') typeChar(editor, ch)

    // The block was wrapped after the first character; the boundary that
    // appears at "okay. w" must STILL split it despite the nested TextNode.
    expect(sentenceTexts(editor)).toEqual(['okay. ', 'well'])
  })

  it('preserves earlier sentence wrappers across re-partition (no-flash guarantee)', () => {
    // The visible flash came from rebuilding EVERY sentence wrapper on each
    // re-partition (new DOM keys). Earlier (dimmed) sentences must keep their
    // node key so their DOM persists and never flashes.
    const editor = makeWrappingEditor()
    editor.update(
      () => {
        const p = $createParagraphNode()
        p.append($createTextNode(''))
        $getRoot().append(p)
        p.selectEnd()
      },
      { discrete: true }
    )

    for (const ch of 'one. two. ') typeChar(editor, ch)
    expect(sentenceTexts(editor)).toEqual(['one. ', 'two. '])

    const keyBefore = firstSentenceKey(editor)

    // Keep typing a third sentence — this re-partitions the tail repeatedly.
    for (const ch of 'three is here') typeChar(editor, ch)
    expect(sentenceTexts(editor)).toEqual(['one. ', 'two. ', 'three is here'])

    // The first sentence's wrapper (a dimmed sentence) must be the SAME node —
    // unchanged key ⇒ its DOM element persists ⇒ no flash.
    expect(firstSentenceKey(editor)).toBe(keyBefore)
  })

  it('preserves the just-completed sentence wrapper when the next sentence begins', () => {
    // The reported flash: finishing "one. " then typing the first char of the
    // next sentence momentarily put "one. t" in ONE wrapper; rebuilding split it
    // into two NEW wrappers, so the completed sentence flashed. Positional reuse
    // must keep the completed sentence in its ORIGINAL wrapper (DOM persists →
    // it merely fades to dim, no flash).
    const editor = makeWrappingEditor()
    editor.update(
      () => {
        const p = $createParagraphNode()
        p.append($createTextNode(''))
        $getRoot().append(p)
        p.selectEnd()
      },
      { discrete: true }
    )

    for (const ch of 'one. ') typeChar(editor, ch)
    expect(sentenceTexts(editor)).toEqual(['one. '])
    const completedKey = firstSentenceKey(editor)

    // Type the first character of the next sentence → a new boundary appears.
    typeChar(editor, 't')
    expect(sentenceTexts(editor)).toEqual(['one. ', 't'])

    // The completed sentence ("one. ") must still be the SAME wrapper node.
    expect(firstSentenceKey(editor)).toBe(completedKey)
  })

  it('typing three sentences incrementally yields three sentence nodes', () => {
    const editor = makeWrappingEditor()
    editor.update(
      () => {
        const p = $createParagraphNode()
        p.append($createTextNode(''))
        $getRoot().append(p)
        p.selectEnd()
      },
      { discrete: true }
    )

    for (const ch of 'one. two. three') typeChar(editor, ch)

    expect(sentenceTexts(editor)).toEqual(['one. ', 'two. ', 'three'])
  })
})
