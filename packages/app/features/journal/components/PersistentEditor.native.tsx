import { View, StyleSheet, Animated } from 'react-native';
import { useTheme } from '@my/ui';
import { use$ } from '@legendapp/state/react';
import { useEffect, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ephemeral$, updateActiveFlowContent } from 'app/state/store';
import { useDebouncedCallback } from 'use-debounce';
import LexicalEditor from './Lexical/LexicalEditor';
import type { LexicalEditorUniversalProps } from './Lexical/LexicalEditor.types';

/**
 * Persistent Lexical editor that remains mounted at root layout level.
 * Visibility and content are controlled via Legend State.
 *
 * This eliminates WebView re-initialization delays by keeping a single
 * WebView instance alive throughout the app lifecycle.
 *
 * Only used on native platforms - web uses per-screen editors.
 *
 * Positioning: Uses safe area insets + reported header height instead of
 * measureInWindow, which returns incorrect coordinates on Android.
 */
export const PersistentEditor = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const persistentEditor = use$(ephemeral$.persistentEditor);

  // Animated value for fade-in effect
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const themeValues = {
    textColor: theme.color.val,
    placeholderColor: theme.placeholderColor.val
  };

  // Debounced function to update Legend State from editor changes
  const debouncedUpdateStore = useDebouncedCallback((markdown: string) => {
    if (persistentEditor.readOnly) return;
    updateActiveFlowContent(markdown);
  }, 300);

  // Cancel any pending debounced writes when the editor hides,
  // otherwise a stale keystroke can overwrite the cleared activeFlow.
  useEffect(() => {
    if (!persistentEditor.isVisible) {
      debouncedUpdateStore.cancel();
    }
  }, [persistentEditor.isVisible, debouncedUpdateStore]);

  // Handle content changes from the editor
  const handleContentChange = (markdown: string) => {
    if (persistentEditor.readOnly) return;
    debouncedUpdateStore(markdown);
  };

  // Cast to universal props to handle platform differences
  const UniversalLexicalEditor = LexicalEditor as React.FC<LexicalEditorUniversalProps>;

  // Show when visible AND we know the header height (to prevent flash at top)
  const shouldShow = persistentEditor.isVisible && persistentEditor.headerHeight > 0;

  // Animate opacity when shouldShow changes
  useEffect(() => {
    if (shouldShow) {
      // Fade in with a slight delay to match screen transition
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        delay: 50,
        // Small delay to let the screen transition start
        useNativeDriver: true
      }).start();
    } else {
      // Immediately hide (no animation needed for hiding)
      fadeAnim.setValue(0);
    }
    // Cleanup animation on unmount
    return () => {
      fadeAnim.stopAnimation();
    };
  }, [shouldShow, fadeAnim]);

  // Position below the header using safe area insets + header height.
  // This is inside a SafeAreaView at root layout level.
  // Absolute children position from SafeAreaView's bounds (y=0 = screen top),
  // so we add insets.top (status bar) + headerHeight to start below the header.
  //
  // When hidden, move offscreen instead of relying on opacity alone —
  // Expo DOM WebViews render in a separate native layer and ignore
  // parent opacity on Android.
  const containerStyle = {
    position: 'absolute' as const,
    top: shouldShow ? insets.top + persistentEditor.headerHeight : -9999,
    left: 0,
    right: 0,
    bottom: shouldShow ? persistentEditor.bottomBarHeight + insets.bottom : undefined,
    height: shouldShow ? undefined : 0,
    zIndex: 100,
    overflow: 'hidden' as const
  };
  return <Animated.View style={[containerStyle, {
    opacity: fadeAnim,
    pointerEvents: shouldShow ? 'auto' : 'none'
  }]}>
      <View style={styles.editorWrapper}>
        <UniversalLexicalEditor themeValues={themeValues} onContentChange={persistentEditor.readOnly ? undefined : handleContentChange} initialContent={persistentEditor.content} readOnly={persistentEditor.readOnly} />
      </View>
    </Animated.View>;
};
const styles = StyleSheet.create({
  editorWrapper: {
    flex: 1,
    width: '100%'
  }
});