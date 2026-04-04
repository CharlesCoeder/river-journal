import { useState } from 'react'
import { XStack, Text, View } from '@my/ui'

interface ExpandingLineButtonProps {
  label: string
  onPress: () => void
  lineWidth?: number
  lineHoverWidth?: number
}

export function ExpandingLineButton({
  label,
  onPress,
  lineWidth = 16,
  lineHoverWidth = 24,
}: ExpandingLineButtonProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <XStack
      cursor="pointer"
      alignItems="center"
      onPress={onPress}
      flexShrink={0}
      flexDirection="row-reverse"
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
    >
      <View
        width={hovered ? lineHoverWidth : lineWidth}
        height={1}
        backgroundColor="$color"
        flexShrink={0}
        transition="smoothCollapse"
        pointerEvents="none"
      />
      <Text
        fontFamily="$body"
        fontSize={14}
        color="$color"
        letterSpacing={0.5}
        whiteSpace="nowrap"
        paddingRight="$2"
        pointerEvents="none"
      >
        {label}
      </Text>
    </XStack>
  )
}
