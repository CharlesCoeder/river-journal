'use dom'

import type React from 'react'
import { useEffect, useRef } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { $getRoot, BLUR_COMMAND, COMMAND_PRIORITY_LOW, FOCUS_COMMAND } from 'lexical'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { ALL_TRANSFORMERS } from './transformers'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  injectFontCSS,
  injectFocusModeCSS,
  createMobileLexicalConfig,
  injectLayoutCSS,
} from './utils'
import type { LexicalEditorNativeProps } from './LexicalEditor.types'
import { FocusModeParagraphPlugin } from './plugins/FocusModeParagraphPlugin'
import { SentenceWrapPlugin } from './plugins/SentenceWrapPlugin'
import { SentenceFocusPlugin } from './plugins/SentenceFocusPlugin'

/**
 * Plugin to set editor to read-only mode
 */
const ReadOnlyPlugin: React.FC<{
  readOnly: boolean
}> = ({ readOnly }) => {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    editor.setEditable(!readOnly)
  }, [editor, readOnly])
  return null
}

// Helper component to load and sync content
const ContentSyncer: React.FC<{
  content: string
  revision?: number
}> = ({ content, revision }) => {
  const [editor] = useLexicalComposerContext()
  const lastContent = useRef('')
  const lastRevision = useRef(revision)
  useEffect(() => {
    if (content !== lastContent.current || revision !== lastRevision.current) {
      lastContent.current = content
      lastRevision.current = revision
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
  }, [editor, content, revision])
  return null
}
/**
 * Plugin that fires onWordCountChange on every text mutation,
 * computed inside the WebView so only a small number crosses the bridge
 * (avoids serializing the full markdown string for word counting).
 */
const WordCountPlugin: React.FC<{
  onWordCountChange: (count: number) => void
}> = ({ onWordCountChange }) => {
  const [editor] = useLexicalComposerContext()
  const callbackRef = useRef(onWordCountChange)
  callbackRef.current = onWordCountChange
  useEffect(() => {
    return editor.registerTextContentListener((text) => {
      const trimmed = text.trim()
      callbackRef.current(trimmed ? trimmed.split(/\s+/).length : 0)
    })
  }, [editor])
  return null
}
/**
 * Reports focus/blur of the contenteditable across the bridge as a boolean.
 * Lexical dispatches FOCUS_COMMAND / BLUR_COMMAND from the root element's
 * native focus events, which is exactly when the soft keyboard shows / hides.
 */
const FocusReportPlugin: React.FC<{
  onFocusChange: (focused: boolean) => void
}> = ({ onFocusChange }) => {
  const [editor] = useLexicalComposerContext()
  const callbackRef = useRef(onFocusChange)
  callbackRef.current = onFocusChange
  useEffect(() => {
    const unregisterFocus = editor.registerCommand(
      FOCUS_COMMAND,
      () => {
        callbackRef.current(true)
        return false
      },
      COMMAND_PRIORITY_LOW
    )
    const unregisterBlur = editor.registerCommand(
      BLUR_COMMAND,
      () => {
        callbackRef.current(false)
        return false
      },
      COMMAND_PRIORITY_LOW
    )
    return () => {
      unregisterFocus()
      unregisterBlur()
    }
  }, [editor])
  return null
}

/**
 * Blurs the editor whenever the `request` counter changes (not on mount).
 * Blurring the contenteditable is what dismisses the soft keyboard inside a
 * WebView — RN's Keyboard.dismiss() only knows about native TextInputs.
 */
const BlurRequestPlugin: React.FC<{ request: number }> = ({ request }) => {
  const [editor] = useLexicalComposerContext()
  const lastRequest = useRef(request)
  useEffect(() => {
    if (request === lastRequest.current) return
    lastRequest.current = request
    editor.blur()
  }, [editor, request])
  return null
}

/**
 * Keeps `top` px clear above the document's first line and `sides` px on
 * either side (the CSS variables injectLayoutCSS reads) and tells the host
 * once they are in effect, so the host only reveals the page after the words
 * are where it expects them.
 */
const DocumentInsetsPlugin: React.FC<{
  top: number
  sides: number
  onApplied?: (applied: { top: number; sides: number }) => void
}> = ({ top, sides, onApplied }) => {
  const callbackRef = useRef(onApplied)
  callbackRef.current = onApplied
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--editor-top-inset', `${top}px`)
    root.setProperty('--editor-side-inset', `${sides}px`)
    callbackRef.current?.({ top, sides })
  }, [top, sides])
  return null
}

const LexicalEditor: React.FC<LexicalEditorNativeProps> = ({
  placeholder = 'Start flowing...',
  className,
  onContentChange,
  onWordCountChange,
  onFocusChange,
  blurRequest,
  documentInsets,
  onDocumentInsetsApplied,
  initialContent,
  contentRevision,
  themeValues,
  fontFamilies,
  readOnly = false,
  focusMode = false,
  focusGranularity = 'paragraph',
}) => {
  const initialConfig = createMobileLexicalConfig()
  const contentFont = fontFamilies?.content || 'Newsreader'
  const styles = createMobileLexicalStyling(themeValues, contentFont)

  // Inject font CSS when component mounts
  useEffect(() => {
    const cleanup = injectFontCSS()
    return cleanup
  }, [])

  // Inject focus-mode CSS into the WebView
  useEffect(() => {
    const cleanup = injectFocusModeCSS()
    return cleanup
  }, [])

  // Zero the document's own margins so the first line sits at the container's top
  useEffect(() => {
    const cleanup = injectLayoutCSS()
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
            <div
              style={{
                minHeight: '100%',
                height: '100%',
              }}
            >
              <ContentEditable
                className="lex-root"
                style={styles.contentEditable}
              />
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

        {/* Instant word count — computed inside WebView, only a number crosses the bridge */}
        {!readOnly && onWordCountChange ? (
          <WordCountPlugin onWordCountChange={onWordCountChange} />
        ) : null}

        {/* Room above the first line and beside the words, acknowledged back to the host */}
        <DocumentInsetsPlugin
          top={documentInsets?.top ?? 0}
          sides={documentInsets?.sides ?? 0}
          onApplied={onDocumentInsetsApplied}
        />

        {/* Focus reporting + blur-on-request — the keyboard's show/hide contract with native */}
        {!readOnly && onFocusChange ? <FocusReportPlugin onFocusChange={onFocusChange} /> : null}
        {!readOnly && blurRequest !== undefined ? (
          <BlurRequestPlugin request={blurRequest} />
        ) : null}

        {/* Focus mode plugin — dims non-active paragraphs when enabled */}
        {!readOnly && (
          <FocusModeParagraphPlugin
            focusMode={focusMode}
            readOnly={readOnly}
          />
        )}

        {/* Per-sentence focus mode — structure + styling. No-ops
            unless focusMode is ON and granularity is 'sentence'. Mirrors web. */}
        {!readOnly && (
          <>
            <SentenceWrapPlugin
              focusMode={focusMode}
              focusGranularity={focusGranularity}
              readOnly={readOnly}
            />
            <SentenceFocusPlugin
              focusMode={focusMode}
              focusGranularity={focusGranularity}
              readOnly={readOnly}
            />
          </>
        )}

        {/* Sync content with Legend State */}
        <ContentSyncer
          content={initialContent || ''}
          revision={contentRevision}
        />
      </div>
    </LexicalComposer>
  )
}

/**
 * Generate theme-aware styles for Lexical editor on mobile using passed theme values
 * Avoids useTheme hook issues in DOM context by accepting theme values as props
 */
const createMobileLexicalStyling = (
  themeValues?: {
    textColor: string
    placeholderColor: string
  },
  contentFont = 'Newsreader'
) => {
  const textColor = themeValues?.textColor || '#000000'
  const placeholderColor = themeValues?.placeholderColor || '#999999'
  return {
    root: {
      color: textColor,
      background: 'transparent',
      height: '100%',
      fontFamily: contentFont,
    },
    contentEditable: {
      outline: 'none',
      minHeight: '100%',
      fontSize: 30,
      lineHeight: 1.625,
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
      fontSize: 30,
      lineHeight: 1.625,
      opacity: 0.35,
      pointerEvents: 'none' as const,
      userSelect: 'none' as const,
    },
  }
}
export default LexicalEditor
