import { Text, YStack } from '@my/ui'

/**
 * Placeholder menu route — slide-left destination for the gesture wrapper.
 * Story 1.3 will replace the contents of this screen with MenuSurface.
 */
export default function MenuScreen() {
  return (
    <YStack flex={1} alignItems="center" justifyContent="center">
      <Text>Menu (placeholder)</Text>
    </YStack>
  )
}
