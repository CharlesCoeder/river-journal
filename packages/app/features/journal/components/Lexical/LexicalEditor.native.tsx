'use dom'
import type React from 'react'
import { useEffect, useRef } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { $getRoot } from 'lexical'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { ALL_TRANSFORMERS } from './transformers'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { injectFontCSS, createMobileLexicalConfig } from './utils'
import type { LexicalEditorNativeProps } from './LexicalEditor.types'

/**
 * Plugin to set editor to read-only mode
 */
const ReadOnlyPlugin: React.FC<{ readOnly: boolean }> = ({ readOnly }) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  return null
}

// Helper component to load and sync content
const ContentSyncer: React.FC<{ content: string }> = ({ content }) => {
  const [editor] = useLexicalComposerContext()
  const lastContent = useRef('')

  useEffect(() => {
    // Only update if content actually changed to avoid unnecessary updates
    if (content !== lastContent.current) {
      lastContent.current = content

      editor.update(
        () => {
          $getRoot().clear()
          if (content) {
            $convertFromMarkdownString(content, ALL_TRANSFORMERS, undefined, true)
          }
        },
        {
          tag: 'history-merge', // Prevents this from being part of undo stack
        }
      )
    }
  }, [editor, content])

  return null
}

const LexicalEditor: React.FC<LexicalEditorNativeProps> = ({
  placeholder = 'Begin your stream-of-consciousness writing here...',
  className,
  onContentChange,
  initialContent,
  themeValues,
  readOnly = false,
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
          placeholder={readOnly ? null : <div style={styles.placeholder}>{placeholder}</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />

        {/* Read-only mode plugin */}
        {readOnly && <ReadOnlyPlugin readOnly={readOnly} />}

        {/* Only include history when editable */}
        {!readOnly && <HistoryPlugin />}

        {/* Only track changes when editable and callback provided */}
        {!readOnly && onContentChange ? (
          <OnChangePlugin
            onChange={(editorState) => {
              const markdown = editorState.read(() =>
                $convertToMarkdownString(ALL_TRANSFORMERS, undefined, true)
              )
              onContentChange(markdown)
            }}
          />
        ) : null}

        {/* Sync content with Legend State */}
        <ContentSyncer content={initialContent || ''} />
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
