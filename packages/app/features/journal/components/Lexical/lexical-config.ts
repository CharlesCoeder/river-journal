import type { InitialConfigType } from '@lexical/react/LexicalComposer'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { CodeHighlightNode, CodeNode } from '@lexical/code'
import { LinkNode } from '@lexical/link'

/**
 * Base Lexical editor configuration with minimal setup for MVP
 * Includes nodes required for markdown transformers
 */
export const createBaseLexicalConfig = (): InitialConfigType => {
  return {
    namespace: 'RiverJournalEditor',
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      CodeNode,
      CodeHighlightNode,
      LinkNode,
    ],
    theme: {
      // Lexical class mappings; styled via Tamagui CSS variables in lexical-theme.css
      root: 'lex-root',
      paragraph: 'lex-paragraph',
      heading: {
        h1: 'lex-heading-h1',
        h2: 'lex-heading-h2',
        h3: 'lex-heading-h3',
        h4: 'lex-heading-h4',
        h5: 'lex-heading-h5',
        h6: 'lex-heading-h6',
      },
      quote: 'lex-quote',
      list: {
        nested: {
          listitem: 'lex-nested-listitem',
        },
        ol: 'lex-list-ol',
        ul: 'lex-list-ul',
        listitem: 'lex-listitem',
      },
      code: 'lex-code',
      codeHighlight: {
        atrule: 'lex-token-atrule',
        attr: 'lex-token-attr',
        boolean: 'lex-token-boolean',
        builtin: 'lex-token-builtin',
        cdata: 'lex-token-cdata',
        char: 'lex-token-char',
        class: 'lex-token-class',
        'class-name': 'lex-token-class-name',
        comment: 'lex-token-comment',
        constant: 'lex-token-constant',
        deleted: 'lex-token-deleted',
        doctype: 'lex-token-doctype',
        entity: 'lex-token-entity',
        function: 'lex-token-function',
        important: 'lex-token-important',
        inserted: 'lex-token-inserted',
        keyword: 'lex-token-keyword',
        namespace: 'lex-token-namespace',
        number: 'lex-token-number',
        operator: 'lex-token-operator',
        prolog: 'lex-token-prolog',
        property: 'lex-token-property',
        punctuation: 'lex-token-punctuation',
        regex: 'lex-token-regex',
        selector: 'lex-token-selector',
        string: 'lex-token-string',
        symbol: 'lex-token-symbol',
        tag: 'lex-token-tag',
        url: 'lex-token-url',
        variable: 'lex-token-variable',
      },
      link: 'lex-link',
      text: {
        bold: 'lex-text-bold',
        italic: 'lex-text-italic',
        underline: 'lex-text-underline',
        strikethrough: 'lex-text-strikethrough',
        code: 'lex-text-code',
      },
    },
    onError: (error: Error) => {
      console.error('Lexical Editor Error:', error)
    },
    // Start with empty editor state
    editorState: null,
  }
}
