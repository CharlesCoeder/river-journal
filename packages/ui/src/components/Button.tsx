import type { ReactNode } from 'react'
import { Button as TamaguiButton, Text, createStyledHOC, styled } from 'tamagui'

const ButtonFrame = styled(TamaguiButton, {
  height: 44,
  minHeight: 0,
  paddingHorizontal: '4',
  paddingVertical: 0,
  borderRadius: '4',
  gap: 9,

  variants: {
    // The smaller button: Tamagui 2's size 3.
    compact: {
      true: {
        height: 36,
        paddingHorizontal: '3',
        borderRadius: '3',
        gap: 7,
      },
    },
    // No fill, border, padding or fixed height. Layout comes from the caller.
    unstyled: {
      true: {
        backgroundColor: 'transparent',
        borderWidth: 0,
        height: 'auto',
        paddingHorizontal: 0,
        borderRadius: 0,
        gap: 0,
        cursor: 'auto',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
    },
  } as const,
})

const isPlainText = (children: ReactNode) =>
  typeof children === 'string' ||
  (Array.isArray(children) && children.every((child) => typeof child === 'string'))

// App skin over Tamagui's Button, keeping the geometry and label type every screen
// here was designed around. Tamagui 3 draws plain-text labels semibold on a smaller
// size ladder. Exported from the package barrel, where it takes precedence over
// `export * from 'tamagui'`.
export const Button = createStyledHOC(ButtonFrame, function Button(props, ref) {
  const { children, compact } = props as { children?: ReactNode; compact?: boolean }
  return (
    <ButtonFrame
      ref={ref}
      size={false}
      {...props}
    >
      {isPlainText(children) ? (
        <Text
          fontSize={compact ? 12 : 16}
          lineHeight={compact ? '23px' : 'web:normal'}
          fontWeight="400"
          color="color"
          userSelect="none"
          flexShrink={1}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </ButtonFrame>
  )
})
