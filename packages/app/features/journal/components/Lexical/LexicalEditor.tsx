import type React from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { $getRoot } from 'lexical'
import { createBaseLexicalConfig } from './lexical-config'

interface LexicalEditorProps {
  placeholder?: string
  className?: string
  onChange?: (htmlOrText: string) => void
  themeValues?: {
    textColor: string
    placeholderColor: string
  }
  fontFamilies?: {
    content: string
    placeholder: string
  }
}

const LexicalEditor: React.FC<LexicalEditorProps> = ({
  placeholder = 'Begin your stream-of-consciousness writing here...',
  className,
  onChange,
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
