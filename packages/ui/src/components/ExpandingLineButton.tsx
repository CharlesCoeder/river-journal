import { useEffect, useState } from 'react'
import { AccessibilityInfo, Platform } from 'react-native'
import { Stack, Text, View } from 'tamagui'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// useReducedMotion — cross-platform helper
// ---------------------------------------------------------------------------
function useReducedMotion(): boolean {
  const getInitial = (): boolean => {
    if (Platform.OS !== 'web') return false
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  const [reduceMotion, setReduceMotion] = useState<boolean>(getInitial)

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      const handler = (e: MediaQueryListEvent) => setReduceMotion(e.matches)
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
    // Native path
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => sub.remove()
  }, [])

  return reduceMotion
}

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
    <Stack
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
        height={2}
        backgroundColor="$color"
        flexShrink={0}
        pointerEvents="none"
        animation={reduceMotion ? undefined : 'smoothCollapse'}
      />
      {/* Label */}
      <Text
        fontFamily="$body"
        fontSize={size === 'cta' ? '$6' : '$4'}
        color="$color"
        letterSpacing={0.5}
        textTransform="uppercase"
        paddingRight="$2"
        pointerEvents="none"
        numberOfLines={1}
        whiteSpace="nowrap"
      >
        {children}
      </Text>
    </Stack>
  )
}
