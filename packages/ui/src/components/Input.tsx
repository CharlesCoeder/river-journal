import {
  Input as TamaguiInput,
  TextArea as TamaguiTextArea,
  createStyledHOC,
  styled,
} from 'tamagui'

const InputFrame = styled(TamaguiInput, {
  height: 44,
  borderRadius: '4',
  paddingHorizontal: 16,
  paddingVertical: 0,
})

const TextAreaFrame = styled(TamaguiTextArea, {
  height: 88,
  minHeight: 88,
  borderRadius: '4',
  paddingHorizontal: 16,
  paddingVertical: '3',
})

// Keep the field geometry every form here was designed around. Tamagui 3 defaults
// to a smaller size ladder whose inline padding beats a caller's paddingHorizontal
// on native, so these opt out of it. Exported from the package barrel, where they
// take precedence over `export * from 'tamagui'`.
export const Input = createStyledHOC(InputFrame, function Input(props, ref) {
  return (
    <InputFrame
      ref={ref}
      size={false}
      {...props}
    />
  )
})

export const TextArea = createStyledHOC(TextAreaFrame, function TextArea(props, ref) {
  return (
    <TextAreaFrame
      ref={ref}
      size={false}
      {...props}
    />
  )
})
