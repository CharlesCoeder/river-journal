import { LineBreakNode, $createLineBreakNode } from 'lexical';
import { TRANSFORMERS as DEFAULT_TRANSFORMERS } from '@lexical/markdown';
import type { TextMatchTransformer, Transformer } from '@lexical/markdown';
import { SentenceNode, $isSentenceNode } from './nodes/SentenceNode';

/**
 * Converts markdown's hard break syntax back into a LineBreakNode.
 * Also handles exporting LineBreakNode back to markdown.
 * This preserves Shift+Enter line breaks properly.
 */
export const LINEBREAK_TRANSFORMER: TextMatchTransformer = {
  dependencies: [LineBreakNode],
  export: (node) => {
    return node.getType() === 'linebreak' ? '  \n' : null;
  },
  regExp: / {2}\n/,
  replace: (textNode, match) => {
    textNode.replace($createLineBreakNode());
  },
  trigger: '\n',
  type: 'text-match',
};

/**
 * Makes SentenceNode (Story 2.11) export-transparent. A custom inline
 * ElementNode with no transformer is silently DROPPED by
 * $convertToMarkdownString — which would delete the user's text. This emits the
 * node's children's markdown with no wrapper syntax, so markdown round-trips
 * byte-for-byte whether or not sentence wrapping is currently applied.
 *
 * It never matches on import (sentences are created at runtime by the node
 * transform, not parsed from markdown), so `regExp` is a never-match and
 * `replace` is a no-op. Mirrors the LINEBREAK_TRANSFORMER / built-in LINK
 * text-match transformer family.
 */
export const SENTENCE_TRANSFORMER: TextMatchTransformer = {
  dependencies: [SentenceNode],
  export: (node, exportChildren) =>
    $isSentenceNode(node) ? exportChildren(node) : null,
  regExp: /(?!)/, // never matches on import
  replace: () => {}, // no-op import
  trigger: '',
  type: 'text-match',
};

// Custom transformers run before the defaults (CUSTOM_TRANSFORMERS is spread
// first into ALL_TRANSFORMERS). SENTENCE_TRANSFORMER is placed first within the
// custom list so that, as $convertToMarkdownString walks each node, the
// SentenceNode is matched by this export-transparent transformer (emitting its
// children) before any default transformer encounters the unknown inline
// wrapper and drops it.
const CUSTOM_TRANSFORMERS: Transformer[] = [
  SENTENCE_TRANSFORMER,
  LINEBREAK_TRANSFORMER,
];

// Combine custom transformers with the default ones.
// CUSTOM TRANSFORMERS MUST COME FIRST to override the default behavior.
export const ALL_TRANSFORMERS: Transformer[] = [...CUSTOM_TRANSFORMERS, ...DEFAULT_TRANSFORMERS];
