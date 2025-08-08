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

interface LexicalEditorNativeProps {
  placeholder?: string
  className?: string
  onChange?: (text: string) => void
}

const LexicalEditor: React.FC<LexicalEditorNativeProps> = ({
  placeholder = 'Begin your stream-of-consciousness writing here...',
  className,
  onChange,
}) => {
  const initialConfig = createBaseLexicalConfig()

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={className} style={{ position: 'relative', minHeight: 200 }}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              style={{
                outline: 'none',
                padding: 12,
                minHeight: 200,
                fontSize: 16,
                lineHeight: 1.5,
                fontFamily: 'inherit',
              }}
            />
          }
          placeholder={
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                color: '#999',
                fontSize: 16,
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
