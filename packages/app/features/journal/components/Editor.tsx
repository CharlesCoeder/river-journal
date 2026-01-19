import { View, useTheme } from '@my/ui'
import { useRef, useEffect, useCallback } from 'react'
import type React from 'react'
import { useDebouncedCallback } from 'use-debounce'
import { Platform, View as RNView } from 'react-native'
import { isWeb } from '@my/ui'
import {
  store$,
  updateActiveFlowContent,
  showPersistentEditor,
  hidePersistentEditor,
  updatePersistentEditorLayout,
} from '../../../state/store'
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

  // On native, control the persistent editor visibility
  useEffect(() => {
    if (!isWeb) {
      // Show persistent editor with appropriate mode
      // Pass initial content only - PersistentEditor manages its own content after that
      showPersistentEditor({
        readOnly,
        content: readOnly ? initialContent || '' : store$.journal.activeFlow.content.get() || '',
      })

      // Hide when component unmounts
      return () => {
        hidePersistentEditor()
      }
    }
  }, [readOnly, initialContent]) // Re-run when readOnly or initialContent changes

  // Note: We intentionally do NOT sync content back to persistentEditor after initial mount
  // The PersistentEditor handles content updates directly via updateActiveFlowContent
  // Syncing back would cause cursor position resets due to ContentSyncer re-rendering

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


  const themeValues = {
    textColor: theme.color.val,
    placeholderColor: theme.placeholderColor.val,
  }

  // Handler to measure placeholder position and sync to persistent editor
  const handleLayout = useCallback(() => {
    if (isWeb) return
    // Use measureInWindow to get absolute screen coordinates
    placeholderRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        updatePersistentEditorLayout({
          top: y,
          left: x,
          width,
          height,
        })
      }
    })
  }, [])

  // Ref for the placeholder View to measure its position
  const placeholderRef = useRef<RNView>(null)

  // On native, return a placeholder that measures its position
  // The persistent editor will use these bounds to position itself
  if (!isWeb) {
    return (
      <View
        ref={placeholderRef}
        onLayout={handleLayout}
        flex={1}
        width="100%"
        backgroundColor="$background"
      />
    )
  }

  // Cast to universal props to handle platform-specific prop differences
  const UniversalLexicalEditor = LexicalEditor as React.FC<LexicalEditorUniversalProps>

  // Web version: Use per-screen editor as no constraints from Expo DOM and its webview initialization time
  return (
    <View flex={1} width="100%" backgroundColor="$background">
      <UniversalLexicalEditor
        themeValues={themeValues}
        readOnly={readOnly}
        initialContent={readOnly ? initialContent : undefined}
      >
        {!readOnly && <LexicalSync />}
      </UniversalLexicalEditor>
    </View>
  )
}
