import { YStack } from '@my/ui'
import ColorPicker, { Panel1, HueSlider } from 'reanimated-color-picker'
import { StyleSheet } from 'react-native'

export function InlineColorPicker({
  color,
  onChange,
}: {
  color: string
  onChange: (hex: string) => void
}) {
  return (
    <YStack
      borderRadius={12}
      borderWidth={1}
      borderColor="$color5"
      padding="$3"
    >
      <ColorPicker
        value={color}
        onCompleteJS={({ hex }) => onChange(hex)}
        style={styles.picker}
      >
        <Panel1 style={styles.panel} />
        <HueSlider style={styles.slider} />
      </ColorPicker>
    </YStack>
  )
}

const styles = StyleSheet.create({
  picker: { gap: 12 },
  panel: { height: 180, borderRadius: 8 },
  slider: { height: 28, borderRadius: 8 },
})
