import { YStack, XStack, H1, Button } from '@my/ui'
import { ArrowLeft } from '@tamagui/lucide-icons'
import { useRouter } from 'solito/navigation'
import { Editor } from './components/Editor'

export function JournalScreen() {
  const router = useRouter()

  const handleBackToHome = () => {
    router.push('/')
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
      <XStack gap="$4" alignItems="center">
        <Button
          size="$3"
          circular
          onPress={handleBackToHome}
          icon={ArrowLeft}
          backgroundColor="$background"
          borderColor="$borderColor"
        />
        <YStack>
          <H1 size="$11" fontFamily="$patrickHand">
            River Journal
          </H1>
        </YStack>
      </XStack>
      <Editor />
    </YStack>
  )
}
