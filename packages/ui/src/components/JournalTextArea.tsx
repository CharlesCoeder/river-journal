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

  // State for tracking cursor and scroll behavior
  const [isTextAreaFocused, setIsTextAreaFocused] = useState(false)
  const [currentScrollY, setCurrentScrollY] = useState(0)
  const [lastCursorPosition, setLastCursorPosition] = useState({ line: 0, y: 0 })
  const [textAreaLayout, setTextAreaLayout] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [isUserScrolling, setIsUserScrolling] = useState(false)

  const textAreaRef = useRef<any>(null)
  const scrollViewRef = useRef<any>(null)
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Configuration
  const lineHeight = 24 // Adjust based on your font size
  const autoScrollThreshold = lineHeight * 2 // Start auto-scroll after just 2 lines (48px from top)
  const keyboardHeight = 350 // Approximate keyboard height

  const handleFocus = (event: any) => {
    // biome-ignore lint/suspicious/noConsoleLog: debugging focus state
    console.log('🎯 TextArea focused')
    setIsTextAreaFocused(true)
    textAreaProps.onFocus?.(event)
  }

  const handleBlur = (event: any) => {
    // biome-ignore lint/suspicious/noConsoleLog: debugging focus state
    console.log('😴 TextArea blurred')
    setIsTextAreaFocused(false)
    textAreaProps.onBlur?.(event)
  }

  const handleLayout = (event: any) => {
    const { x, y, width, height } = event.nativeEvent.layout
    setTextAreaLayout({ x, y, width, height })
    // biome-ignore lint/suspicious/noConsoleLog: debugging layout
    console.log('📐 TextArea layout:', { x, y, width, height })
  }

  const calculateCursorLine = (text: string, cursorPosition: number): number => {
    if (!text || cursorPosition === 0) {
      // biome-ignore lint/suspicious/noConsoleLog: debugging cursor line calculation
      console.log('📊 calculateCursorLine: early return (no text or cursor at 0)')
      return 0
    }

    // Get text up to cursor position
    const textUpToCursor = text.slice(0, cursorPosition)

    // For text wrapping calculation
    const averageCharWidth = 8 // Approximate character width in pixels
    const textAreaWidth = textAreaLayout.width - 32 // Account for padding
    const charsPerLine = Math.floor(textAreaWidth / averageCharWidth)

    // biome-ignore lint/suspicious/noConsoleLog: debugging cursor line calculation
    console.log('📊 calculateCursorLine:', {
      cursorPosition,
      textLength: text.length,
      textUpToCursorLength: textUpToCursor.length,
      textAreaWidth,
      charsPerLine,
    })

    if (charsPerLine <= 0) {
      // Fallback to counting explicit newlines only
      const explicitNewlines = (textUpToCursor.match(/\n/g) || []).length
      // biome-ignore lint/suspicious/noConsoleLog: debugging cursor line calculation
      console.log('📊 calculateCursorLine: using explicit newlines only (charsPerLine <= 0)', {
        explicitNewlines,
      })
      return explicitNewlines
    }

    // Calculate total visual lines by simulating text wrapping
    let totalLines = 0
    let currentLineLength = 0

    for (let i = 0; i < textUpToCursor.length; i++) {
      const char = textUpToCursor[i]

      if (char === '\n') {
        // Explicit newline - start a new line
        totalLines++
        currentLineLength = 0
        // biome-ignore lint/suspicious/noConsoleLog: debugging cursor line calculation
        console.log(`📊 Explicit newline at pos ${i}, totalLines: ${totalLines}`)
      } else {
        // Regular character
        currentLineLength++

        // Check if we've reached the wrap point
        if (currentLineLength >= charsPerLine) {
          totalLines++
          currentLineLength = 0
          // biome-ignore lint/suspicious/noConsoleLog: debugging cursor line calculation
          console.log(`📊 Text wrap at pos ${i}, totalLines: ${totalLines}`)
        }
      }
    }

    // biome-ignore lint/suspicious/noConsoleLog: debugging cursor line calculation
    console.log('📊 calculateCursorLine result:', {
      totalLines,
      currentLineLength,
      finalResult: totalLines,
    })

    return totalLines
  }

  const handleSelectionChange = (event: any) => {
    // biome-ignore lint/suspicious/noConsoleLog: debugging selection change trigger
    console.log('🔄 handleSelectionChange triggered', {
      isTextAreaFocused,
      isMobile,
      isUserScrolling,
    })

    if (!isTextAreaFocused || !isMobile || isUserScrolling) {
      // biome-ignore lint/suspicious/noConsoleLog: debugging early return
      console.log('❌ Early return from handleSelectionChange')
      return
    }

    const { selection } = event.nativeEvent
    const { start } = selection
    const text = textAreaProps.value || ''

    // biome-ignore lint/suspicious/noConsoleLog: debugging selection data
    console.log('📝 Selection data:', { start, textLength: text.length, textAreaLayout })

    const currentLine = calculateCursorLine(text, start)
    const currentCursorY = currentLine * lineHeight

    // Calculate cursor position relative to screen (accounting for scroll and textarea position)
    const cursorScreenY = textAreaLayout.y + currentCursorY - currentScrollY

    // biome-ignore lint/suspicious/noConsoleLog: debugging cursor position
    console.log(`📍 Cursor - Line: ${currentLine}, Y: ${currentCursorY}, ScreenY: ${cursorScreenY}`)

    // biome-ignore lint/suspicious/noConsoleLog: debugging line comparison
    console.log('🔍 Line comparison:', {
      currentLine,
      lastLine: lastCursorPosition.line,
      lineIncrease: currentLine > lastCursorPosition.line,
      cursorScreenY,
      autoScrollThreshold,
      aboveThreshold: cursorScreenY > autoScrollThreshold,
      pastLine2: currentLine >= 2,
      shouldAutoScroll:
        currentLine > lastCursorPosition.line &&
        (cursorScreenY > autoScrollThreshold || currentLine >= 2),
    })

    // Check if we moved to a new line and cursor is in the auto-scroll zone
    // OR if we're past line 2 (always auto-scroll after the first couple lines)
    const shouldAutoScroll =
      currentLine > lastCursorPosition.line &&
      (cursorScreenY > autoScrollThreshold || currentLine >= 2)

    if (shouldAutoScroll) {
      const linesDifference = currentLine - lastCursorPosition.line
      const scrollAmount = linesDifference * lineHeight + 12
      const targetScrollY = currentScrollY + scrollAmount

      // biome-ignore lint/suspicious/noConsoleLog: debugging auto-scroll behavior
      console.log(`🚀 Auto-scrolling ${scrollAmount}px for ${linesDifference} new line(s)`, {
        currentScrollY,
        targetScrollY,
        scrollViewRef: !!scrollViewRef.current,
      })

      // Scroll to keep the new line at the same visual position as the previous line
      if (scrollViewRef.current) {
        scrollViewRef.current.scrollTo({
          y: Math.max(0, targetScrollY),
          animated: true,
        })
        // biome-ignore lint/suspicious/noConsoleLog: debugging scroll execution
        console.log('✅ ScrollTo executed')
      } else {
        // biome-ignore lint/suspicious/noConsoleLog: debugging scroll ref issue
        console.log('❌ ScrollView ref is null')
      }
    } else {
      // biome-ignore lint/suspicious/noConsoleLog: debugging no scroll reason
      console.log('⏸️ No auto-scroll needed:', {
        lineIncreased: currentLine > lastCursorPosition.line,
        inScrollZone: cursorScreenY > autoScrollThreshold,
      })
    }

    setLastCursorPosition({ line: currentLine, y: currentCursorY })
  }

  const handleTextChange = (newText: string) => {
    // biome-ignore lint/suspicious/noConsoleLog: debugging text change
    console.log('✏️ Text changed:', { newLength: newText.length, preview: newText.slice(-20) })

    const oldText = textAreaProps.value || ''
    const textWasAdded = newText.length > oldText.length
    const addedText = textWasAdded ? newText.slice(oldText.length) : ''
    const newlineWasAdded = addedText.includes('\n')

    // biome-ignore lint/suspicious/noConsoleLog: debugging newline detection
    console.log('🔍 Text change analysis:', {
      textWasAdded,
      addedText: JSON.stringify(addedText),
      newlineWasAdded,
      oldLength: oldText.length,
      newLength: newText.length,
    })

    // If a newline was just added and we're past line 2, auto-scroll immediately
    if (newlineWasAdded && textWasAdded && isTextAreaFocused && isMobile && !isUserScrolling) {
      // Calculate current line after the new text
      const currentLine = calculateCursorLine(newText, newText.length)

      if (currentLine >= 2) {
        const scrollAmount = lineHeight + 12 // Same as before
        const targetScrollY = currentScrollY + scrollAmount

        // biome-ignore lint/suspicious/noConsoleLog: debugging immediate auto-scroll
        console.log('🚀 Immediate auto-scroll on newline:', {
          currentLine,
          scrollAmount,
          currentScrollY,
          targetScrollY,
        })

        if (scrollViewRef.current) {
          scrollViewRef.current.scrollTo({
            y: Math.max(0, targetScrollY),
            animated: true,
          })
          // biome-ignore lint/suspicious/noConsoleLog: debugging scroll execution
          console.log('✅ Immediate ScrollTo executed')
        }
      }
    }

    textAreaProps.onChangeText?.(newText)
  }

  const handleScrollBeginDrag = () => {
    // biome-ignore lint/suspicious/noConsoleLog: debugging scroll state
    console.log('👆 User started scrolling')
    setIsUserScrolling(true)

    // Clear any existing timeout
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current)
    }
  }

  const handleScrollEndDrag = () => {
    // biome-ignore lint/suspicious/noConsoleLog: debugging scroll state
    console.log('👆 User stopped scrolling, will re-enable auto-scroll in 1s')
    // Set a timeout to re-enable auto-scroll after user stops scrolling
    userScrollTimeoutRef.current = setTimeout(() => {
      // biome-ignore lint/suspicious/noConsoleLog: debugging scroll state
      console.log('✅ Auto-scroll re-enabled')
      setIsUserScrolling(false)
    }, 1000) // Wait 1 second after user stops scrolling
  }

  const handleScroll = (event: any) => {
    const scrollY = event.nativeEvent.contentOffset.y
    setCurrentScrollY(scrollY)
  }

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current)
      }
    }
  }, [])

  // Reset cursor tracking when text area loses focus
  useEffect(() => {
    if (!isTextAreaFocused) {
      setLastCursorPosition({ line: 0, y: 0 })
    }
  }, [isTextAreaFocused])

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
        paddingBottom: keyboardHeight + keyboardPadding,
      }}
      automaticallyAdjustKeyboardInsets={false}
      automaticallyAdjustContentInsets={false}
    >
      <TextArea
        {...textAreaProps}
        ref={textAreaRef}
        flex={1}
        minHeight={minHeight}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChangeText={handleTextChange}
        onSelectionChange={handleSelectionChange}
        onLayout={handleLayout}
      />
    </ScrollView>
  )
}
