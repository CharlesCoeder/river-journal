// src/journal/components/LexicalSync.tsx

import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useObserve } from '@legendapp/state/react';
import { useDebouncedCallback } from 'use-debounce';

// Import Lexical's core and its markdown utilities
import { $getRoot } from 'lexical';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { ALL_TRANSFORMERS } from './transformers';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';

// Import Legend State store and actions
import {
  journal$,
  updateActiveFlowContent,
  getActiveFlowContent,
} from '../../../../state/journal/store';

/**
 * A non-rendering component that creates a robust, two-way, debounced
 * synchronization between the Lexical editor and the Legend State
 * `journal$.activeFlow` observable. This component is the bridge
 * that enables fine-grained reactivity for the editor.
 */
export function LexicalSync(): React.ReactElement {
  const [editor] = useLexicalComposerContext();

  // A ref to prevent infinite loops. When the store updates the editor,
  // we set this flag to prevent the editor's update listener from
  // immediately re-updating the store with the same content.
  const isSyncingFromState = useRef(false);

  // ------------------------------------------------------------------
  // Flow 1: Syncing from Legend State --> Lexical Editor
  // This hook runs side-effects when an observable changes.
  // ------------------------------------------------------------------
  useObserve(journal$.activeFlow.content, ({ value: contentFromState }) => {
    // If the change was initiated by our own debounced update from the
    // editor, we ignore it to prevent the loop.
    if (isSyncingFromState.current) {
      return;
    }

    const editorState = editor.getEditorState();
    const editorContent = editorState.read(() =>
      $convertToMarkdownString(ALL_TRANSFORMERS, undefined, true)
    );

    // Only update the editor if its content is actually different from the state.
    if (editorContent !== contentFromState) {
      editor.update(() => {
        // Programmatically update the editor's content from the store's markdown.
        $getRoot().clear();
        $convertFromMarkdownString(contentFromState ?? '', ALL_TRANSFORMERS, undefined, true);
      });
    }
  });

  // ------------------------------------------------------------------
  // Flow 2: Syncing from Lexical Editor --> Legend State
  // This uses Lexical's OnChangePlugin and debounces updates for performance.
  // ------------------------------------------------------------------
  const debouncedUpdateStore = useDebouncedCallback((markdown: string) => {
    // Set the ref to true BEFORE updating the store. This signals to our
    // `useObserve` hook that this change is internal and should be ignored.
    isSyncingFromState.current = true;
    
    updateActiveFlowContent(markdown); // This function internally uses batch()
    
    // Reset the flag in the next browser paint cycle. This safely ensures
    // that any subsequent external changes to the store are captured.
    requestAnimationFrame(() => {
      isSyncingFromState.current = false;
    });
  }, 300); // 300ms debounce delay

  // Effect to set the initial state of the editor when it first mounts.
  // This is crucial for restoring an unsaved draft from a previous session.
  useEffect(() => {
    const initialContent = getActiveFlowContent();
    if (initialContent) {
      editor.update(() => {
        $getRoot().clear();
        $convertFromMarkdownString(initialContent, ALL_TRANSFORMERS, undefined, true);
      }, {
        tag: 'history-merge' // Prevents this initial state from being part of the undo stack.
      });
    }
    // This effect should only run once when the editor is initialized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return (
    <OnChangePlugin
      onChange={(editorState) => {
        const markdown = editorState.read(() =>
          $convertToMarkdownString(ALL_TRANSFORMERS, undefined, true)
        );
        debouncedUpdateStore(markdown);
      }}
    />
  );
}