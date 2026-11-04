import { inputPlaceholderColor } from './inputPlaceholderColor'
import {
  Input as TamaguiInput,
  TextArea as TamaguiTextArea,
  createStyledHOC,
  isWeb,
  styled,
} from 'tamagui'

const InputFrame = styled(TamaguiInput, {
  height: 44,
  borderRadius: '4',
  paddingHorizontal: 16,
  paddingVertical: 0,
})

// On native, text areas here size to their content and use the plain theme colors.
// Tamagui 3 applies its TextArea theme there, so these name the plain values.
const TextAreaFrame = styled(TamaguiTextArea, {
  height: 'web:88',
  minHeight: 'web:88',
  borderRadius: '4',
  paddingHorizontal: 16,
  paddingVertical: '3',
  backgroundColor: 'background native:color1',
  borderColor: 'border-color hover:border-color-hover focus:border-color-focus native:color4',
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
      placeholderTextColor={inputPlaceholderColor as never}
      {...props}
    />
  )
})

// Tamagui 3 derives a native text area's height from its row count, and that height
// beats style props, so only an inline style can restore sizing to content.
const nativeContentHeight = { height: 'auto' } as const

export const TextArea = createStyledHOC(TextAreaFrame, function TextArea(props, ref) {
  return (
    <TextAreaFrame
      ref={ref}
      size={false}
      {...props}
      style={isWeb ? props.style : [nativeContentHeight, props.style]}
    />
  )
})
