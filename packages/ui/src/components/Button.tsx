import type { ReactNode } from 'react'
import { Button as TamaguiButton, Text, Theme, createStyledHOC, isWeb, styled } from 'tamagui'

const ButtonFrame = styled(TamaguiButton, {
  height: 44,
  minHeight: 0,
  paddingHorizontal: '4',
  paddingVertical: 0,
  borderRadius: '4',
  gap: 9,
  // Tamagui 3 fades pressed buttons and keeps the border transparent on hover and
  // press. Screens here were designed around a border that appears and no fade. On
  // native the fade cannot be overridden from here, so it still shows.
  borderColor: 'transparent hover:border-color-hover press:border-color-hover',
  opacity: 1,

  variants: {
    // Tamagui 3's outlined and quiet buttons have no hover or press colors.
    variant: {
      outlined: {
        backgroundColor: 'transparent',
        borderColor: 'border-color hover:border-color-hover press:border-color-press',
      },
      quiet: {
        backgroundColor: 'transparent hover:background-hover press:background-press',
        borderColor: 'transparent press:border-color-hover',
      },
    },
    // Tamagui 3 dims disabled buttons. Callers here set their own disabled look.
    disabled: {
      true: {
        opacity: 1,
      },
    },
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
        borderColor: 'transparent',
        borderWidth: 0,
        height: 'auto',
        paddingHorizontal: 0,
        borderRadius: 0,
        gap: 0,
        cursor: 'auto',
        flexDirection: 'column',
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
// size ladder, and no longer applies the Button theme that gives buttons their fill
// and border on native. Exported from the package barrel, where it takes precedence
// over `export * from 'tamagui'`.
export const Button = createStyledHOC(ButtonFrame, function Button(props, ref) {
  const { children, compact } = props as { children?: ReactNode; compact?: boolean }
  const button = (
    <ButtonFrame
      ref={ref}
      size={false}
      {...props}
    >
      {isPlainText(children) ? (
        <Text
          fontFamily={compact && !isWeb ? 'body' : undefined}
          fontSize={compact ? 12 : 'web:16'}
          lineHeight={compact ? '23px' : 'web:normal'}
          fontWeight={compact ? '400' : 'web:400'}
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
  return isWeb ? button : <Theme name="Button">{button}</Theme>
})
