import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useTheme, useReducedMotion } from '@my/ui'
import { X } from '@tamagui/lucide-icons'
import { BlurView } from 'expo-blur'
import { use$ } from '@legendapp/state/react'
import { useEffect, useRef, useState } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ephemeral$,
  store$,
  updateActiveFlowContent,
  recordThresholdCrossingIfNeeded,
  registerEditorContentFlush,
  setPersistentEditorFocused,
  discardInlineSession,
} from 'app/state/store'
import { DEFAULT_FONT_PAIRING, FONT_PAIRING_FAMILIES } from 'app/state/types'
import { useDebouncedCallback } from 'use-debounce'
import { hubEditorTranslateX } from 'app/features/navigation/hubPagerState'
import {
  INLINE_CLOSE_WORD_LIMIT,
  INLINE_EXPANDED_TOP_GAP,
  INLINE_TOP_ROW_CONTROL_OVERHANG,
  INLINE_TOP_ROW_HEIGHT,
} from '../inlineEditorLayout'
import LexicalEditor from './Lexical/LexicalEditor'
import type { LexicalEditorUniversalProps } from './Lexical/LexicalEditor.types'

/** Spring for the inline editor's slide between its collapsed and expanded anchors — mirrors `designEnter` on native. */
const INLINE_SLIDE_SPRING = { stiffness: 80, damping: 20, mass: 1 }

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
 *    The WebView always spans from the top of the screen down to the bar and
 *    the document keeps `insets.top + expandedTop` clear above its first line
 *    (a CSS inset, set once), so the words start under the top row and, once
 *    the page is long, earlier lines scroll up beneath it and the status bar.
 *    What changes between the two states is only the clip around the WebView:
 *    collapsed clips to the writing area under the hero so the hero stays
 *    tappable; expanded reveals the whole page. The WebView's own frame never
 *    moves at the switch, so nothing can jump. The band the words scroll under
 *    — the status bar and the top row — is frosted like a system bar so what is
 *    beneath stays legible, and the × that abandons the page is drawn above it
 *    all, in the spot the home screen's Menu link occupies.
 *
 * Coordinates: the overlay's containing block is the root gesture host,
 * which spans the safe area — the same box every screen measures its
 * geometry in — so reported anchors apply directly. Do not add the insets
 * again (that once placed the frame a status bar too low).
 */
/** Whether a hex colour reads as dark — picks the blur material that suits the page. */
const isDarkColor = (color: string): boolean => {
  const hex = color.trim().match(/^#([0-9a-f]{6})/i)?.[1]
  if (!hex) return false
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5
}

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
  // Inline: the document's top inset (see the class comment). The page is
  // revealed only once the WebView has acknowledged the inset, so its first
  // paint has the words where the frame expects them.
  const documentInsetTop = isInline ? insets.top + anchorTop : 0
  const [appliedInsetTop, setAppliedInsetTop] = useState(0)
  const insetReady = !isInline || appliedInsetTop === documentInsetTop
  // Show when visible AND the anchoring geometry has been measured (prevents a
  // flash at the top of the screen before the first layout report).
  const shouldShow =
    persistentEditor.isVisible &&
    anchorTop > 0 &&
    (!isInline || persistentEditor.inlineTop > 0) &&
    insetReady
  // Inline + collapsed: how far below the expanded anchor the editor rests.
  const collapsedOffset =
    isInline && !persistentEditor.expanded
      ? Math.max(0, persistentEditor.inlineTop - persistentEditor.expandedTop)
      : 0
  // The WebView document carries no margin of its own (see injectLayoutCSS),
  // so the container edge IS the text edge.
  const insetX = isInline ? persistentEditor.insetX : 0
  // The clip: collapsed → the writing area under the hero; expanded → the
  // whole screen (above the safe area). Screen mode clips at its anchor.
  const clipTop = isInline
    ? persistentEditor.expanded
      ? -insets.top
      : persistentEditor.inlineTop
    : anchorTop
  // Inline: the WebView is placed so its top is the top of the SCREEN whatever
  // the clip does, and sized down to the bar, so the switch never re-lays it out.
  const editorTop = isInline ? -(insets.top + clipTop) : 0

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

  // ── The × (inline writing mode) ─────────────────────────────────────────
  // Abandons the page — a flow is written once — so it is offered only while
  // the page is at most a few words long, and returns if they are deleted.
  // Drawn here rather than by the home screen because in writing mode the
  // frame covers the top row, and the control must sit above the WebView to
  // be tappable. Placed where the Menu link sits, which it replaces.
  const wordCount = use$(ephemeral$.instantWordCount)
  const closeVisible = isInline && persistentEditor.expanded && wordCount <= INLINE_CLOSE_WORD_LIMIT
  const closeOpacity = useSharedValue(0)
  useEffect(() => {
    closeOpacity.value = withTiming(closeVisible ? 1 : 0, { duration: reduceMotion ? 100 : 200 })
  }, [closeVisible, reduceMotion, closeOpacity])
  const closeAnimatedStyle = useAnimatedStyle(() => ({
    opacity: closeOpacity.value,
    transform: [{ translateX: hubEditorTranslateX.value }],
  }))
  const closeStyle = {
    position: 'absolute' as const,
    top: persistentEditor.expandedTop - INLINE_EXPANDED_TOP_GAP - INLINE_TOP_ROW_HEIGHT,
    right: Math.max(0, persistentEditor.insetX - INLINE_TOP_ROW_CONTROL_OVERHANG),
    width: INLINE_TOP_ROW_HEIGHT,
    height: INLINE_TOP_ROW_HEIGHT,
    zIndex: 101,
  }

  // ── The frosted band (inline writing mode) ──────────────────────────────
  // A system material blurs the WebView's text that has scrolled under the
  // status bar — only the strip the OS draws in (clock, signal, the
  // back-to-app link), not the top row below it, which is clear until the ×
  // needs it and by then there is nothing to scroll. A wash of the page
  // background on top keeps the band in the theme's colour and takes the
  // words down to a murmur, the way a translucent bar does. Sits between the
  // WebView and the ×, fades with writing mode, and lets touches through.
  // Collapsed, the clip hides everything above the hero anyway. (Android's
  // expo-blur renders a plain translucent wash unless its experimental
  // renderer is opted into.)
  const pageBackground = theme.background?.val ?? '#ffffff'
  const bandVisible = isInline && persistentEditor.expanded
  const bandOpacity = useSharedValue(0)
  useEffect(() => {
    bandOpacity.value = withTiming(bandVisible ? 1 : 0, { duration: reduceMotion ? 100 : 200 })
  }, [bandVisible, reduceMotion, bandOpacity])
  const bandAnimatedStyle = useAnimatedStyle(() => ({
    opacity: bandOpacity.value,
    transform: [{ translateX: hubEditorTranslateX.value }],
  }))
  const bandStyle = {
    position: 'absolute' as const,
    top: -insets.top,
    left: 0,
    right: 0,
    height: insets.top,
    zIndex: 100,
  }

  const keyboardHeight = use$(ephemeral$.keyboardHeight)

  // The frame ends where the bottom bar begins. The bar sits at the bottom of
  // the same safe-area box, and KeyboardOffsetView lifts it by however much
  // the keyboard rises above the home-indicator inset, so the frame's bottom
  // is the bar's height plus that lift.
  //
  // When hidden, move offscreen instead of relying on opacity alone —
  // Expo DOM WebViews render in a separate native layer and ignore
  // parent opacity on Android.
  const keyboardLift = Math.max(0, keyboardHeight - insets.bottom)
  const { height: windowHeight } = useWindowDimensions()
  const editorHeight =
    windowHeight - insets.bottom - persistentEditor.bottomBarHeight - keyboardLift
  const editorStyle = isInline
    ? { position: 'absolute' as const, top: editorTop, left: 0, right: 0, height: editorHeight }
    : styles.editorWrapper
  const containerStyle = {
    position: 'absolute' as const,
    top: shouldShow ? clipTop : -9999,
    left: insetX,
    right: insetX,
    bottom: shouldShow ? persistentEditor.bottomBarHeight + keyboardLift : undefined,
    height: shouldShow ? undefined : 0,
    zIndex: 100,
    overflow: 'hidden' as const,
    // box-none: only the editor itself takes touches, so in the collapsed
    // inline state the empty band above it passes taps through to home.
    pointerEvents: shouldShow ? ('box-none' as const) : ('none' as const),
  }

  return (
    <>
      <Animated.View style={[containerStyle, containerAnimatedStyle]}>
        <Animated.View style={[editorStyle, editorAnimatedStyle]}>
          <View style={styles.editorWrapper}>
            <UniversalLexicalEditor
              themeValues={themeValues}
              fontFamilies={fontFamilies}
              onContentChange={persistentEditor.readOnly ? undefined : handleContentChange}
              onWordCountChange={persistentEditor.readOnly ? undefined : handleWordCountChange}
              onFocusChange={persistentEditor.readOnly ? undefined : setPersistentEditorFocused}
              blurRequest={persistentEditor.blurRequest}
              topInset={documentInsetTop}
              onTopInsetApplied={setAppliedInsetTop}
              initialContent={persistentEditor.initialContent}
              contentRevision={persistentEditor.initialContentRevision}
              readOnly={persistentEditor.readOnly}
              focusMode={focusMode}
              focusGranularity={focusGranularity}
              dom={{
                hideKeyboardAccessoryView: true,
                // The WebView reaches under the status bar in writing mode; the room
                // for it is the document's own inset, never an iOS one.
                contentInsetAdjustmentBehavior: 'never',
                automaticallyAdjustContentInsets: false,
              }}
            />
          </View>
        </Animated.View>
      </Animated.View>
      {isInline && shouldShow ? (
        <Animated.View
          style={[bandStyle, bandAnimatedStyle]}
          pointerEvents="none"
        >
          <BlurView
            intensity={60}
            tint={isDarkColor(pageBackground) ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: pageBackground, opacity: 0.55 }]}
          />
        </Animated.View>
      ) : null}
      {isInline && shouldShow ? (
        <Animated.View
          style={[closeStyle, closeAnimatedStyle]}
          pointerEvents={closeVisible ? 'auto' : 'none'}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard and close"
            onPress={discardInlineSession}
            style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
          >
            <X
              size={20}
              color={theme.color9?.val ?? theme.color?.val ?? '#000000'}
            />
          </Pressable>
        </Animated.View>
      ) : null}
    </>
  )
}
const styles = StyleSheet.create({
  editorWrapper: {
    flex: 1,
    width: '100%',
  },
  closeButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonPressed: {
    opacity: 0.6,
  },
})
