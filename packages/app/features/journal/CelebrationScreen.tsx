/**
 * CelebrationScreen.tsx
 *
 * Displays a celebration screen after completing a flow session.
 * Shows word count, warm message, and allows scrolling to re-read the flow.
 * Per UX spec: explicit dismissal only, no auto-dismiss.
 */

import { useEffect } from 'react'
import { YStack, XStack, H1, Text, Button, ScrollView } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import { store$, clearLastSavedFlow, clearActiveFlow } from 'app/state/store'
import { Editor } from './components/Editor'

export function CelebrationScreen() {
  const router = useRouter()
  const lastSavedFlow = use$(store$.journal.lastSavedFlow)

  // Clear the activeFlow on mount to complete the save transition
  // This is done here (not in saveActiveFlowSession) to prevent placeholder flash
  useEffect(() => {
    clearActiveFlow()
  }, [])

  // Handle missing flow data - redirect in useEffect to avoid setState during render
  useEffect(() => {
    if (!lastSavedFlow) {
      router.push('/')
    }
  }, [lastSavedFlow, router])

  const handleDismiss = () => {
    clearLastSavedFlow()
    router.push('/')
  }

  // Show nothing while redirecting
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
        width="75%"
        maxWidth="75%"
        alignSelf="center"
        paddingTop="$10"
        paddingBottom="$10"
        gap="$8"
        flex={1}
      >
        {/* Celebration Header */}
        <YStack gap="$4" alignItems="center" paddingTop="$8">
          <H1
            size="$10"
            fontFamily="$sourceSans3"
            fontWeight="400"
            textAlign="center"
            color="$color"
          >
            Flow complete!
          </H1>

          <Text fontSize="$8" fontFamily="$sourceSans3" color="$color11" textAlign="center">
            {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}
          </Text>
        </YStack>

        {/* Done Button - Primary action */}
        <XStack justifyContent="center" paddingVertical="$4">
          <Button
            size="$5"
            backgroundColor="$color9"
            color="$color1"
            onPress={handleDismiss}
            paddingHorizontal="$8"
          >
            <Text fontSize="$5" fontFamily="$sourceSans3" fontWeight="600" color="$color1">
              Done
            </Text>
          </Button>
        </XStack>

        {/* Divider */}
        <XStack height={1} backgroundColor="$borderColor" marginVertical="$4" />

        {/* Read-only flow content */}
        <YStack flex={1} minHeight={300}>
          <Editor readOnly initialContent={content} />
        </YStack>
      </YStack>
    </ScrollView>
  )
}
