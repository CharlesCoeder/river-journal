import { Label as TamaguiLabel, styled } from 'tamagui'

// Keeps the label type and 44px row height the forms here were designed around.
// Exported from the package barrel, where it takes precedence over
// `export * from 'tamagui'`.
export const Label = styled(TamaguiLabel, {
  fontSize: 16,
  lineHeight: '44px',
})
