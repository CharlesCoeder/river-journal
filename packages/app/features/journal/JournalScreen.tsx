import { View, Text, ThemeSwitcher, YStack, XStack } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { theme$ } from 'app/state/theme'
import { useEffect } from 'react'

export function JournalScreen() {
  const theme = use$(theme$)

  useEffect(() => {
    console.log('theme', theme)
  }, [])

  return (
    <XStack backgroundColor="$background">
      <YStack backgroundColor="$background">
        <ThemeSwitcher />
        <Text color="$color">{theme.colorTheme}</Text>
      </YStack>
    </XStack>
  )
}
