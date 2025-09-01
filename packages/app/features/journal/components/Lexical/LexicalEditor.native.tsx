'use dom'
import type React from 'react'
import { useEffect } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { $getRoot } from 'lexical'
import { injectFontCSS, createMobileLexicalConfig } from './utils'

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

const LexicalEditor: React.FC<LexicalEditorNativeProps> = ({
  placeholder = 'Begin your stream-of-consciousness writing here...',
  className,
  onChange,
  themeValues,
}) => {
  const initialConfig = createMobileLexicalConfig()
  const styles = createMobileLexicalStyling(themeValues)

  // Inject font CSS when component mounts
  useEffect(() => {
    const cleanup = injectFontCSS()
    return cleanup
  }, [])

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
          ...styles.root,
        }}
      >
        <RichTextPlugin
          contentEditable={
            <div style={{ minHeight: '100%', height: '100%' }}>
              <ContentEditable style={styles.contentEditable} />
            </div>
          }
          placeholder={<div style={styles.placeholder}>{placeholder}</div>}
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

/**
 * Generate theme-aware styles for Lexical editor on mobile using passed theme values
 * Avoids useTheme hook issues in DOM context by accepting theme values as props
 */
const createMobileLexicalStyling = (themeValues?: {
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
      fontFamily: 'sourceSans3',
    },
    contentEditable: {
      outline: 'none',
      minHeight: '100%',
      fontSize: 18,
      lineHeight: 1.6,
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
      top: 0,
      left: 0,
      color: placeholderColor,
      fontSize: 18,
      lineHeight: 1.6,
      pointerEvents: 'none' as const,
      userSelect: 'none' as const,
    },
  }
}

export default LexicalEditor
