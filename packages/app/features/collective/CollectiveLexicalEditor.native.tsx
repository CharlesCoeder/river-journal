'use dom';

/**
 * CollectiveLexicalEditor (native / Expo DOM WebView)
 *
 * Mobile variant — mirrors LexicalEditor.native.tsx's 'use dom' + WebView mount
 * strategy, but with composer-specific config (no PersistentEditor entanglement,
 * no FocusModeParagraphPlugin, no LexicalSync).
 *
 * D14 invariant: this is a fresh LexicalComposer per PostComposer mount.
 * It does NOT import PersistentEditor and does NOT read/write ephemeral$.persistentEditor.*.
 */

import React, { useEffect } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $convertToMarkdownString } from '@lexical/markdown';
import { ALL_TRANSFORMERS } from 'app/features/journal/components/Lexical/transformers';
import { createMobileLexicalConfig, injectFontCSS } from 'app/features/journal/components/Lexical/utils';
import type { CollectiveLexicalEditorProps } from './CollectiveLexicalEditor.types';
// NOTE: FocusModeParagraphPlugin is deliberately NOT imported here.
// The composer is a short-form surface; focus mode is a journal-only behavior.
// NOTE: LexicalSync is deliberately NOT imported here — it syncs to the journal's
// Legend-State store (D14 violation for a Collective surface).

// ─── LexicalContextProbe — test-only probe ────────────────────────────────────

function LexicalContextProbe({
  probeRef,
}: {
  probeRef?: React.MutableRefObject<unknown>;
}): null {
  const [editor] = useLexicalComposerContext();
  if (probeRef) {
    probeRef.current = editor;
  }
  return null;
}

// ─── FontInjector ─────────────────────────────────────────────────────────────

function FontInjector(): null {
  useEffect(() => {
    const cleanup = injectFontCSS();
    return cleanup;
  }, []);
  return null;
}

// ─── CollectiveLexicalEditor (native) ────────────────────────────────────────

function CollectiveLexicalEditor({
  onContentChange,
  minHeight = 300,
  __contextProbeRef,
}: CollectiveLexicalEditorProps) {
  const initialConfig = createMobileLexicalConfig();

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: `${minHeight}px`,
          borderRadius: 0,
          border: 'none',
          background: 'transparent',
          fontFamily: 'Newsreader, Georgia, serif',
          boxSizing: 'border-box',
        }}
      >
        <RichTextPlugin
          contentEditable={
            <div style={{ minHeight: '100%', height: '100%', width: '100%' }}>
              <ContentEditable
                spellCheck={false}
                style={{
                  outline: 'none',
                  width: '100%',
                  height: '100%',
                  minHeight: `${minHeight}px`,
                  fontSize: '18px',
                  lineHeight: '1.625',
                  fontFamily: 'Newsreader, Georgia, serif',
                  borderRadius: 0,
                  border: 'none',
                  background: 'transparent',
                  padding: '0',
                  boxSizing: 'border-box',
                  wordWrap: 'break-word',
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
                fontFamily: 'Newsreader, Georgia, serif',
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

        {/* CRITICAL: third arg `true` (hasOutputNodeHandling) is required —
            LINEBREAK_TRANSFORMER has an `export` function; omitting this arg
            silently drops line-break serialization. Mirrors LexicalEditor.native.tsx:133. */}
        <OnChangePlugin
          onChange={(editorState) => {
            editorState.read(() => {
              const markdown = $convertToMarkdownString(ALL_TRANSFORMERS, undefined, true);
              onContentChange(markdown);
            });
          }}
        />

        <FontInjector />

        {/* Test-only probe: only activates when __contextProbeRef is set. */}
        {__contextProbeRef && (
          <LexicalContextProbe probeRef={__contextProbeRef} />
        )}
      </div>
    </LexicalComposer>
  );
}

export default CollectiveLexicalEditor;
