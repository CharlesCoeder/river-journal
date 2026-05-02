import { useEffect, useState } from 'react'
import { Text, View } from 'tamagui'
import type { ReactNode } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'

// ---------------------------------------------------------------------------
// ExpandingLineButton
// ---------------------------------------------------------------------------

export interface ExpandingLineButtonProps {
  children: ReactNode
  onPress?: () => void
  size?: 'default' | 'cta'
  disabled?: boolean
  accessibilityLabel?: string
}

export function ExpandingLineButton({
  children,
  onPress,
  size = 'default',
  disabled = false,
  accessibilityLabel,
}: ExpandingLineButtonProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const reduceMotion = useReducedMotion()

  // Reset hover/press/focus state when disabled becomes true (no onHoverOut may fire)
  useEffect(() => {
    if (disabled) {
      setIsHovered(false)
      setIsPressed(false)
      setIsFocused(false)
    }
  }, [disabled])

  const isActive = !disabled && (isPressed || isHovered || isFocused)
  const lineWidth = isActive ? 24 : 16

  return (
    <View
      tag="button"
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? (typeof children === 'string' ? children : undefined)
      }
      accessibilityState={{ disabled }}
      aria-disabled={disabled || undefined}
      cursor={disabled ? 'not-allowed' : 'pointer'}
      alignItems="center"
      flexDirection="row-reverse"
      flexShrink={0}
      opacity={disabled ? 0.4 : 1}
      disabled={disabled}
      onHoverIn={disabled ? undefined : () => setIsHovered(true)}
      onHoverOut={disabled ? undefined : () => setIsHovered(false)}
      onPressIn={disabled ? undefined : () => setIsPressed(true)}
      onPressOut={disabled ? undefined : () => setIsPressed(false)}
      onPress={disabled ? undefined : () => onPress?.()}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      // Remove default button chrome
      backgroundColor="transparent"
      borderWidth={0}
      padding={0}
      outlineWidth={0}
      // Suppress browser default outline; underline growth serves as the focus indicator
      focusStyle={{
        outlineWidth: 0,
        outlineStyle: 'none',
      }}
      focusVisibleStyle={{
        outlineWidth: 0,
        outlineStyle: 'none',
      }}
    >
      {/* Expanding underline */}
      <View
        width={lineWidth}
        height={1}
        backgroundColor="$color"
        flexShrink={0}
        pointerEvents="none"
        transition={reduceMotion ? undefined : 'smoothCollapse'}
      />
      {/* Label */}
      <Text
        fontFamily="$body"
        fontSize={size === 'cta' ? '$6' : '$4'}
        color="$color"
        letterSpacing={0.5}
        paddingRight="$2"
        pointerEvents="none"
        numberOfLines={1}
        whiteSpace="nowrap"
      >
        {children}
      </Text>
    </View>
  )
}
