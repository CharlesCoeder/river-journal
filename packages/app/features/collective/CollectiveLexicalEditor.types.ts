import type React from 'react'

export interface CollectiveLexicalEditorProps {
  /** Called on every editor change with the markdown body string. */
  onContentChange: (markdown: string) => void
  /** Minimum height of the writing surface. Default 300 (full), 120 (compact). */
  minHeight?: number
  /** Test-only: captures the LexicalEditor instance for isolation regression tests. */
  __contextProbeRef?: React.MutableRefObject<unknown>
}
