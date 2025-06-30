import { useRef, useState, useEffect, forwardRef } from 'react'
import { useWindowDimensions } from 'react-native'
import { useKeyboardHandler } from 'react-native-keyboard-controller'
import { runOnJS } from 'react-native-reanimated'
import { ScrollView, TextArea, styled } from '@my/ui'
import type { GetProps } from '@my/ui'

// 1. Create a base styled component for the text area.
// This is where you define the core, reusable styles and variants.
const StyledJournalArea = styled(TextArea, {
  name: 'JournalTextArea', // Giving it a name allows for component-specific sub-themes.
  flex: 1,

  // Default styles are defined here.
  fontSize: '$5',
  lineHeight: '$6',
  padding: '$3',
  borderRadius: '$4',
  borderWidth: 0,

  // Default theme-aware styles. These will automatically update with the theme.
  backgroundColor: '$backgroundHover',
  placeholderTextColor: '$color',

  // Focus state - remove borders and outline
  focusStyle: {
    borderWidth: 0,
    outlineWidth: 0,
    outlineStyle: 'none',
  },

  // Example of adding a responsive style directly to the definition.
  $gtSm: {
    minHeight: 120,
    fontSize: '$4',
    padding: '$4',
  },
  $gtMd: {
    minHeight: 150,
    fontSize: '$5',
    padding: '$4',
  },
})

// 2. Define the props for the final component.
// GetProps extracts all props from the styled component, including its variants. [cite: 1789]
type JournalTextAreaProps = GetProps<typeof StyledJournalArea> & {
  keyboardPadding?: number
  minHeight?: number
}

// 3. Create the final component, which handles complex logic.
// We use forwardRef to allow passing a ref to the underlying ScrollView.
export const JournalTextArea = forwardRef(
  (
    { keyboardPadding = 20, minHeight = 150, ...textAreaProps }: JournalTextAreaProps,
    ref: React.ForwardedRef<ScrollView>
  ) => {
    // --- All of your existing hooks and logic for keyboard handling remain the same ---
    const { height: screenHeight } = useWindowDimensions()
    const [isTextAreaFocused, setIsTextAreaFocused] = useState(false)
    const [currentScrollY, setCurrentScrollY] = useState(0)
    const [intendedScrollY, setIntendedScrollY] = useState(0)
    const [previousContentHeight, setPreviousContentHeight] = useState(0)
    const [textAreaLayout, setTextAreaLayout] = useState({ x: 0, y: 0, width: 0, height: 0 })
    const [isUserScrolling, setIsUserScrolling] = useState(false)
    const [keyboardHeight, setKeyboardHeight] = useState(0)

    const textAreaRef = useRef<any>(null)
    const scrollViewRef = useRef<any>(null)
    const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    // Configuration
    const autoScrollThreshold = screenHeight * 0.33

    useKeyboardHandler(
      {
        onMove: (event) => {
          'worklet'
          runOnJS(setKeyboardHeight)(Math.max(event.height, 0))
        },
      },
      []
    )

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
      if (
        newContentHeight > previousContentHeight &&
        isTextAreaFocused &&
        !isUserScrolling &&
        previousContentHeight > 0
      ) {
        const heightIncrease = newContentHeight - previousContentHeight
        const baseScrollY = Math.max(intendedScrollY, currentScrollY)
        const textAreaBottom = textAreaLayout.y + newContentHeight - baseScrollY
        const shouldAutoScroll = textAreaBottom > autoScrollThreshold

        if (shouldAutoScroll) {
          const targetScrollY = baseScrollY + heightIncrease
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
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current)
      }
    }

    const handleScrollEndDrag = () => {
      userScrollTimeoutRef.current = setTimeout(() => {
        setIsUserScrolling(false)
      }, 1000)
    }

    const handleScroll = (event: any) => {
      const scrollY = event.nativeEvent.contentOffset.y
      setCurrentScrollY(scrollY)
      if (isUserScrolling) {
        setIntendedScrollY(scrollY)
      }
    }

    useEffect(() => {
      return () => {
        if (userScrollTimeoutRef.current) {
          clearTimeout(userScrollTimeoutRef.current)
        }
      }
    }, [])

    useEffect(() => {
      if (!isTextAreaFocused) {
        setPreviousContentHeight(0)
        setIntendedScrollY(0)
      }
    }, [isTextAreaFocused])
    // --- End of logic section ---

    return (
      <ScrollView
        ref={(scrollView) => {
          scrollViewRef.current = scrollView
          if (ref) {
            if (typeof ref === 'function') {
              ref(scrollView)
            } else {
              ref.current = scrollView
            }
          }
        }}
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
        <StyledJournalArea
          {...textAreaProps}
          ref={textAreaRef}
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
)
