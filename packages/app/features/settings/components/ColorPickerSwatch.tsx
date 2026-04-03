import { View } from '@my/ui'

export function ColorPickerSwatch({
  color,
  isValid,
  isActive,
  onPress,
}: {
  color: string
  isValid: boolean
  isActive?: boolean
  onPress: () => void
}) {
  return (
    <View
      width={32}
      height={32}
      borderRadius={6}
      borderWidth={isActive ? 2 : 1}
      borderColor={isActive ? '$color' : '$color5'}
      backgroundColor={isValid ? color : '$background'}
      cursor="pointer"
      onPress={onPress}
      hoverStyle={{ opacity: 0.85 }}
      pressStyle={{ opacity: 0.7 }}
    />
  )
}
