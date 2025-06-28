import React, { useRef, useState, useEffect } from 'react'
import { Platform, useWindowDimensions } from 'react-native'
import { TextArea, ScrollView } from '@my/ui'
import type { TextAreaProps } from '@my/ui'

export interface JournalTextAreaProps extends TextAreaProps {
  /**
   * Extra padding to maintain above keyboard when it appears
   */
  keyboardPadding?: number
  /**
   * Minimum height constraint for the text area
   */
  minHeight?: number
}

export function JournalTextArea({
  keyboardPadding = 20,
  minHeight = 150,
  ...textAreaProps
}: JournalTextAreaProps) {
  const isMobile = Platform.OS === 'ios' || Platform.OS === 'android'
  const { height: screenHeight } = useWindowDimensions()

  // Simple state for scroll-focus interaction
  const [isScrolling, setIsScrolling] = useState(false)
  const [isTextAreaEditable, setIsTextAreaEditable] = useState(true)
  const [isTextAreaFocused, setIsTextAreaFocused] = useState(false)

  // Auto-scroll state
  const [cursorY, setCursorY] = useState(0)
  const [textAreaHeight, setTextAreaHeight] = useState(0)
  const [lastContentLength, setLastContentLength] = useState(0)
  const [currentScrollY, setCurrentScrollY] = useState(0)

  const textAreaRef = useRef<any>(null)
  const scrollViewRef = useRef<any>(null)

  // Keyboard appears around bottom 350px of screen, so start auto-scroll when cursor gets within 400px of bottom
  const keyboardHeight = 350 // Approximate keyboard height
  const dangerZoneFromBottom = 400 // Start auto-scroll when cursor gets this close to bottom
  const dangerZoneY = screenHeight - dangerZoneFromBottom // Actual Y position from top

  const handleFocus = (event: any) => {
    setIsTextAreaFocused(true)
    textAreaProps.onFocus?.(event)
  }

  const handleBlur = (event: any) => {
    setIsTextAreaFocused(false)
    textAreaProps.onBlur?.(event)
  }

  const handleContentSizeChange = (event: any) => {
    const { height } = event.nativeEvent.contentSize
    setTextAreaHeight(height)
  }

  const handleSelectionChange = (event: any) => {
    if (!isTextAreaFocused || !isMobile) return

    const { selection } = event.nativeEvent
    const { start } = selection

    // Estimate cursor Y position based on content and line height
    const approximateLineHeight = 24 // Adjust based on your font size
    const linesBeforeCursor = (textAreaProps.value || '').slice(0, start).split('\n').length - 1
    const estimatedCursorY = linesBeforeCursor * approximateLineHeight

    setCursorY(estimatedCursorY)

    // biome-ignore lint/suspicious/noConsoleLog: debugging cursor position
    console.log(
      `📍 Cursor - Y: ${estimatedCursorY}, Lines: ${linesBeforeCursor}, ScrollY: ${currentScrollY}`
    )
  }

  const handleTextChange = (newText: string) => {
    const previousLength = lastContentLength
    const newLength = newText.length
    const isTypingNewContent = newLength > previousLength
    const isNewLine = isTypingNewContent && newText.endsWith('\n')

    setLastContentLength(newLength)
    textAreaProps.onChangeText?.(newText)

    // Auto-scroll if typing new content and cursor is in danger zone
    if (isTypingNewContent && isTextAreaFocused && isMobile && scrollViewRef.current) {
      setTimeout(() => {
        const cursorScreenY = cursorY - currentScrollY // Where cursor appears on screen

        // biome-ignore lint/suspicious/noConsoleLog: debugging scroll behavior
        console.log(
          `🐛 Debug - CursorScreenY: ${cursorScreenY}, DangerZoneY: ${dangerZoneY}, ScrollY: ${currentScrollY}, CursorY: ${cursorY}`
        )

        if (cursorScreenY > dangerZoneY) {
          // Calculate scroll to keep current line at same visual position
          const lineHeight = 24
          const targetScrollY = isNewLine
            ? currentScrollY + lineHeight // New line: scroll up by one line height
            : currentScrollY + (cursorScreenY - dangerZoneY) // Regular typing: adjust to keep in safe zone

          // biome-ignore lint/suspicious/noConsoleLog: debugging scroll behavior
          console.log(`🐛 ScrollTo: ${targetScrollY} (current: ${currentScrollY})`)

          scrollViewRef.current.scrollTo({
            y: Math.max(0, targetScrollY),
            animated: true,
          })
        } else {
          // biome-ignore lint/suspicious/noConsoleLog: debugging scroll behavior
          console.log(
            `✅ No scroll needed - cursor at ${cursorScreenY}px, danger zone at ${dangerZoneY}px`
          )
        }
      }, 50) // Small delay to ensure TextArea has updated
    }
  }

  const handleScrollBeginDrag = () => {
    setIsScrolling(true)
    // Only disable editing if TextArea is not currently focused
    if (!isTextAreaFocused) {
      setIsTextAreaEditable(false)
    }
  }

  const handleScrollEndDrag = () => {
    setIsScrolling(false)
    // Re-enable editing after scroll ends
    if (!isTextAreaFocused) {
      setTimeout(() => setIsTextAreaEditable(true), 100)
    }
  }

  const handleScroll = (event: any) => {
    const scrollY = event.nativeEvent.contentOffset.y
    setCurrentScrollY(scrollY)
  }

  // Initialize content length tracking
  useEffect(() => {
    setLastContentLength((textAreaProps.value || '').length)
  }, [textAreaProps.value])

  return (
    <ScrollView
      ref={scrollViewRef}
      showsVerticalScrollIndicator={false}
      alwaysBounceVertical={true}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      onScrollBeginDrag={handleScrollBeginDrag}
      onScrollEndDrag={handleScrollEndDrag}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      contentContainerStyle={{
        flexGrow: 1,
        paddingBottom: 350, // Extra space to scroll content above keyboard
      }}
      automaticallyAdjustKeyboardInsets={false}
      automaticallyAdjustContentInsets={false}
    >
      <TextArea
        {...textAreaProps}
        ref={textAreaRef}
        flex={1}
        minHeight={minHeight}
        editable={isTextAreaEditable}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChangeText={handleTextChange}
        onSelectionChange={handleSelectionChange}
        onContentSizeChange={handleContentSizeChange}
      />
    </ScrollView>
  )
}
