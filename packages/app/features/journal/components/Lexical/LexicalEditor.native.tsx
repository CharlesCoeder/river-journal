'use dom';

import type React from 'react';
import { useEffect, useRef } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { $getRoot } from 'lexical';
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown';
import { ALL_TRANSFORMERS } from './transformers';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { injectFontCSS, createMobileLexicalConfig } from './utils';
import type { LexicalEditorNativeProps } from './LexicalEditor.types';

/**
 * Plugin to set editor to read-only mode
 */
const ReadOnlyPlugin: React.FC<{
  readOnly: boolean;
}> = ({
  readOnly
}) => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);
  return null;
};

// Helper component to load and sync content
const ContentSyncer: React.FC<{
  content: string;
  revision?: number;
}> = ({
  content,
  revision
}) => {
  const [editor] = useLexicalComposerContext();
  const lastContent = useRef('');
  const lastRevision = useRef(revision);
  useEffect(() => {
    if (content !== lastContent.current || revision !== lastRevision.current) {
      lastContent.current = content;
      lastRevision.current = revision;
      editor.update(() => {
        $getRoot().clear();
        if (content) {
          $convertFromMarkdownString(content, ALL_TRANSFORMERS, undefined, true);
        }
      }, {
        tag: 'history-merge' // Prevents this from being part of undo stack
      });
    }
  }, [editor, content, revision]);
  return null;
};
/**
 * Plugin that fires onWordCountChange on every text mutation,
 * computed inside the WebView so only a small number crosses the bridge
 * (avoids serializing the full markdown string for word counting).
 */
const WordCountPlugin: React.FC<{
  onWordCountChange: (count: number) => void;
}> = ({
  onWordCountChange
}) => {
  const [editor] = useLexicalComposerContext();
  const callbackRef = useRef(onWordCountChange);
  callbackRef.current = onWordCountChange;
  useEffect(() => {
    return editor.registerTextContentListener(text => {
      const trimmed = text.trim();
      callbackRef.current(trimmed ? trimmed.split(/\s+/).length : 0);
    });
  }, [editor]);
  return null;
};
const LexicalEditor: React.FC<LexicalEditorNativeProps> = ({
  placeholder = 'Start flowing...',
  className,
  onContentChange,
  onWordCountChange,
  initialContent,
  contentRevision,
  themeValues,
  fontFamilies,
  readOnly = false
}) => {
  const initialConfig = createMobileLexicalConfig();
  const contentFont = fontFamilies?.content || 'Newsreader';
  const styles = createMobileLexicalStyling(themeValues, contentFont);

  // Inject font CSS when component mounts
  useEffect(() => {
    const cleanup = injectFontCSS();
    return cleanup;
  }, []);
  return <LexicalComposer initialConfig={initialConfig}>
      <div className={className} style={{
      position: 'relative',
      minHeight: '80%',
      width: '100%',
      maxWidth: '100%',
      boxSizing: 'border-box' as const,
      ...styles.root
    }}>
        <RichTextPlugin contentEditable={<div style={{
        minHeight: '100%',
        height: '100%'
      }}>
              <ContentEditable style={styles.contentEditable} />
            </div>} placeholder={readOnly ? null : <div style={styles.placeholder}>{placeholder}</div>} ErrorBoundary={LexicalErrorBoundary} />

        {/* Read-only mode plugin */}
        {readOnly && <ReadOnlyPlugin readOnly={readOnly} />}

        {/* Only include history when editable */}
        {!readOnly && <HistoryPlugin />}

        {/* Only track changes when editable and callback provided */}
        {!readOnly && onContentChange ? <OnChangePlugin onChange={editorState => {
        const markdown = editorState.read(() => $convertToMarkdownString(ALL_TRANSFORMERS, undefined, true));
        onContentChange(markdown);
      }} /> : null}

        {/* Instant word count — computed inside WebView, only a number crosses the bridge */}
        {!readOnly && onWordCountChange ? <WordCountPlugin onWordCountChange={onWordCountChange} /> : null}

        {/* Sync content with Legend State */}
        <ContentSyncer content={initialContent || ''} revision={contentRevision} />
      </div>
    </LexicalComposer>;
};

/**
 * Generate theme-aware styles for Lexical editor on mobile using passed theme values
 * Avoids useTheme hook issues in DOM context by accepting theme values as props
 */
const createMobileLexicalStyling = (themeValues?: {
  textColor: string;
  placeholderColor: string;
}, contentFont = 'Newsreader') => {
  const textColor = themeValues?.textColor || '#000000';
  const placeholderColor = themeValues?.placeholderColor || '#999999';
  return {
    root: {
      color: textColor,
      background: 'transparent',
      height: '100%',
      fontFamily: contentFont
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
      wordWrap: 'break-word' as const
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
      userSelect: 'none' as const
    }
  };
};
export default LexicalEditor;