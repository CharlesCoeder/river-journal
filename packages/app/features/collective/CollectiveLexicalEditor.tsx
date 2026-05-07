/**
 * CollectiveLexicalEditor (web/desktop)
 *
 * Mounts a fresh LexicalComposer for the Collective composer surface.
 * Structural isolation from the journal editor (D14 invariant): each PostComposer
 * mount creates its own LexicalComposer instance — no shared Lexical context,
 * no shared EditorState, no entanglement with the journal persistent editor.
 *
 * Key divergences from the journal LexicalEditor.tsx:
 * - NO journal focus-mode plugin (journal-only behavior, not relevant to the composer)
 * - NO journal state-sync plugin (would violate D14 by syncing to the journal domain)
 * - Uses OnChangePlugin directly to emit markdown body to parent via onContentChange
 * - Sharp-cornered writing surface (borderRadius: 0)
 * - Newsreader serif body styling
 */

import React from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $convertToMarkdownString } from '@lexical/markdown'
import { ALL_TRANSFORMERS } from 'app/features/journal/components/Lexical/transformers'
import { createBaseLexicalConfig } from 'app/features/journal/components/Lexical/lexical-config'
// NOTE: The journal's focus-mode plugin is deliberately NOT mounted in the composer.
// The composer is a short-form surface; that plugin is a journal-only behavior.

// ─── LexicalContextProbe — test-only probe ────────────────────────────────────
// This plugin is gated to the test environment and only activates when the
// __contextProbeRef prop is set. Production callers never set the prop.
// Chaos Monkey #7: grep 'LexicalContextProbe' in apps/ must return zero matches.

function LexicalContextProbe({
  probeRef,
}: {
  probeRef?: React.MutableRefObject<unknown>
}): null {
  const [editor] = useLexicalComposerContext()
  if (probeRef) {
    probeRef.current = editor
  }
  return null
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CollectiveLexicalEditorProps {
  /** Called on every editor change with the markdown body string. */
  onContentChange: (markdown: string) => void
  /** Minimum height of the writing surface. Default 300 (full), 120 (compact). */
  minHeight?: number
  /** Test-only: captures the LexicalEditor instance for isolation regression tests. */
  __contextProbeRef?: React.MutableRefObject<unknown>
}

// ─── CollectiveLexicalEditor ──────────────────────────────────────────────────

export function CollectiveLexicalEditor({
  onContentChange,
  minHeight = 300,
  __contextProbeRef,
}: CollectiveLexicalEditorProps) {
  const initialConfig = createBaseLexicalConfig()
  const contentFont = 'Newsreader, Georgia, "Times New Roman", serif'

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div
        style={{
          position: 'relative',
          minHeight: `${minHeight}px`,
          borderRadius: 0,
          border: 'none',
          background: 'transparent',
        }}
      >
        <RichTextPlugin
          contentEditable={
            <div style={{ minHeight: `${minHeight}px` }}>
              <ContentEditable
                style={{
                  outline: 'none',
                  minHeight: `${minHeight}px`,
                  fontSize: '18px',
                  lineHeight: '1.625',
                  fontFamily: contentFont,
                  borderRadius: 0,
                  border: 'none',
                  background: 'transparent',
                  padding: '0',
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
                fontSize: '18px',
                lineHeight: '1.625',
                pointerEvents: 'none',
                userSelect: 'none',
                fontFamily: contentFont,
                opacity: 0.35,
              }}
            >
              What's on your mind?
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />

        <HistoryPlugin />
        <MarkdownShortcutPlugin transformers={ALL_TRANSFORMERS} />

        {/* Emit markdown body to parent on every change.
            CRITICAL: third arg `true` (hasOutputNodeHandling) is required —
            LINEBREAK_TRANSFORMER has an `export` function; omitting this arg
            silently drops line-break serialization. Mirrors LexicalEditor.native.tsx:133. */}
        <OnChangePlugin
          onChange={(editorState) => {
            editorState.read(() => {
              const markdown = $convertToMarkdownString(ALL_TRANSFORMERS, undefined, true)
              onContentChange(markdown)
            })
          }}
        />

        {/* Test-only probe: captures LexicalEditor instance for D14 isolation regression tests.
            Only activates when __contextProbeRef is set; production callers never set it. */}
        {__contextProbeRef && (
          <LexicalContextProbe probeRef={__contextProbeRef} />
        )}
      </div>
    </LexicalComposer>
  )
}
