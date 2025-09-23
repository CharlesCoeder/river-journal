// src/components/Lexical/LexicalEditor.tsx (Refactored for Consistency)

import type React from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer' // Import the provider
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { ALL_TRANSFORMERS } from './transformers'

import { createBaseLexicalConfig } from './lexical-config'
import type { LexicalEditorProps } from './LexicalEditor.types'

const LexicalEditor: React.FC<LexicalEditorProps> = ({
  children,
  placeholder = 'Begin your stream-of-consciousness writing here...',
  className,
  themeValues, // Accepted but unused on web
  fontFamilies, // Accepted but unused on web
}) => {
  const initialConfig = createBaseLexicalConfig()

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
                  fontFamily: 'sourceSans3',
                }}
              />
            </div>
          }
          placeholder={
            <div
              style={{
                position: 'absolute',
                top: '0px',
                left: '0px',
                fontSize: '16px',
                pointerEvents: 'none',
                userSelect: 'none',
                fontFamily: 'sourceSans3',
              }}
            >
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <MarkdownShortcutPlugin transformers={ALL_TRANSFORMERS} />

        {/* Render children (our LexicalSync component) inside the provider */}
        {children}
      </div>
    </LexicalComposer>
  )
}

export default LexicalEditor
