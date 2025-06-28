import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Animated, Platform, useWindowDimensions, Easing } from 'react-native'
import { TextArea } from 'tamagui'
import type { TextAreaProps } from 'tamagui'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// Keyboard controller and reanimated imports - only available on mobile
let useKeyboardHandler: any = null
let useSharedValue: any = null
let runOnJS: any = null

if (Platform.OS === 'ios' || Platform.OS === 'android') {
  try {
    const keyboardController = require('react-native-keyboard-controller')
    useKeyboardHandler = keyboardController.useKeyboardHandler
  } catch (error) {
    // Silently handle missing dependency
  }

  try {
    const reanimated = require('react-native-reanimated')
    useSharedValue = reanimated.useSharedValue
    runOnJS = reanimated.runOnJS
  } catch (error) {
    // Silently handle missing dependency
  }
}

export interface ResizeableTextAreaProps extends TextAreaProps {
  /**
   * Extra padding to maintain above keyboard when it appears
   */
  keyboardPadding?: number
  /**
   * Minimum height constraint for the text area
   */
  minHeight?: number
}

export function ResizeableTextArea({
  keyboardPadding = 20,
  minHeight = 150,
  ...textAreaProps
}: ResizeableTextAreaProps) {
  const isMobile = Platform.OS === 'ios' || Platform.OS === 'android'
  const { height: screenHeight } = useWindowDimensions()
  const safeAreaInsets = useSafeAreaInsets()

  const [componentTop, setComponentTop] = useState(0)
  const animatedHeight = useRef(new Animated.Value(0)).current
  const keyboardHeight = useSharedValue ? useSharedValue(0) : { value: 0 }
  const [currentKeyboardHeight, setCurrentKeyboardHeight] = useState(0)

  // Set up keyboard handler
  if (isMobile && useKeyboardHandler) {
    useKeyboardHandler(
      {
        onStart: () => {
          'worklet'
        },
        onMove: (e: any) => {
          'worklet'
          keyboardHeight.value = e.height
          if (runOnJS) {
            runOnJS(setCurrentKeyboardHeight)(e.height)
          }
        },
        onEnd: () => {
          'worklet'
        },
      },
      []
    )
  }

  const handleLayout = (event: any) => {
    const { y } = event.nativeEvent.layout
    setComponentTop(y)
  }

  const calculateAvailableHeight = useCallback(
    (keyboardHeightValue: number) => {
      if (!isMobile || componentTop === 0) {
        return undefined
      }

      const availableHeight =
        screenHeight - componentTop - keyboardHeightValue - safeAreaInsets.bottom - keyboardPadding

      return Math.max(availableHeight, minHeight)
    },
    [isMobile, componentTop, screenHeight, safeAreaInsets.bottom, keyboardPadding, minHeight]
  )

  const getNumericHeight = (height: any): number => {
    if (typeof height === 'number') return height
    return minHeight
  }

  const initialHeight = getNumericHeight(textAreaProps.height) || minHeight

  // Animate height when keyboard changes
  useEffect(() => {
    if (componentTop > 0 && isMobile && currentKeyboardHeight > 0) {
      const newHeight = calculateAvailableHeight(currentKeyboardHeight)

      if (newHeight !== undefined) {
        Animated.timing(animatedHeight, {
          toValue: newHeight,
          duration: 0, // Instant to isolate timing issues
          useNativeDriver: false,
          easing: Easing.bezier(0.38, 0.7, 0.125, 1), // iOS-native keyboard easing
        }).start()
      }
    } else if (componentTop > 0 && isMobile && currentKeyboardHeight === 0) {
      Animated.timing(animatedHeight, {
        toValue: initialHeight,
        duration: 250, // Instant keyboard dismiss timing
        useNativeDriver: false,
        easing: Easing.bezier(0.42, 0, 0.58, 1), // iOS-native keyboard easing
      }).start()
    }
  }, [
    currentKeyboardHeight,
    componentTop,
    calculateAvailableHeight,
    animatedHeight,
    isMobile,
    initialHeight,
  ])

  const handleFocus = (event: any) => {
    textAreaProps.onFocus?.(event)
  }

  const handleBlur = (event: any) => {
    textAreaProps.onBlur?.(event)
  }

  // For web/desktop, use standard TextArea
  if (!isMobile) {
    return <TextArea {...textAreaProps} minHeight={minHeight} />
  }

  // Initialize animated value
  useEffect(() => {
    if (isMobile) {
      animatedHeight.setValue(initialHeight)
    }
  }, [animatedHeight, initialHeight, isMobile])

  const animatedStyle = {
    height: componentTop > 0 ? animatedHeight : initialHeight,
  }

  const { height: _, ...restTextAreaProps } = textAreaProps

  return (
    <Animated.View style={animatedStyle} onLayout={handleLayout}>
      <TextArea
        {...restTextAreaProps}
        flex={1}
        height={undefined}
        minHeight={undefined}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    </Animated.View>
  )
}
