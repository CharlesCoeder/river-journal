// Shared TypeScript interfaces for LexicalEditor components
import type React from 'react'

export interface LexicalEditorBaseProps {
  placeholder?: string
  className?: string
  themeValues?: {
    textColor: string
    placeholderColor: string
  }
  fontFamilies?: {
    content: string
    placeholder: string
  }
  /** When true, the editor is read-only and cannot be edited */
  readOnly?: boolean
  /** Initial content to display (markdown format) */
  initialContent?: string
  /** When true, dims all paragraphs except the one containing the cursor */
  focusMode?: boolean
  /** Focus-mode granularity. 'sentence' additionally dims every
   *  sentence except the one the cursor is in, inside the active paragraph. */
  focusGranularity?: 'paragraph' | 'sentence'
}

// Web version props
export interface LexicalEditorProps extends LexicalEditorBaseProps {
  children?: React.ReactNode
  onChange?: (htmlOrText: string) => void
}

// Native version props
export interface LexicalEditorNativeProps extends LexicalEditorBaseProps {
  /** Called when editor content changes - receives markdown content */
  onContentChange?: (markdown: string) => void
  /** Called on every keystroke with the current word count (no debounce).
   *  Computed inside the WebView to avoid bridge latency from full content transfer. */
  onWordCountChange?: (count: number) => void
  /** Initial content to load into editor as markdown */
  initialContent?: string
  /** Monotonic counter — when it changes, ContentSyncer re-applies content even if
   *  the string value is identical (handles '' → '' clears). */
  contentRevision?: number
  /** Fires when the contenteditable gains or loses focus (keyboard up / down). */
  onFocusChange?: (focused: boolean) => void
  /** Monotonic counter — when it changes, the editor blurs itself (dismisses the keyboard). */
  blurRequest?: number
  /** Space (px) the document keeps clear above its first line and on either side,
   *  so the host's frame can span the whole screen while the words start under the
   *  chrome and inside the page margins — and the scrollbar rides the screen edge. */
  documentInsets?: { top: number; sides: number }
  /** Fires once `documentInsets` are in effect, with the values applied. */
  onDocumentInsetsApplied?: (applied: { top: number; sides: number }) => void
}

// Union type for platform-specific usage
export type LexicalEditorUniversalProps = LexicalEditorProps & LexicalEditorNativeProps
