import { View, useTheme } from '@my/ui'
import { useObserve } from '@legendapp/state/react'
import { useRef, useState } from 'react'
import type React from 'react'
import { useDebouncedCallback } from 'use-debounce'
import { Platform } from 'react-native'
import { store$, updateActiveFlowContent } from '../../../state/store'
import LexicalEditor from './Lexical/LexicalEditor'
import { LexicalSync } from './Lexical/LexicalSync'
import type { LexicalEditorUniversalProps } from './Lexical/LexicalEditor.types'

export interface EditorProps {
  /** When true, the editor is read-only and cannot be edited */
  readOnly?: boolean
  /** Initial content to display (used when readOnly is true) */
  initialContent?: string
}

export const Editor = ({ readOnly = false, initialContent }: EditorProps) => {
  const theme = useTheme()
  const isSyncingFromState = useRef(false)

  // Track current content for native sync
  // When readOnly, use initialContent; otherwise use store's activeFlow content
  const [nativeContent, setNativeContent] = useState(
    readOnly ? initialContent || '' : store$.journal.activeFlow.content.get() || ''
  )

  // Debounced function to update Legend State from editor changes
  const debouncedUpdateStore = useDebouncedCallback((markdown: string) => {
    if (readOnly) return // Don't update store in readOnly mode

    isSyncingFromState.current = true

    updateActiveFlowContent(markdown)

    // Reset the flag in the next browser paint cycle
    requestAnimationFrame(() => {
      isSyncingFromState.current = false
    })
  }, 300)

  // Handle content changes from the editor (native only)
  const handleContentChange = (markdown: string) => {
    if (readOnly) return // Don't handle changes in readOnly mode
    debouncedUpdateStore(markdown)
  }

  // For native: sync from Legend State to local state (which triggers editor update)
  // Only sync when not in readOnly mode
  useObserve(store$.journal.activeFlow.content, ({ value }) => {
    if (readOnly) return // Don't sync in readOnly mode

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
        <UniversalLexicalEditor
          themeValues={themeValues}
          readOnly={readOnly}
          initialContent={readOnly ? initialContent : undefined}
        >
          {!readOnly && <LexicalSync />}
        </UniversalLexicalEditor>
      ) : (
        // Native version: Use callback pattern
        <UniversalLexicalEditor
          themeValues={themeValues}
          onContentChange={readOnly ? undefined : handleContentChange}
          initialContent={readOnly ? initialContent : nativeContent}
          readOnly={readOnly}
        />
      )}
    </View>
  )
}
