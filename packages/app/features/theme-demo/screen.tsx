import { ThemeDemo, YStack } from '@my/ui'

export function ThemeDemoScreen() {
  return (
    <YStack
      flex={1}
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <ThemeDemo />
    </YStack>
  )
}
