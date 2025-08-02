import { InitialConfigType } from '@lexical/react/LexicalComposer'

/**
 * Base Lexical editor configuration with minimal setup for MVP
 * No additional plugins included - just core functionality
 */
export const createBaseLexicalConfig = (): InitialConfigType => {
  return {
    namespace: 'RiverJournalEditor',
    theme: {
      // Basic theme configuration - will be enhanced with Tamagui integration
      root: 'lexical-root',
      paragraph: 'lexical-paragraph',
    },
    onError: (error: Error) => {
      console.error('Lexical Editor Error:', error)
    },
    // Start with empty editor state
    editorState: null,
  }
} 