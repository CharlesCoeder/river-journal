import React from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { createBaseLexicalConfig } from './lexical-config'

interface LexicalEditorProps {
  placeholder?: string
  className?: string
}

/**
 * Basic Lexical editor wrapper with minimal plugins for MVP
 * Designed for cross-platform compatibility
 */
export const LexicalEditor: React.FC<LexicalEditorProps> = ({ 
  placeholder = "Begin your stream-of-consciousness writing here...",
  className 
}) => {
  const initialConfig = createBaseLexicalConfig()

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={className} style={{ position: 'relative', minHeight: '200px' }}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable 
              style={{
                outline: 'none',
                padding: '12px',
                minHeight: '200px',
                fontSize: '16px',
                lineHeight: '1.5',
                fontFamily: 'inherit',
              }}
            />
          }
          placeholder={
            <div 
              style={{
                position: 'absolute',
                top: '12px',
                left: '12px',
                color: '#999',
                fontSize: '16px',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            >
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
      </div>
    </LexicalComposer>
  )
} 