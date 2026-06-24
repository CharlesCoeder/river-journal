// @vitest-environment happy-dom
// Pure unit tests for the sentence-segmentation core (Story 2.11, AC 4, 12, 16).
//
// segmentSentences / activeSentence are fully pure (no Lexical, no DOM).
// getBlockOffset is exercised against a real headless Lexical editor so the
// multi-TextNode case (bold/italic splitting a sentence) is covered for real.

import { describe, expect, it } from 'vitest'
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from 'lexical'
import { createBaseLexicalConfig } from '../../lexical-config'
import { segmentSentences, activeSentence, getBlockOffset } from '../sentenceSegmentation'

// =============================================================================
// segmentSentences (AC 16)
// =============================================================================

describe('segmentSentences (AC 16)', () => {
  it('empty string → []', () => {
    expect(segmentSentences('')).toEqual([])
  })

  it('splits a simple two-sentence string', () => {
    expect(segmentSentences('Hello. World')).toEqual([
      { start: 0, end: 7 },
      { start: 7, end: 12 },
    ])
  })

  it('does NOT split a known abbreviation ("Dr. Smith went home." is one sentence)', () => {
    expect(segmentSentences('Dr. Smith went home.')).toEqual([{ start: 0, end: 20 }])
  })

  it('keeps a multi-terminator token together ("Wait... really?!")', () => {
    expect(segmentSentences('Wait... really?!')).toEqual([{ start: 0, end: 16 }])
  })

  it('splits LOWERCASE-continuation sentences ICU leaves merged (journaling case)', () => {
    // ICU keeps "i went home. then i slept. done" as ONE segment (no capital
    // after the period). The terminator-split refinement must still break it.
    expect(segmentSentences('i went home. then i slept. done')).toEqual([
      { start: 0, end: 13 }, // "i went home. "
      { start: 13, end: 27 }, // "then i slept. "
      { start: 27, end: 31 }, // "done"
    ])
  })

  it('splits a lowercase question-mark boundary but not an ellipsis or decimal', () => {
    expect(segmentSentences('really? yes')).toEqual([
      { start: 0, end: 8 },
      { start: 8, end: 11 },
    ])
    // Ellipsis trailing-off stays one sentence.
    expect(segmentSentences('well... maybe')).toEqual([{ start: 0, end: 13 }])
    // Decimal is not a boundary (no whitespace after the dot).
    expect(segmentSentences('it cost 3.50 today')).toEqual([{ start: 0, end: 18 }])
  })

  it('spans are contiguous and cover the full text length', () => {
    const text = 'One. Two. Three.'
    const spans = segmentSentences(text)
    expect(spans[0]!.start).toBe(0)
    expect(spans[spans.length - 1]!.end).toBe(text.length)
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.start).toBe(spans[i - 1]!.end)
    }
  })
})

// =============================================================================
// activeSentence (AC 4, 16)
// =============================================================================

describe('activeSentence (AC 4, 16)', () => {
  it('DELAY-BUG: dims on the space after a period — activeSentence("Hello world. ", 13) === null', () => {
    expect(activeSentence('Hello world. ', 13)).toBeNull()
  })

  it('bare period (no space) keeps the sentence active — activeSentence("Hello world.", 12) === {0,12}', () => {
    expect(activeSentence('Hello world.', 12)).toEqual({ start: 0, end: 12 })
  })

  it('boundary fall-through: activeSentence("Hello. World", 7) returns the "World" span, not null', () => {
    expect(activeSentence('Hello. World', 7)).toEqual({ start: 7, end: 12 })
  })

  it('mid-sentence cursor returns that sentence span', () => {
    expect(activeSentence('Hello world.', 5)).toEqual({ start: 0, end: 12 })
  })

  it('multiple terminators stay active mid-token (... composes)', () => {
    expect(activeSentence('Wait... really?!', 6)).toEqual({ start: 0, end: 16 })
  })

  it('abbreviation: cursor inside "Dr. Smith went home." stays one active span', () => {
    expect(activeSentence('Dr. Smith went home.', 5)).toEqual({ start: 0, end: 20 })
  })

  it('empty string → null', () => {
    expect(activeSentence('', 0)).toBeNull()
  })

  it('cursor at absolute end of a completed last sentence (terminator + space) → null', () => {
    expect(activeSentence('Done. ', 6)).toBeNull()
  })

  it('cursor at end of a bare-terminator last sentence (no trailing space) stays active', () => {
    expect(activeSentence('Done.', 5)).toEqual({ start: 0, end: 5 })
  })
})

// =============================================================================
// getBlockOffset (AC 12) — real headless Lexical editor, multi-TextNode block
// =============================================================================

describe('getBlockOffset (AC 12)', () => {
  it('sums preceding TextNode sizes + anchorOffset across a mixed-format block', () => {
    const editor = createEditor({
      namespace: 'rj-test',
      nodes: createBaseLexicalConfig().nodes,
      onError: (e) => {
        throw e
      },
    })

    let result = -1
    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        const plain = $createTextNode('Hello ') // len 6
        const bold = $createTextNode('world').setFormat('bold') // len 5
        const tail = $createTextNode(' again.') // len 7
        paragraph.append(plain, bold, tail)
        $getRoot().append(paragraph)

        // Cursor 3 chars into the trailing TextNode → 6 + 5 + 3 = 14
        result = getBlockOffset(paragraph, tail, 3)
      },
      { discrete: true }
    )

    expect(result).toBe(14)
  })

  it('returns anchorOffset when the anchor is in the first child', () => {
    const editor = createEditor({
      namespace: 'rj-test',
      nodes: createBaseLexicalConfig().nodes,
      onError: (e) => {
        throw e
      },
    })

    let result = -1
    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        const first = $createTextNode('Hello ')
        const second = $createTextNode('world')
        paragraph.append(first, second)
        $getRoot().append(paragraph)

        result = getBlockOffset(paragraph, first, 2)
      },
      { discrete: true }
    )

    expect(result).toBe(2)
  })
})
