'use dom'
import type React from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { $getRoot } from 'lexical'

import { createBaseLexicalConfig } from '../lexical-config'
import type { InitialConfigType } from '@lexical/react/LexicalComposer'

interface LexicalEditorNativeProps {
  placeholder?: string
  className?: string
  onChange?: (text: string) => void
  /** Theme values passed from parent component to avoid useTheme hook issues in DOM context */
  themeValues?: {
    textColor: string
    placeholderColor: string
  }
}

/**
 * Creates mobile-specific Lexical config without CSS class theme mappings
 * since we use inline styles with dynamic theme values
 */
const createMobileLexicalConfig = (): InitialConfigType => {
  const baseConfig = createBaseLexicalConfig()
  return {
    ...baseConfig,
    // Remove theme class mappings for mobile - we'll use inline styles instead
    theme: {},
  }
}

/**
 * Generate theme-aware styles for Lexical editor on mobile using passed theme values
 * Avoids useTheme hook issues in DOM context by accepting theme values as props
 */
const createLexicalThemeStyles = (themeValues?: {
  textColor: string
  placeholderColor: string
}) => {
  const textColor = themeValues?.textColor || '#000000'
  const placeholderColor = themeValues?.placeholderColor || '#999999'

  return {
    root: {
      color: textColor,
      background: 'transparent',
      height: '100%',
      display: 'flex',
      flexDirection: 'column' as const,
    },
    contentEditable: {
      outline: 'none',
      padding: 16,
      minHeight: '100%',
      flex: 1,
      fontSize: 18,
      lineHeight: 1.6,
      fontFamily: 'inherit',
      color: textColor,
      background: 'transparent',
      width: '100%',
      height: '100%',
      boxSizing: 'border-box' as const,
      overflowX: 'hidden' as const,
      wordWrap: 'break-word' as const,
    },
    placeholder: {
      position: 'absolute' as const,
      top: 16,
      left: 16,
      color: placeholderColor,
      fontSize: 18,
      lineHeight: 1.6,
      pointerEvents: 'none' as const,
      userSelect: 'none' as const,
    },
  }
}

const LexicalEditor: React.FC<LexicalEditorNativeProps> = ({
  placeholder = 'Begin your stream-of-consciousness writing here...',
  className,
  onChange,
  themeValues,
}) => {
  const initialConfig = createMobileLexicalConfig()
  const themeStyles = createLexicalThemeStyles(themeValues)

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div
        className={className}
        style={{
          position: 'relative',
          minHeight: '80%',
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box' as const,
          ...themeStyles.root,
        }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable style={themeStyles.contentEditable} />}
          placeholder={<div style={themeStyles.placeholder}>{placeholder}</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        {onChange ? (
          <OnChangePlugin
            onChange={(editorState) => {
              const text = editorState.read(() => $getRoot().getTextContent())
              onChange(text)
            }}
          />
        ) : null}
      </div>
    </LexicalComposer>
  )
}

export default LexicalEditor
