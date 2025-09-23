import { LineBreakNode, $createLineBreakNode } from 'lexical';
import { TRANSFORMERS as DEFAULT_TRANSFORMERS } from '@lexical/markdown';
import type { TextMatchTransformer, Transformer } from '@lexical/markdown';

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

// Place custom transformers in an array. They will run first.
const CUSTOM_TRANSFORMERS: Transformer[] = [
  LINEBREAK_TRANSFORMER,
];

// Combine custom transformers with the default ones.
// CUSTOM TRANSFORMERS MUST COME FIRST to override the default behavior.
export const ALL_TRANSFORMERS: Transformer[] = [...CUSTOM_TRANSFORMERS, ...DEFAULT_TRANSFORMERS];
