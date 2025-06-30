import { useRef, useState, useEffect } from 'react'
import { useWindowDimensions } from 'react-native'
import { useKeyboardHandler } from 'react-native-keyboard-controller'
import { runOnJS } from 'react-native-reanimated'
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
  const { height: screenHeight } = useWindowDimensions()

  // State for tracking focus, scroll behavior, and content size
  const [isTextAreaFocused, setIsTextAreaFocused] = useState(false)
  const [currentScrollY, setCurrentScrollY] = useState(0)
  const [intendedScrollY, setIntendedScrollY] = useState(0) // Track where we intend to scroll to
  const [previousContentHeight, setPreviousContentHeight] = useState(0)
  const [textAreaLayout, setTextAreaLayout] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [isUserScrolling, setIsUserScrolling] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  // Use keyboard controller to get real-time keyboard height
  useKeyboardHandler(
    {
      onMove: (event) => {
        'worklet'
        // Update state on the JS thread
        runOnJS(setKeyboardHeight)(Math.max(event.height, 0))
      },
    },
    []
  )

  const textAreaRef = useRef<any>(null)
  const scrollViewRef = useRef<any>(null)
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Configuration
  const autoScrollThreshold = screenHeight * 0.33 // Auto-scroll when cursor is in lower third of screen

  const handleFocus = (event: any) => {
    setIsTextAreaFocused(true)
    textAreaProps.onFocus?.(event)
  }

  const handleBlur = (event: any) => {
    setIsTextAreaFocused(false)
    textAreaProps.onBlur?.(event)
  }

  const handleLayout = (event: any) => {
    const { x, y, width, height } = event.nativeEvent.layout
    setTextAreaLayout({ x, y, width, height })
  }

  const handleContentSizeChange = (event: any) => {
    const { height: newContentHeight } = event.nativeEvent.contentSize

    // Only auto-scroll if:
    // 1. Content height increased (new lines added)
    // 2. TextArea is focused
    // 3. User is not manually scrolling
    // 4. Cursor is in the auto-scroll zone (lower third of visible area)
    if (
      newContentHeight > previousContentHeight &&
      isTextAreaFocused &&
      !isUserScrolling &&
      previousContentHeight > 0 // Avoid initial render scroll
    ) {
      const heightIncrease = newContentHeight - previousContentHeight

      // Use the intended scroll position instead of current to handle rapid changes
      // This prevents compounding errors when multiple scroll animations are in progress
      const baseScrollY = Math.max(intendedScrollY, currentScrollY)

      // Calculate if we should auto-scroll based on current cursor position
      // If the textarea extends beyond the auto-scroll threshold, scroll to maintain position
      const textAreaBottom = textAreaLayout.y + newContentHeight - baseScrollY
      const shouldAutoScroll = textAreaBottom > autoScrollThreshold

      if (shouldAutoScroll) {
        const targetScrollY = baseScrollY + heightIncrease

        // Update intended scroll position immediately to avoid race conditions
        setIntendedScrollY(targetScrollY)

        if (scrollViewRef.current) {
          scrollViewRef.current.scrollTo({
            y: Math.max(0, targetScrollY),
            animated: true,
          })
        }
      }
    }

    setPreviousContentHeight(newContentHeight)
  }

  const handleTextChange = (newText: string) => {
    textAreaProps.onChangeText?.(newText)
  }

  const handleScrollBeginDrag = () => {
    setIsUserScrolling(true)

    // Clear any existing timeout
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current)
    }
  }

  const handleScrollEndDrag = () => {
    // Set a timeout to re-enable auto-scroll after user stops scrolling
    userScrollTimeoutRef.current = setTimeout(() => {
      setIsUserScrolling(false)
    }, 1000) // Wait 1 second after user stops scrolling
  }

  const handleScroll = (event: any) => {
    const scrollY = event.nativeEvent.contentOffset.y
    setCurrentScrollY(scrollY)

    // If user is manually scrolling, sync intended position to current position
    if (isUserScrolling) {
      setIntendedScrollY(scrollY)
    }
  }

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current)
      }
    }
  }, [])

  // Reset content height tracking when text area loses focus
  useEffect(() => {
    if (!isTextAreaFocused) {
      setPreviousContentHeight(0)
      setIntendedScrollY(0)
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
        onContentSizeChange={handleContentSizeChange}
        onLayout={handleLayout}
      />
    </ScrollView>
  )
}
