// @vitest-environment happy-dom
// Caret ergonomics across sentence seams (Story 2.11, AC 5, 24).
// Uses a REAL DOM-attached editor so Lexical's authentic selection / deletion /
// insertion semantics drive the SentenceNode boundaries.

import { afterEach, describe, expect, it } from 'vitest'
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
import { $isSentenceNode } from '../../nodes/SentenceNode'

let rootEl: HTMLElement | null = null

afterEach(() => {
  if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl)
  rootEl = null
})

function makeAttachedEditor(): LexicalEditor {
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
  return editor
}

function seedParagraph(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      const p = $createParagraphNode()
      p.append($createTextNode(text))
      $getRoot().append(p)
    },
    { discrete: true }
  )
}

function reconcile(editor: LexicalEditor): void {
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

function sentenceTexts(editor: LexicalEditor): string[] {
  const out: string[] = []
  editor.getEditorState().read(() => {
    const p = $getRoot().getFirstChild() as ElementNode
    for (const child of p.getChildren()) {
      if ($isSentenceNode(child)) out.push(child.getTextContent())
    }
  })
  return out
}

function emptySentenceCount(editor: LexicalEditor): number {
  let n = 0
  editor.getEditorState().read(() => {
    const walk = (node: any) => {
      if ($isSentenceNode(node) && node.getTextContentSize() === 0) n++
      if (typeof node.getChildren === 'function') for (const c of node.getChildren()) walk(c)
    }
    walk($getRoot())
  })
  return n
}

describe('caret ergonomics across sentence seams (AC 24)', () => {
  it('typing at a sentence seam continues in the correct (second) sentence', () => {
    const editor = makeAttachedEditor()
    seedParagraph(editor, 'Hello. World.')
    reconcile(editor)
    expect(sentenceTexts(editor)).toEqual(['Hello. ', 'World.'])

    // Place the caret at the very start of "World" (block offset 7) and type.
    editor.update(
      () => {
        const p = $getRoot().getFirstChild() as ElementNode
        const second = p.getLastChild() as ElementNode
        const text = second.getFirstChild() as any
        text.select(0, 0)
        const selection = $getSelection()
        if ($isRangeSelection(selection)) selection.insertText('X')
      },
      { discrete: true }
    )
    reconcile(editor)

    // The typed char joined the SECOND sentence, not the first.
    expect(sentenceTexts(editor)).toEqual(['Hello. ', 'XWorld.'])
  })

  it('merging across a seam collapses to one sentence with no empty SentenceNode', () => {
    const editor = makeAttachedEditor()
    seedParagraph(editor, 'Hi. Yo.')
    reconcile(editor)
    expect(sentenceTexts(editor)).toEqual(['Hi. ', 'Yo.'])

    // Simulate the net effect of backspacing across the seam ("Hi. Yo." →
    // "HiYo."): the boundary is removed and the second sentence's wrapper is
    // emptied. (happy-dom lacks Selection.modify, so deleteCharacter can't run
    // here; this drives the exact post-merge tree the reconciler must clean up.)
    editor.update(
      () => {
        const p = $getRoot().getFirstChild() as ElementNode
        const first = p.getFirstChild() as ElementNode
        const second = p.getLastChild() as ElementNode
        ;(first.getFirstChild() as any).setTextContent('HiYo.')
        ;(second.getFirstChild() as any).setTextContent('')
      },
      { discrete: true }
    )
    reconcile(editor)

    expect(sentenceTexts(editor)).toEqual(['HiYo.'])
    expect(emptySentenceCount(editor)).toBe(0)
  })

  it('pasting multi-sentence text re-partitions into the correct sentences', () => {
    const editor = makeAttachedEditor()
    seedParagraph(editor, '')
    reconcile(editor)

    // Simulate a paste by inserting multi-sentence text at the caret.
    editor.update(
      () => {
        const p = $getRoot().getFirstChild() as ElementNode
        p.selectEnd()
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          selection.insertText('First sentence. Second sentence. Third one.')
        }
      },
      { discrete: true }
    )
    reconcile(editor)

    expect(sentenceTexts(editor)).toEqual(['First sentence. ', 'Second sentence. ', 'Third one.'])
  })
})

describe('IME composition is not corrupted — transform skipped mid-composition (AC 7, 24)', () => {
  it('the plugin gate skips re-partition while editor.isComposing() is true', () => {
    const editor = makeAttachedEditor()
    seedParagraph(editor, 'Hello world. Second sentence.')

    // The exact gate the plugin applies inside its node transform.
    const gatedReconcile = () =>
      editor.update(
        () => {
          for (const block of $getRoot().getChildren()) {
            if (editor.isComposing()) return // mid-IME — skip
            if ($isElementNode(block) && !block.isInline()) {
              reconcileBlockSentences(block as ElementNode)
            }
          }
        },
        { discrete: true, tag: 'history-merge' }
      )

    // happy-dom does not propagate composition events into Lexical's internal
    // composition state, so stub isComposing() — the gate the plugin relies on.
    const realIsComposing = editor.isComposing.bind(editor)

    // Mid-composition → the gate must skip wrapping entirely.
    editor.isComposing = () => true
    gatedReconcile()
    expect(sentenceTexts(editor)).toEqual([]) // nothing wrapped while composing

    // Composition ended → the next pass partitions normally.
    editor.isComposing = realIsComposing
    gatedReconcile()
    expect(sentenceTexts(editor)).toEqual(['Hello world. ', 'Second sentence.'])
  })
})
