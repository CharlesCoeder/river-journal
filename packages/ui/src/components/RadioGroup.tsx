import type { ComponentProps } from 'react'
import { RadioGroup as TamaguiRadioGroup, Theme, isWeb, withStaticProperties } from 'tamagui'

function ThemedRadioGroupItem(props: ComponentProps<typeof TamaguiRadioGroup.Item>) {
  return (
    <Theme name="RadioGroupItem">
      <TamaguiRadioGroup.Item
        backgroundColor="background press:background-hover"
        borderColor="border-color"
        {...props}
      />
    </Theme>
  )
}

// Tamagui 3 no longer applies the theme that gives radio items their fill and border
// on native. Exported from the package barrel, where it takes precedence over
// `export * from 'tamagui'`.
export const RadioGroup = isWeb
  ? TamaguiRadioGroup
  : withStaticProperties(TamaguiRadioGroup, { Item: ThemedRadioGroupItem })
