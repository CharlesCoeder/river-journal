/**
 * sentenceSegmentation — pure, DOM-free helpers for per-sentence focus mode.
 *
 * These are the linchpin logic for Story 2.11. Keeping them pure (no Lexical DOM,
 * no editor state) makes the tricky boundary rules exhaustively unit-testable —
 * this is where the "delay bug" fix lives (see `activeSentence`).
 *
 * `getBlockOffset` is the one Lexical-aware helper; it takes Lexical nodes but
 * only uses type-only imports (erased at build time) plus duck-typed traversal,
 * so the module pulls in no runtime Lexical/DOM dependency.
 *
 * Future: per-word focus (out of scope here) reuses this machinery by swapping
 * the Segmenter granularity to 'word'. The segmenter creation below is factored
 * so a granularity parameter can be threaded later without restructuring callers.
 */

import type { LexicalNode } from 'lexical'

/** [start, end) character offsets in the block's text. */
export interface SentenceSpan {
  start: number
  end: number
}

// ─── Cached Intl.Segmenter ──────────────────────────────────────────────────
// One module-level instance — constructing a Segmenter is comparatively costly
// and we call segmentSentences on every re-partition / selection change.
let sentenceSegmenter: Intl.Segmenter | null = null

function getSentenceSegmenter(): Intl.Segmenter {
  if (sentenceSegmenter === null) {
    sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
  }
  return sentenceSegmenter
}

// ─── Abbreviation suppression ───────────────────────────────────────────────
// The standard Intl.Segmenter does NOT suppress abbreviations — it splits
// "Dr. Smith went home." into "Dr. " + "Smith went home." (ICU sentence
// suppression data is not exposed through the JS API). We layer a small curated
// merge on top so common titles/abbreviations don't create false sentence
// boundaries (AC 16). This intentionally errs toward NOT splitting on a known
// abbreviation; unknown tokens segment normally.
const ABBREVIATIONS = new Set<string>([
  // Personal / professional titles
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'rev',
  'hon',
  'fr',
  // Military / civic ranks & roles
  'lt',
  'col',
  'gen',
  'capt',
  'sgt',
  'cmdr',
  'gov',
  'pres',
  'sen',
  'rep',
  'supt',
  // Latin / editorial
  'e.g',
  'i.e',
  'etc',
  'al',
  'cf',
  'vs',
  'viz',
  // Time
  'a.m',
  'p.m',
  // Business / place
  'inc',
  'ltd',
  'co',
  'corp',
  'no',
  'vol',
  'pp',
  'fig',
  'dept',
  'univ',
  'ave',
  'blvd',
  'rd',
])

/**
 * Does this string end with a known abbreviation + period (optionally followed
 * by whitespace)? If so its trailing period is NOT a real sentence terminator.
 */
function endsWithAbbreviation(segment: string): boolean {
  const match = /([A-Za-z][A-Za-z.]*)\.\s*$/.exec(segment)
  if (match === null) return false
  // Group 1 is mandatory in the pattern, so a successful match always captures it.
  return ABBREVIATIONS.has(match[1]!.toLowerCase())
}

// ─── Terminator-split refinement ────────────────────────────────────────────
// The inverse of the abbreviation merge. Intl.Segmenter does NOT start a new
// sentence when the next one begins with a LOWERCASE letter (e.g. casual
// journaling: "i went home. then i slept." is ONE ICU segment). We refine each
// ICU span by splitting at internal "terminator + optional closer + whitespace"
// boundaries that ICU missed — guarded against ellipses, decimals, and
// abbreviations so `...`, `3.14`, and `Dr.` never split mid-sentence.
const TERMINATOR_BOUNDARY = /[.!?]+['")\]]*\s+/g

/** Push the boundary-aligned sub-spans of `span` into `out`. */
function splitSpanAtTerminators(text: string, span: SentenceSpan, out: SentenceSpan[]): void {
  const seg = text.slice(span.start, span.end)
  let lastCut = 0
  TERMINATOR_BOUNDARY.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TERMINATOR_BOUNDARY.exec(seg)) !== null) {
    const termRun = /^[.!?]+/.exec(match[0])![0]
    const boundaryLocal = match.index + match[0].length
    // A terminator at the very end of this span has no following sentence here.
    if (boundaryLocal >= seg.length) continue
    // Ellipsis ("..", "...", "…"-as-dots) is a trailing-off, not a sentence end.
    if (/^\.{2,}$/.test(termRun)) continue
    // A period closing a known abbreviation (e.g. "Dr.") is not a sentence end.
    if (endsWithAbbreviation(seg.slice(0, boundaryLocal))) continue
    out.push({ start: span.start + lastCut, end: span.start + boundaryLocal })
    lastCut = boundaryLocal
  }
  out.push({ start: span.start + lastCut, end: span.end })
}

/**
 * Locale-aware sentence boundaries via a cached Intl.Segmenter, with curated
 * abbreviation suppression layered on top.
 *
 * Guarantees: the returned spans are contiguous and cover the full text length
 * (`spans[0].start === 0`, `spans[i].end === spans[i+1].start`, last `.end ===
 * text.length`). Empty string → `[]`.
 */
export function segmentSentences(text: string): SentenceSpan[] {
  if (text.length === 0) return []

  // Raw ICU segments (contiguous, full-coverage), as [start, end) spans.
  const raw: SentenceSpan[] = []
  for (const { segment, index } of getSentenceSegmenter().segment(text)) {
    raw.push({ start: index, end: index + segment.length })
  }

  // Merge any segment that ends with a known abbreviation into the next one
  // (fixes ICU OVER-splitting, e.g. "Dr. Smith").
  const merged: SentenceSpan[] = []
  for (let i = 0; i < raw.length; i++) {
    const span = raw[i]! // i < raw.length ⇒ always present
    const prev = merged[merged.length - 1] // undefined when merged is empty
    if (prev && endsWithAbbreviation(text.slice(prev.start, prev.end))) {
      // Previous merged span was an abbreviation tail → absorb the current span.
      merged[merged.length - 1] = { start: prev.start, end: span.end }
    } else {
      merged.push({ start: span.start, end: span.end })
    }
  }

  // Refine each span by splitting at terminator boundaries ICU missed (fixes ICU
  // UNDER-splitting on lowercase sentence starts — the common journaling case).
  const refined: SentenceSpan[] = []
  for (const span of merged) {
    splitSpanAtTerminators(text, span, refined)
  }

  return refined
}

/**
 * Returns the span of the sentence the cursor is actively writing, or `null`
 * when the cursor sits just past a COMPLETED sentence (terminator + optional
 * closer + REQUIRED trailing whitespace).
 *
 * This boundary rule is the fix for the "delay bug": typing `Hello world.` then
 * a space immediately dims the just-finished sentence (returns `null`) instead
 * of waiting for the first character of the next sentence. The trailing
 * whitespace is REQUIRED so a bare terminator (`...`, decimals, `?!` mid-token)
 * keeps the sentence active.
 */
export function activeSentence(text: string, cursor: number): SentenceSpan | null {
  const spans = segmentSentences(text)

  for (let i = 0; i < spans.length; i++) {
    const { start, end } = spans[i]! // i < spans.length ⇒ always present
    const isLastSegment = i === spans.length - 1

    if (cursor < start) break // gone past — nothing matches

    const inside = cursor < end || (cursor === end && isLastSegment)
    if (inside) {
      const head = text.slice(start, cursor)
      // Terminator(s) + optional closing quote/bracket + REQUIRED whitespace
      // ⇒ the sentence is complete; dim it (no active sentence).
      if (/[.!?…]+['")\]]*\s+$/.test(head)) return null
      return { start, end }
    }
    // cursor === end on a non-last segment: the boundary belongs to the next
    // sentence's start — fall through to the next iteration.
  }

  return null
}

/**
 * Cumulative character offset of the selection anchor within `blockNode`.
 *
 * Required because formatting (bold/italic) and our own SentenceNode wrappers
 * split a sentence's text across multiple descendant nodes, so the raw
 * `anchor.offset` (which is local to a single TextNode) is NOT the block offset
 * sentence segmentation needs.
 *
 * Walks the block's descendants in document order, summing the text size of
 * every leaf encountered before the anchor node, then adds `anchorOffset`.
 * Duck-typed (`getChildren`) so it needs no runtime Lexical import and is
 * trivially unit-testable with lightweight stand-ins.
 */
export function getBlockOffset(
  blockNode: LexicalNode,
  anchorNode: LexicalNode,
  anchorOffset: number
): number {
  const anchorKey = anchorNode.getKey()
  let offset = 0
  let found = false

  const visit = (node: LexicalNode): void => {
    if (found) return
    if (node.getKey() === anchorKey) {
      const maybeAnchorEl = node as unknown as { getChildren?: () => LexicalNode[] }
      if (typeof maybeAnchorEl.getChildren === 'function') {
        // Element anchor: `anchorOffset` is a CHILD INDEX, not a character
        // offset, so sum the text size of the first `anchorOffset` children.
        const kids = maybeAnchorEl.getChildren()
        for (let i = 0; i < anchorOffset && i < kids.length; i++) {
          offset += kids[i]!.getTextContentSize() // i < kids.length ⇒ present
        }
      } else {
        // Text/leaf anchor: `anchorOffset` is a character offset.
        offset += anchorOffset
      }
      found = true
      return
    }
    const maybeElement = node as unknown as { getChildren?: () => LexicalNode[] }
    if (typeof maybeElement.getChildren === 'function') {
      for (const child of maybeElement.getChildren()) {
        visit(child)
        if (found) return
      }
    } else {
      offset += node.getTextContentSize()
    }
  }

  const blockElement = blockNode as unknown as { getChildren?: () => LexicalNode[] }
  if (typeof blockElement.getChildren === 'function') {
    for (const child of blockElement.getChildren()) {
      visit(child)
      if (found) break
    }
  }

  // Anchor not found among descendants (e.g. anchor is the block element itself,
  // or an empty block) — fall back to the accumulated offset plus the raw offset.
  return found ? offset : offset + anchorOffset
}
