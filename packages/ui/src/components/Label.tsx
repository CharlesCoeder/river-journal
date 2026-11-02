import { Label as TamaguiLabel, isWeb, styled } from 'tamagui'

// Keeps the label type and 44px row height the forms here were designed around.
// Tamagui 3's size ladder would set the font, size and leading on native, so native
// opts out of it. Exported from the package barrel, where it takes precedence over
// `export * from 'tamagui'`.
export const Label = styled(TamaguiLabel, {
  ...(isWeb ? null : ({ size: false } as object)),
  fontSize: 'web:16',
  lineHeight: '44px',
})
