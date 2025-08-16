import { ThemeSwitcher, YStack, XStack, H1 } from '@my/ui'
import { Text } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { theme$ } from 'app/state/theme'
import { Editor } from './components/Editor'

export function JournalScreen() {
  const theme = use$(theme$)

  return (
    <YStack
      width="75%"
      maxWidth="75%"
      backgroundColor="$background"
      gap="$8"
      flex={1}
      alignItems="flex-start"
      justifyContent="flex-start"
      alignSelf="flex-start"
      marginLeft="12.5%"
      paddingTop="$8"
    >
      <YStack>
        <H1 size="$11" fontFamily="$patrickHand">
          River Journal
        </H1>
        <Text fontSize="$6" fontFamily="$sourceSans3" fontWeight="700" fontStyle="italic">
          Custom body font
        </Text>
      </YStack>

      <ThemeSwitcher />
      <Editor />
    </YStack>
  )
}
