import { Input as TamaguiInput, TextArea as TamaguiTextArea, styled } from 'tamagui'

// Keep the field geometry every form here was designed around. Tamagui 3 defaults
// to a smaller size ladder whose radius names the v5 config does not define.
// Exported from the package barrel, where these take precedence over
// `export * from 'tamagui'`.
export const Input = styled(TamaguiInput, {
  height: 44,
  borderRadius: '4',
  paddingHorizontal: 16,
  paddingVertical: 0,
})

export const TextArea = styled(TamaguiTextArea, {
  height: 88,
  minHeight: 88,
  borderRadius: '4',
  paddingHorizontal: 16,
  paddingVertical: '3',
})
