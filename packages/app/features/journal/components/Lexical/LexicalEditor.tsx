// src/components/Lexical/LexicalEditor.tsx (Refactored for Consistency)

import type React from 'react'
import { useEffect } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer' // Import the provider
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $convertFromMarkdownString, TRANSFORMERS } from '@lexical/markdown'
import { ALL_TRANSFORMERS } from './transformers'

import { createBaseLexicalConfig } from './lexical-config'
import type { LexicalEditorProps } from './LexicalEditor.types'

/**
 * Plugin to set editor to read-only mode
 */
function ReadOnlyPlugin({ readOnly }: { readOnly: boolean }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  return null
}

/**
 * Plugin to load initial content from markdown
 */
function InitialContentPlugin({ content }: { content: string }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (content) {
      editor.update(() => {
        $convertFromMarkdownString(content, TRANSFORMERS)
      })
    }
  }, [editor, content])

  return null
}

const LexicalEditor: React.FC<LexicalEditorProps> = ({
  children,
  placeholder = 'Begin your stream-of-consciousness writing here...',
  className,
  themeValues, // Accepted but unused on web
  fontFamilies, // Accepted but unused on web
  readOnly = false,
  initialContent,
}) => {
  const initialConfig = createBaseLexicalConfig()

  // Don't show placeholder in readOnly mode
  const placeholderText = readOnly ? '' : placeholder

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={className} style={{ position: 'relative', minHeight: '200px' }}>
        <RichTextPlugin
          contentEditable={
            <div style={{ minHeight: '200px' }}>
              <ContentEditable
                style={{
                  outline: 'none',
                  minHeight: '200px',
                  fontSize: '16px',
                  lineHeight: '1.5',
                  fontFamily: 'Lora',
                }}
              />
            </div>
          }
          placeholder={
            placeholderText ? (
              <div
                style={{
                  position: 'absolute',
                  top: '0px',
                  left: '0px',
                  fontSize: '16px',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  fontFamily: 'Lora',
                }}
              >
                {placeholderText}
              </div>
            ) : null
          }
          ErrorBoundary={LexicalErrorBoundary}
        />

        {/* Read-only mode plugin */}
        {readOnly && <ReadOnlyPlugin readOnly={readOnly} />}

        {/* Initial content plugin for readOnly mode */}
        {readOnly && initialContent && <InitialContentPlugin content={initialContent} />}

        {/* Only include history and markdown shortcuts when editable */}
        {!readOnly && (
          <>
            <HistoryPlugin />
            <MarkdownShortcutPlugin transformers={ALL_TRANSFORMERS} />
          </>
        )}

        {/* Render children (our LexicalSync component) inside the provider */}
        {children}
      </div>
    </LexicalComposer>
  )
}

export default LexicalEditor
