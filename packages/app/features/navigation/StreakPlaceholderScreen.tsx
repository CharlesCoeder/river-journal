// Note: this file was named "StreakPlaceholderScreen" when it held a coming-soon stub.
// The function name is kept as-is to avoid downstream import updates across three platform routes.
// The screen is no longer a placeholder — it renders the real Streak/Profile screen body.

import { YStack, Text } from '@my/ui'
import { WordLinkNav } from './WordLinkNav'
import { GraceDayInventory } from 'app/features/streak/GraceDayInventory'

export function StreakPlaceholderScreen() {
  return (
    <YStack
      flex={1}
      backgroundColor="$background"
      width="100%"
      maxWidth={1024}
      alignSelf="center"
      paddingHorizontal="$4"
      paddingTop="$4"
      paddingBottom={96}
      $sm={{ paddingHorizontal: '$6' }}
      $md={{ paddingHorizontal: '$8', paddingTop: '$8' }}
      $lg={{ paddingHorizontal: '$12', paddingTop: '$12' }}
    >
      <WordLinkNav variant="browse" />
      <YStack flex={1} alignItems="center" justifyContent="flex-start" gap="$6" paddingTop="$8">
        <Text fontFamily="$body" fontSize="$5" color="$color">Your streak</Text>
        <GraceDayInventory />
      </YStack>
    </YStack>
  )
}

export default StreakPlaceholderScreen
