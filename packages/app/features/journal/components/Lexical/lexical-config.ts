import type { InitialConfigType } from '@lexical/react/LexicalComposer'

/**
 * Base Lexical editor configuration with minimal setup for MVP
 * No additional plugins included - just core functionality
 */
export const createBaseLexicalConfig = (): InitialConfigType => {
  return {
    namespace: 'RiverJournalEditor',
    theme: {
      // Lexical class mappings; styled via Tamagui CSS variables in lexical-theme.css
      root: 'lex-root',
      paragraph: 'lex-paragraph',
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
