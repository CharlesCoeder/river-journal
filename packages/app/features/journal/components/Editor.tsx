import { View, useTheme } from '@my/ui'
import { useObserve } from '@legendapp/state/react'
import { useRef, useState } from 'react'
import type React from 'react'
import { useDebouncedCallback } from 'use-debounce'
import { Platform } from 'react-native'
import {
  journal$,
  updateActiveFlowContent,
  getActiveFlowContent,
} from '../../../state/journal/store'
import LexicalEditor from './Lexical/LexicalEditor'
import { LexicalSync } from './Lexical/LexicalSync'
import type { LexicalEditorUniversalProps } from './Lexical/LexicalEditor.types'

export const Editor = () => {
  const theme = useTheme()
  const isSyncingFromState = useRef(false)

  // Track current content for native sync
  const [nativeContent, setNativeContent] = useState(getActiveFlowContent())

  // Debounced function to update Legend State from editor changes
  const debouncedUpdateStore = useDebouncedCallback((markdown: string) => {
    console.log('2. Debounced update firing to store with markdown:', markdown)
    isSyncingFromState.current = true

    updateActiveFlowContent(markdown)

    // Reset the flag in the next browser paint cycle
    requestAnimationFrame(() => {
      isSyncingFromState.current = false
    })
  }, 300)

  // Handle content changes from the editor (native only)
  const handleContentChange = (markdown: string) => {
    console.log('1. Lexical content change detected (native):', markdown)
    debouncedUpdateStore(markdown)
  }

  // For native: sync from Legend State to local state (which triggers editor update)
  useObserve(journal$.activeFlow.content, ({ value }) => {
    console.log('3. ✅ Legend State Updated! New content:', value)

    // For native, update local state to trigger editor re-render with new content
    if (Platform.OS !== 'web' && !isSyncingFromState.current) {
      setNativeContent(value || '')
    }
  })

  const themeValues = {
    textColor: theme.color.val,
    placeholderColor: theme.placeholderColor.val,
  }

  // Cast to universal props to handle platform-specific prop differences
  const UniversalLexicalEditor = LexicalEditor as React.FC<LexicalEditorUniversalProps>

  return (
    <View flex={1} width="100%" backgroundColor="$background">
      {Platform.OS === 'web' ? (
        // Web version: Use children pattern with LexicalSync
        <UniversalLexicalEditor themeValues={themeValues}>
          <LexicalSync />
        </UniversalLexicalEditor>
      ) : (
        // Native version: Use callback pattern
        <UniversalLexicalEditor
          themeValues={themeValues}
          onContentChange={handleContentChange}
          initialContent={nativeContent}
        />
      )}
    </View>
  )
}
