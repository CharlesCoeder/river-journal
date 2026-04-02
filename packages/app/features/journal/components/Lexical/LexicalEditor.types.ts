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
}

// Union type for platform-specific usage
export type LexicalEditorUniversalProps = LexicalEditorProps & LexicalEditorNativeProps
