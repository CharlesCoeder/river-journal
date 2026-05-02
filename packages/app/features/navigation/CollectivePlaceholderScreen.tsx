import { YStack, Text } from '@my/ui'
import { WordLinkNav } from './WordLinkNav'

export function CollectivePlaceholderScreen() {
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
      <YStack flex={1} alignItems="center" justifyContent="center">
        <Text fontFamily="$body" fontSize="$4" color="$color8">
          Collective — coming soon
        </Text>
      </YStack>
    </YStack>
  )
}

export default CollectivePlaceholderScreen
