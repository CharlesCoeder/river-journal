import type React from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { $getRoot } from 'lexical'
import { createBaseLexicalConfig } from '../lexical-config'

interface LexicalEditorProps {
  placeholder?: string
  className?: string
  onChange?: (htmlOrText: string) => void
}

const LexicalEditor: React.FC<LexicalEditorProps> = ({
  placeholder = 'Begin your stream-of-consciousness writing here...',
  className,
  onChange,
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
