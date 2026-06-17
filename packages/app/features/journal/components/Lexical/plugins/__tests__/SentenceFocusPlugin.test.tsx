// @vitest-environment happy-dom
// Sentence styling smoke test (Story 2.11, AC 9, 11, 21).
// Drives applySentenceFocusClasses against a REAL DOM-attached editor so the
// class toggles are asserted on actual SentenceNode <span> elements — including
// the DOM-level delay-bug guard (space after a period dims the sentence).

import { afterEach, describe, expect, it } from 'vitest'
import {
  createEditor,
  $getRoot,
  $isElementNode,
  $createParagraphNode,
  $createTextNode,
  type LexicalEditor,
  type ElementNode,
} from 'lexical'
import { createBaseLexicalConfig } from '../../lexical-config'
import { reconcileBlockSentences } from '../../focus/sentenceWrap'
import { $isSentenceNode } from '../../nodes/SentenceNode'
import {
  applySentenceFocusClasses,
  CLASS_SENTENCE_ACTIVE,
  CLASS_SENTENCE_DIM,
} from '../SentenceFocusPlugin'

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

function wrap(editor: LexicalEditor): void {
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

/** Class state of each SentenceNode span in document order. */
function sentenceClasses(editor: LexicalEditor): Array<'active' | 'dim' | 'none'> {
  const result: Array<'active' | 'dim' | 'none'> = []
  editor.getEditorState().read(() => {
    for (const block of $getRoot().getChildren()) {
      if (!$isElementNode(block)) continue
      for (const child of block.getChildren()) {
        if (!$isSentenceNode(child)) continue
        const el = editor.getElementByKey(child.getKey())
        if (!el) {
          result.push('none')
        } else if (el.classList.contains(CLASS_SENTENCE_ACTIVE)) {
          result.push('active')
        } else if (el.classList.contains(CLASS_SENTENCE_DIM)) {
          result.push('dim')
        } else {
          result.push('none')
        }
      }
    }
  })
  return result
}

describe('SentenceFocusPlugin styling (AC 9, 11, 21)', () => {
  it('cursor in the first sentence → first active, second dim; moving to the second swaps', () => {
    const editor = makeAttachedEditor()
    editor.update(
      () => {
        const p = $createParagraphNode()
        p.append($createTextNode('Hello world. Second sentence.'))
        $getRoot().append(p)
      },
      { discrete: true }
    )
    wrap(editor)

    // Caret in the first sentence.
    editor.update(
      () => {
        const p = $getRoot().getFirstChild() as ElementNode
        const firstSentence = p.getFirstChild() as ElementNode
        const text = firstSentence.getFirstChild() as any
        text.select(3, 3)
      },
      { discrete: true }
    )
    applySentenceFocusClasses(editor)
    expect(sentenceClasses(editor)).toEqual(['active', 'dim'])

    // Move caret into the second sentence → classes swap.
    editor.update(
      () => {
        const p = $getRoot().getFirstChild() as ElementNode
        const secondSentence = p.getLastChild() as ElementNode
        const text = secondSentence.getFirstChild() as any
        text.select(2, 2)
      },
      { discrete: true }
    )
    applySentenceFocusClasses(editor)
    expect(sentenceClasses(editor)).toEqual(['dim', 'active'])
  })

  it('dims non-active sentences in an all-LOWERCASE paragraph (ICU under-split regression)', () => {
    // Regression: ICU keeps lowercase-continuation sentences merged, so casual
    // journaling showed no per-sentence dimming. The terminator-split refinement
    // must produce three sentences and dim the two the cursor is not in.
    const editor = makeAttachedEditor()
    editor.update(
      () => {
        const p = $createParagraphNode()
        p.append($createTextNode('but its doing the paragraph. but right now? not per sentence'))
        $getRoot().append(p)
      },
      { discrete: true }
    )
    wrap(editor)

    // Caret at the end → the last sentence is active, the first two dim.
    editor.update(
      () => {
        const p = $getRoot().getFirstChild() as ElementNode
        const last = p.getLastChild() as ElementNode
        const text = last.getFirstChild() as any
        text.select(text.getTextContentSize(), text.getTextContentSize())
      },
      { discrete: true }
    )
    applySentenceFocusClasses(editor)
    expect(sentenceClasses(editor)).toEqual(['dim', 'dim', 'active'])
  })

  it('DELAY-BUG GUARD: appending a space after a period dims the lone sentence', () => {
    const editor = makeAttachedEditor()
    editor.update(
      () => {
        const p = $createParagraphNode()
        p.append($createTextNode('Hello world.'))
        $getRoot().append(p)
      },
      { discrete: true }
    )
    wrap(editor)

    // Caret at the end of the bare-terminator sentence → still active.
    editor.update(
      () => {
        const p = $getRoot().getFirstChild() as ElementNode
        const sentence = p.getFirstChild() as ElementNode
        const text = sentence.getFirstChild() as any
        text.select(12, 12)
      },
      { discrete: true }
    )
    applySentenceFocusClasses(editor)
    expect(sentenceClasses(editor)).toEqual(['active'])

    // Type the space → "Hello world. " — the SAME span persists (still one
    // sentence, no boundary change) and must flip to dim the instant the space
    // lands, without waiting for the next character.
    editor.update(
      () => {
        const p = $getRoot().getFirstChild() as ElementNode
        const sentence = p.getFirstChild() as ElementNode
        const text = sentence.getFirstChild() as any
        text.setTextContent('Hello world. ')
        text.select(13, 13)
      },
      { discrete: true }
    )
    wrap(editor) // re-partition is a no-op here (still one sentence)
    applySentenceFocusClasses(editor)
    expect(sentenceClasses(editor)).toEqual(['dim'])
  })
})
