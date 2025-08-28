import { YStack, H1, Button } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { Text } from '@my/ui'

export function HomeScreen() {
  const router = useRouter()

  const handleJournalScreen = () => {
    router.push('/journal')
  }

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
        <Text fontSize="$6" fontFamily="$sourceSans3" fontWeight="700">
          This will be the home page!
        </Text>
        <Button onPress={handleJournalScreen}>
          <Text fontSize="$6" fontFamily="$sourceSans3" fontWeight="700">
            Journal Screen
          </Text>
        </Button>
      </YStack>
    </YStack>
  )
}
