import { useRef, useState, useEffect, forwardRef } from 'react'
import { useWindowDimensions } from 'react-native'
import { useKeyboardHandler } from 'react-native-keyboard-controller'
import { runOnJS } from 'react-native-reanimated'
import { TextArea, styled, YStack } from '@my/ui'
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

  // Ensure text starts at the top on both iOS and Android
  textAlignVertical: 'top',

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
  $sm: {
    fontSize: '$4',
    padding: '$4',
  },
  $md: {
    fontSize: '$5',
    padding: '$4',
  },
})

// 2. Define the props for the final component.
// GetProps extracts all props from the styled component, including its variants.
type JournalTextAreaProps = GetProps<typeof StyledJournalArea> & {
  keyboardPadding?: number
}

// 3. Create the final component with keyboard avoidance and auto-scroll.
// We use forwardRef to allow passing a ref to the underlying TextArea.
export const JournalTextArea = forwardRef<any, JournalTextAreaProps>(
  ({ keyboardPadding = 20, ...textAreaProps }, ref) => {
    const { height: screenHeight } = useWindowDimensions()
    const [keyboardHeight, setKeyboardHeight] = useState(0)
    const [isTextAreaFocused, setIsTextAreaFocused] = useState(false)
    const [previousContentHeight, setPreviousContentHeight] = useState(0)
    const [textAreaLayout, setTextAreaLayout] = useState({ height: 0 })

    const textAreaRef = useRef<any>(null)

    // Configuration for auto-scroll threshold
    const autoScrollThreshold = screenHeight * 0.4

    // Handle keyboard events using react-native-keyboard-controller
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
      const { height } = event.nativeEvent.layout
      setTextAreaLayout({ height })
    }

    const handleContentSizeChange = (event: any) => {
      const { height: newContentHeight } = event.nativeEvent.contentSize

      // Auto-scroll logic: if content grew and we're focused, scroll to end
      if (
        newContentHeight > previousContentHeight &&
        isTextAreaFocused &&
        previousContentHeight > 0 &&
        newContentHeight > textAreaLayout.height
      ) {
        // Check if we should auto-scroll based on content size vs visible area
        const availableHeight = screenHeight - keyboardHeight - keyboardPadding
        const shouldAutoScroll = newContentHeight > availableHeight * 0.6

        if (shouldAutoScroll && textAreaRef.current) {
          // Use a small delay to ensure the content has been rendered
          setTimeout(() => {
            if (textAreaRef.current) {
              // Scroll to the end of the content
              textAreaRef.current.scrollToEnd?.({ animated: true })
            }
          }, 50)
        }
      }
      setPreviousContentHeight(newContentHeight)
    }

    const handleTextChange = (newText: string) => {
      textAreaProps.onChangeText?.(newText)
    }

    useEffect(() => {
      if (!isTextAreaFocused) {
        setPreviousContentHeight(0)
      }
    }, [isTextAreaFocused])

    return (
      <YStack flex={1} paddingBottom={keyboardHeight + keyboardPadding}>
        <StyledJournalArea
          {...textAreaProps}
          ref={(textArea) => {
            textAreaRef.current = textArea
            if (ref) {
              if (typeof ref === 'function') {
                ref(textArea)
              } else {
                ref.current = textArea
              }
            }
          }}
          scrollEnabled={true}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChangeText={handleTextChange}
          onContentSizeChange={handleContentSizeChange}
          onLayout={handleLayout}
        />
      </YStack>
    )
  }
)
