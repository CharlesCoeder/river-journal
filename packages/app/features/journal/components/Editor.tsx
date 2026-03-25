import { View, useTheme } from '@my/ui'
import { useEffect } from 'react'
import type React from 'react'
import { isWeb } from '@my/ui'
import { store$, showPersistentEditor, hidePersistentEditor } from '../../../state/store'
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

  // On native (editable mode only), control the persistent editor visibility.
  // ReadOnly mode renders inline — no need for the persistent overlay.
  useEffect(() => {
    if (!isWeb && !readOnly) {
      showPersistentEditor({
        readOnly: false,
        content: store$.activeFlow.content.get() || '',
      })

      return () => {
        hidePersistentEditor()
      }
    }
  }, [readOnly])

  const themeValues = {
    textColor: theme.color.val,
    placeholderColor: theme.placeholderColor.val,
  }

  // Cast to universal props to handle platform-specific prop differences
  const UniversalLexicalEditor = LexicalEditor as React.FC<LexicalEditorUniversalProps>

  // On native editable: transparent placeholder, PersistentEditor overlay handles rendering.
  // On native readOnly: render Lexical inline (no persistent overlay needed, avoids
  // positioning conflicts with different screen layouts like CelebrationScreen).
  if (!isWeb) {
    if (!readOnly) {
      return (
        <View
          flex={1}
          width="100%"
          backgroundColor="transparent"
        />
      )
    }

    // ReadOnly: render inline WebView within the normal layout flow
    return (
      <View
        flex={1}
        width="100%"
      >
        <UniversalLexicalEditor
          themeValues={themeValues}
          readOnly
          initialContent={initialContent}
        />
      </View>
    )
  }

  // Web: always render inline
  return (
    <View
      flex={1}
      width="100%"
      backgroundColor="$background"
    >
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
