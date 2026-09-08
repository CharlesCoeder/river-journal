import { View, StyleSheet } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useTheme, useReducedMotion } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { useEffect, useRef } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ephemeral$,
  store$,
  updateActiveFlowContent,
  recordThresholdCrossingIfNeeded,
  registerEditorContentFlush,
  setPersistentEditorFocused,
} from 'app/state/store'
import { DEFAULT_FONT_PAIRING, FONT_PAIRING_FAMILIES } from 'app/state/types'
import { useDebouncedCallback } from 'use-debounce'
import { hubEditorTranslateX } from 'app/features/navigation/hubPagerState'
import LexicalEditor from './Lexical/LexicalEditor'
import type { LexicalEditorUniversalProps } from './Lexical/LexicalEditor.types'

/** Spring for the inline editor's slide between its collapsed and expanded anchors — mirrors `designEnter` on native. */
const INLINE_SLIDE_SPRING = { stiffness: 80, damping: 20, mass: 1 }

/**
 * The DOM WebView's document keeps the browser's default 8px body margin, so
 * the editor text already sits 8px in from the container edge. Inline mode
 * subtracts it when lining the text up with the home chrome's padding.
 */
const WEBVIEW_BODY_MARGIN = 8

/**
 * Persistent Lexical editor that remains mounted at root layout level.
 * Visibility and content are controlled via Legend State.
 *
 * This eliminates WebView re-initialization delays by keeping a single
 * WebView instance alive throughout the app lifecycle.
 *
 * Only used on native platforms - web uses per-screen editors.
 *
 * Positioning: Uses safe area insets + reported geometry instead of
 * measureInWindow, which returns incorrect coordinates on Android.
 *
 * Two layout modes (see PersistentEditorState.layoutMode):
 *  - 'screen': JournalScreen — anchored below the measured header, full width.
 *  - 'inline': the home screen's writing area. The container is laid out at
 *    the EXPANDED geometry and, while collapsed, the editor is translated down
 *    to the collapsed anchor with a transform. A transform never re-lays-out
 *    the WebView (no text reflow mid-animation), and the region above the
 *    translated editor is `box-none` so taps there reach the home chrome.
 */
export const PersistentEditor = () => {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const reduceMotion = useReducedMotion()
  const persistentEditor = use$(ephemeral$.persistentEditor)

  const fontPairing = use$(store$.profile.fontPairing) ?? DEFAULT_FONT_PAIRING
  const families = FONT_PAIRING_FAMILIES[fontPairing]
  // Focus mode — read where the native editor is instantiated (web reads these in
  // JournalScreen; PersistentEditor.native is the equivalent read site on native).
  const focusMode = use$(store$.profile?.editor?.focusMode) ?? false
  const focusGranularity = use$(store$.profile?.editor?.focusGranularity) ?? 'paragraph'
  const themeValues = {
    textColor: theme.color?.val ?? '#000000',
    placeholderColor: theme.placeholderColor?.val ?? '#999999',
  }
  const fontFamilies = {
    content: families.native,
    placeholder: families.native,
  }

  // Debounced function to update Legend State from editor changes.
  // maxWait guarantees a checkpoint at least once per second of continuous
  // typing, so the store copy never lags arbitrarily far behind the editor.
  const debouncedUpdateStore = useDebouncedCallback(
    (markdown: string) => {
      if (persistentEditor.readOnly) return
      updateActiveFlowContent(markdown)
    },
    300,
    { maxWait: 1000 }
  )

  // Expose the pending-write flush to save/hide/exit paths (in the store) so
  // they can checkpoint the last burst of typing before reading the store.
  useEffect(() => {
    return registerEditorContentFlush(() => debouncedUpdateStore.flush())
  }, [debouncedUpdateStore])

  // Cancel any pending debounced writes once the editor is hidden. The real
  // flush happens synchronously in hidePersistentEditor() BEFORE the flow is
  // cleared; anything still pending here is a post-hide editor event (e.g. the
  // programmatic '' content clear) that must not overwrite the cleared activeFlow.
  useEffect(() => {
    if (!persistentEditor.isVisible) {
      debouncedUpdateStore.cancel()
    }
  }, [persistentEditor.isVisible, debouncedUpdateStore])

  // Handle content changes from the editor (debounced for persistence/sync)
  const handleContentChange = (markdown: string) => {
    if (persistentEditor.readOnly) return
    debouncedUpdateStore(markdown)
  }

  // Word count is computed inside the WebView and sent as a number,
  // bypassing both the 300ms debounce and full-content bridge serialization.
  const handleWordCountChange = (count: number) => {
    ephemeral$.instantWordCount.set(count)
    recordThresholdCrossingIfNeeded(count)
  }

  // Cast to universal props to handle platform differences.
  // `dom` is an Expo DOM-component prop (forwarded to the underlying WebView)
  // that is not part of the shared Lexical prop types.
  const UniversalLexicalEditor = LexicalEditor as React.FC<
    LexicalEditorUniversalProps & { dom?: Record<string, unknown> }
  >

  // ── Geometry ────────────────────────────────────────────────────────────
  const isInline = persistentEditor.layoutMode === 'inline'
  const anchorTop = isInline ? persistentEditor.expandedTop : persistentEditor.headerHeight
  // Show when visible AND the anchoring geometry has been measured (prevents a
  // flash at the top of the screen before the first layout report).
  const shouldShow =
    persistentEditor.isVisible && anchorTop > 0 && (!isInline || persistentEditor.inlineTop > 0)
  // Inline + collapsed: how far below the expanded anchor the editor rests.
  const collapsedOffset =
    isInline && !persistentEditor.expanded
      ? Math.max(0, persistentEditor.inlineTop - persistentEditor.expandedTop)
      : 0
  const insetX = isInline ? Math.max(0, persistentEditor.insetX - WEBVIEW_BODY_MARGIN) : 0

  // ── Animation ───────────────────────────────────────────────────────────
  const opacity = useSharedValue(0)
  const translateY = useSharedValue(collapsedOffset)

  useEffect(() => {
    if (shouldShow) {
      // Fade in with a slight delay to let the screen transition start.
      opacity.value = withDelay(50, withTiming(1, { duration: 250 }))
    } else {
      // Immediately hide (no animation needed for hiding).
      opacity.value = 0
    }
  }, [shouldShow, opacity])

  // Slide between collapsed/expanded only while visible; on first show snap
  // straight to the target so the editor never visibly slides into place.
  const wasShowingRef = useRef(false)
  useEffect(() => {
    const animate = shouldShow && wasShowingRef.current
    wasShowingRef.current = shouldShow
    if (!animate) {
      translateY.value = collapsedOffset
      return
    }
    translateY.value = reduceMotion
      ? withTiming(collapsedOffset, { duration: 100 })
      : withSpring(collapsedOffset, INLINE_SLIDE_SPRING)
  }, [collapsedOffset, shouldShow, reduceMotion, translateY])

  // Horizontally the overlay follows the hub pager (hubPagerState) by a
  // transform, so it slides with its page without re-laying-out the WebView.
  // With no pager on screen the offset is 0.
  const containerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: hubEditorTranslateX.value }],
  }))
  const editorAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }))

  const keyboardHeight = use$(ephemeral$.keyboardHeight)

  // Position below the anchor using safe area insets + reported geometry.
  // This is inside a SafeAreaView at root layout level.
  // Absolute children position from SafeAreaView's bounds (y=0 = screen top),
  // so we add insets.top (status bar) + anchorTop to start below the chrome.
  //
  // When the keyboard is open its height (from screen bottom) replaces
  // insets.bottom since the keyboard covers the home indicator area.
  //
  // When hidden, move offscreen instead of relying on opacity alone —
  // Expo DOM WebViews render in a separate native layer and ignore
  // parent opacity on Android.
  const bottomInset = keyboardHeight > 0 ? keyboardHeight : insets.bottom
  const containerStyle = {
    position: 'absolute' as const,
    top: shouldShow ? insets.top + anchorTop : -9999,
    left: insetX,
    right: insetX,
    bottom: shouldShow ? persistentEditor.bottomBarHeight + bottomInset : undefined,
    height: shouldShow ? undefined : 0,
    zIndex: 100,
    overflow: 'hidden' as const,
    // box-none: only the editor itself takes touches, so in the collapsed
    // inline state the empty band above it passes taps through to home.
    pointerEvents: shouldShow ? ('box-none' as const) : ('none' as const),
  }

  return (
    <Animated.View style={[containerStyle, containerAnimatedStyle]}>
      <Animated.View style={[styles.editorWrapper, editorAnimatedStyle]}>
        <View style={styles.editorWrapper}>
          <UniversalLexicalEditor
            themeValues={themeValues}
            fontFamilies={fontFamilies}
            onContentChange={persistentEditor.readOnly ? undefined : handleContentChange}
            onWordCountChange={persistentEditor.readOnly ? undefined : handleWordCountChange}
            onFocusChange={persistentEditor.readOnly ? undefined : setPersistentEditorFocused}
            blurRequest={persistentEditor.blurRequest}
            initialContent={persistentEditor.initialContent}
            contentRevision={persistentEditor.initialContentRevision}
            readOnly={persistentEditor.readOnly}
            focusMode={focusMode}
            focusGranularity={focusGranularity}
            dom={{
              hideKeyboardAccessoryView: true,
            }}
          />
        </View>
      </Animated.View>
    </Animated.View>
  )
}
const styles = StyleSheet.create({
  editorWrapper: {
    flex: 1,
    width: '100%',
  },
})
