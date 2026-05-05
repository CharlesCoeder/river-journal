import { View, useTheme } from '@my/ui'
import { useEffect } from 'react'
import type React from 'react'
import { isWeb } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { store$, showPersistentEditor, hidePersistentEditor } from '../../../state/store'
import { DEFAULT_FONT_PAIRING, FONT_PAIRING_FAMILIES } from '../../../state/types'
import LexicalEditor from './Lexical/LexicalEditor'
import { LexicalSync } from './Lexical/LexicalSync'
import type { LexicalEditorUniversalProps } from './Lexical/LexicalEditor.types'

export interface EditorProps {
  /** When true, the editor is read-only and cannot be edited */
  readOnly?: boolean
  /** Initial content to display (used when readOnly is true) */
  initialContent?: string
  /** When true, dims all paragraphs except the one containing the cursor */
  focusMode?: boolean
}

export const Editor = ({ readOnly = false, initialContent, focusMode = false }: EditorProps) => {
  const theme = useTheme()
  const fontPairing = use$(store$.profile.fontPairing) ?? DEFAULT_FONT_PAIRING
  const families = FONT_PAIRING_FAMILIES[fontPairing]

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

  const fontFamilies = {
    content: isWeb ? families.web : families.native,
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
    // matchContents auto-sizes the WebView to its HTML content height
    return (
      <View width="100%">
        <UniversalLexicalEditor
          themeValues={themeValues}
          fontFamilies={fontFamilies}
          readOnly
          initialContent={initialContent}
          dom={{ matchContents: true }}
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
        fontFamilies={fontFamilies}
        readOnly={readOnly}
        initialContent={readOnly ? initialContent : undefined}
        focusMode={focusMode}
      >
        {!readOnly && <LexicalSync />}
      </UniversalLexicalEditor>
    </View>
  )
}
