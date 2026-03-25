/**
 * CelebrationScreen.tsx
 *
 * Displays a warm celebration after completing a flow session.
 * Word count as hero, gentle fade-in, re-read section below.
 * Per UX spec: explicit dismissal only, no auto-dismiss.
 */

import { useEffect } from 'react'
import { YStack, Text, Button, ScrollView, Separator } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import { store$, clearLastSavedFlow, clearActiveFlow } from 'app/state/store'
import { Editor } from './components/Editor'

function getWarmMessage(): string {
  return 'Beautifully done.'
}

export function CelebrationScreen() {
  const router = useRouter()
  const lastSavedFlow = use$(store$.lastSavedFlow)

  // Clear the activeFlow on mount to complete the save transition
  useEffect(() => {
    clearActiveFlow()
  }, [])

  // Handle missing flow data
  useEffect(() => {
    if (!lastSavedFlow) {
      router.push('/')
    }
  }, [lastSavedFlow, router])

  const handleDismiss = () => {
    clearLastSavedFlow()
    router.push('/')
  }

  if (!lastSavedFlow) {
    return null
  }

  const { wordCount, content } = lastSavedFlow

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{
        flexGrow: 1,
      }}
    >
      <YStack
        width="100%"
        paddingHorizontal="$4"
        paddingTop="$10"
        paddingBottom="$10"
        flex={1}
        $sm={{
          maxWidth: 640,
          alignSelf: 'center',
          paddingHorizontal: 0,
        }}
      >
        {/* Celebration header — word count as hero */}
        <YStack
          alignItems="center"
          paddingTop="$8"
          paddingBottom="$6"
          gap="$3"
          animation="medium"
          enterStyle={{ opacity: 0, scale: 0.95 }}
          opacity={1}
          scale={1}
        >
          <Text
            fontSize="$12"
            fontFamily="$body"
            fontWeight="700"
            color="$color"
            textAlign="center"
            animation="slow"
            enterStyle={{ opacity: 0, scale: 0.9 }}
            opacity={1}
            scale={1}
          >
            {wordCount.toLocaleString()}
          </Text>

          <Text
            fontSize="$5"
            fontFamily="$body"
            fontWeight="400"
            color="$color10"
            textAlign="center"
          >
            {wordCount === 1 ? 'word' : 'words'}
          </Text>

          <Text
            fontSize="$6"
            fontFamily="$body"
            fontWeight="300"
            color="$color"
            textAlign="center"
            paddingTop="$4"
          >
            {getWarmMessage()}
          </Text>
        </YStack>

        {/* Done button — single primary action */}
        <YStack alignItems="center" paddingVertical="$6">
          <Button
            size="$5"
            theme="accent"
            onPress={handleDismiss}
            paddingHorizontal="$8"
            borderRadius="$6"
          >
            <Text fontSize="$5" fontFamily="$body" fontWeight="600">
              Done
            </Text>
          </Button>
        </YStack>

        {/* Separator */}
        <Separator borderColor="$color5" marginVertical="$4" />

        {/* Re-read section — user's words in Lora serif */}
        <YStack flex={1} minHeight={300} paddingTop="$2">
          <Editor readOnly initialContent={content} />
        </YStack>
      </YStack>
    </ScrollView>
  )
}
