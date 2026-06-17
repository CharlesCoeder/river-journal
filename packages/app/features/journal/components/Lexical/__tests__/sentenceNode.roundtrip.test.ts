// @vitest-environment happy-dom
// SentenceNode markdown round-trip + history-merge + cross-mode cleanup.
// Story 2.11 — AC 6, 17, 18, 20. This is the DATA-LOSS GATE: a custom inline
// ElementNode with no transformer is silently dropped by
// $convertToMarkdownString. SENTENCE_TRANSFORMER must keep markdown identical.

import { describe, expect, it } from 'vitest'
import {
  createEditor,
  $getRoot,
  $isElementNode,
  UNDO_COMMAND,
  type LexicalEditor,
  type ElementNode,
} from 'lexical'
import { registerHistory, createEmptyHistoryState } from '@lexical/history'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { createBaseLexicalConfig } from '../lexical-config'
import { ALL_TRANSFORMERS } from '../transformers'
import { reconcileBlockSentences, unwrapBlockSentences } from '../focus/sentenceWrap'

function makeEditor(): LexicalEditor {
  return createEditor({
    namespace: 'rj-test',
    nodes: createBaseLexicalConfig().nodes,
    onError: (e) => {
      throw e
    },
  })
}

function importMarkdown(editor: LexicalEditor, md: string): void {
  editor.update(
    () => {
      $convertFromMarkdownString(md, ALL_TRANSFORMERS, undefined, true)
    },
    { discrete: true }
  )
}

function exportMarkdown(editor: LexicalEditor): string {
  // Mirror production (LexicalEditor.native.tsx) — shouldPreserveNewLines=true,
  // which round-trips hard line breaks symmetrically with the import flag.
  let out = ''
  editor.getEditorState().read(() => {
    out = $convertToMarkdownString(ALL_TRANSFORMERS, undefined, true)
  })
  return out
}

function wrap(editor: LexicalEditor): void {
  editor.update(
    () => {
      for (const block of $getRoot().getChildren()) {
        if ($isElementNode(block) && !block.isInline()) {
          // recurse one level so list items inside a ListNode get wrapped too
          if (block.getType() === 'list') {
            for (const item of block.getChildren()) {
              if ($isElementNode(item)) reconcileBlockSentences(item as ElementNode)
            }
          } else {
            reconcileBlockSentences(block as ElementNode)
          }
        }
      }
    },
    { discrete: true, tag: 'history-merge' }
  )
}

function unwrap(editor: LexicalEditor): void {
  editor.update(
    () => {
      const recurse = (node: ElementNode) => {
        for (const child of node.getChildren()) {
          if ($isElementNode(child) && !child.isInline()) recurse(child as ElementNode)
        }
        unwrapBlockSentences(node)
      }
      for (const block of $getRoot().getChildren()) {
        if ($isElementNode(block) && !block.isInline()) recurse(block as ElementNode)
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

// =============================================================================
// AC 17 — markdown round-trip is byte-identical with sentence wrapping applied
// =============================================================================

const ROUND_TRIP_CASES: Record<string, string> = {
  plain: 'Hello world. This is a test.',
  'multi-paragraph': 'First para. Two sentences.\n\nSecond para here.',
  bold: 'A sentence with **bold** word. Next one.',
  italic: 'A sentence with *italic* word. Next.',
  list: '- one\n- two\n- three',
  heading: '# Heading here\n\nBody sentence.',
  link: 'See [the link](https://example.com) now. Done.',
  'line break': 'Line one.  \nLine two. Done.',
}

describe('SentenceNode markdown round-trip — data-loss gate (AC 6, 17)', () => {
  for (const [name, md] of Object.entries(ROUND_TRIP_CASES)) {
    it(`[${name}] markdown is byte-identical after sentence wrapping`, () => {
      const editor = makeEditor()
      importMarkdown(editor, md)
      const baseline = exportMarkdown(editor)
      // Sanity: the imported markdown itself round-trips to the canonical form.
      expect(baseline).toBe(md)

      wrap(editor)
      const wrapped = exportMarkdown(editor)
      // The GATE: wrapping must NOT change the serialized markdown (no data loss).
      expect(wrapped).toBe(md)
    })
  }

  it('wrapping actually inserts SentenceNodes (the gate is meaningful, not vacuous)', () => {
    const editor = makeEditor()
    importMarkdown(editor, 'One sentence. Two sentence. Three.')
    expect(countSentenceNodes(editor)).toBe(0)
    wrap(editor)
    expect(countSentenceNodes(editor)).toBe(3)
  })
})

// =============================================================================
// AC 18 — history merge: wrapping adds no undo step
// =============================================================================

describe('SentenceNode wrapping is history-merged (AC 18)', () => {
  it('a single UNDO reverts the user text edit, not the wrapping step', () => {
    const editor = makeEditor()
    const historyState = createEmptyHistoryState()
    const unregister = registerHistory(editor, historyState, 300)

    // Seed initial content as a NON-undoable baseline.
    importMarkdown(editor, 'Hello.')

    // User edit (undoable): append a second sentence.
    editor.update(
      () => {
        const first = $getRoot().getFirstChild() as ElementNode
        const textNode = first.getFirstChild() as any
        textNode.setTextContent('Hello. World.')
      },
      { discrete: true }
    )
    expect(exportMarkdown(editor)).toBe('Hello. World.')

    // Wrapping (history-merged) — must add NO undo step.
    wrap(editor)
    expect(countSentenceNodes(editor)).toBeGreaterThan(0)

    // One undo reverts the *text edit*, returning to the seeded baseline.
    editor.dispatchCommand(UNDO_COMMAND, undefined)
    editor.update(() => {}, { discrete: true }) // flush
    expect(exportMarkdown(editor)).toBe('Hello.')

    unregister()
  })
})

// =============================================================================
// AC 20 — cross-mode cleanup: no SentenceNode survives unwrap
// =============================================================================

describe('Cross-mode cleanup leaves zero SentenceNodes (AC 20)', () => {
  it('unwrap removes every SentenceNode and markdown is unchanged', () => {
    const editor = makeEditor()
    const md = 'First sentence. Second sentence.\n\nThird para here.'
    importMarkdown(editor, md)

    wrap(editor)
    expect(countSentenceNodes(editor)).toBeGreaterThan(0)

    unwrap(editor)
    expect(countSentenceNodes(editor)).toBe(0)
    expect(exportMarkdown(editor)).toBe(md)

    // The serialized editorState JSON must contain zero "sentence" nodes.
    const json = JSON.stringify(editor.getEditorState().toJSON())
    expect(json).not.toContain('"type":"sentence"')
  })
})
