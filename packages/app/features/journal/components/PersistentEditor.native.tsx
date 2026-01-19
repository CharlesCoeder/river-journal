import { View, StyleSheet, Animated } from 'react-native'
import { useTheme } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { useEffect, useRef } from 'react'
import { ephemeral$, updateActiveFlowContent } from 'app/state/store'
import { useDebouncedCallback } from 'use-debounce'
import LexicalEditor from './Lexical/LexicalEditor'
import type { LexicalEditorUniversalProps } from './Lexical/LexicalEditor.types'

/**
 * Persistent Lexical editor that remains mounted at root layout level.
 * Visibility and content are controlled via Legend State.
 *
 * This eliminates WebView re-initialization delays by keeping a single
 * WebView instance alive throughout the app lifecycle.
 *
 * Only used on native platforms - web uses per-screen editors.
 */
export const PersistentEditor = () => {
  const theme = useTheme()
  const persistentEditor = use$(ephemeral$.persistentEditor)

  // Animated value for fade-in effect
  const fadeAnim = useRef(new Animated.Value(0)).current

  const themeValues = {
    textColor: theme.color.val,
    placeholderColor: theme.placeholderColor.val,
  }

  // Debounced function to update Legend State from editor changes
  const debouncedUpdateStore = useDebouncedCallback((markdown: string) => {
    if (persistentEditor.readOnly) return
    updateActiveFlowContent(markdown)
  }, 300)

  // Handle content changes from the editor
  const handleContentChange = (markdown: string) => {
    if (persistentEditor.readOnly) return
    debouncedUpdateStore(markdown)
  }

  // Cast to universal props to handle platform differences
  const UniversalLexicalEditor = LexicalEditor as React.FC<LexicalEditorUniversalProps>

  // Calculate positioning based on layout bounds from the placeholder
  const layout = persistentEditor.layout

  // Only show when visible AND we have layout measurements to prevent flash at top
  const shouldShow = persistentEditor.isVisible && layout !== null

  // Animate opacity when shouldShow changes
  useEffect(() => {
    if (shouldShow) {
      // Fade in with a slight delay to match screen transition
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        delay: 50, // Small delay to let the screen transition start
        useNativeDriver: true,
      }).start()
    } else {
      // Immediately hide (no animation needed for hiding)
      fadeAnim.setValue(0)
    }
    // Cleanup animation on unmount
    return () => {
      fadeAnim.stopAnimation()
    }
  }, [shouldShow, fadeAnim])

  const containerStyle = layout
    ? {
        position: 'absolute' as const,
        top: layout.top,
        left: layout.left,
        width: layout.width,
        height: layout.height,
        zIndex: 100,
      }
    : styles.containerFallback

  return (
    <Animated.View
      style={[
        containerStyle,
        {
          opacity: fadeAnim,
          pointerEvents: shouldShow ? 'auto' : 'none',
        },
      ]}
    >
      <View style={styles.editorWrapper}>
        <UniversalLexicalEditor
          themeValues={themeValues}
          onContentChange={persistentEditor.readOnly ? undefined : handleContentChange}
          initialContent={persistentEditor.content}
          readOnly={persistentEditor.readOnly}
        />
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  // Fallback when no layout bounds are available (full screen)
  containerFallback: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  editorWrapper: {
    flex: 1,
    width: '100%',
  },
})
