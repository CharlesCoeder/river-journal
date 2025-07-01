import { useEffect, useState } from 'react'
import { YStack, XStack, Button, H4, Theme } from '@my/ui'
import { WordCountDisplay, JournalTextArea } from '@my/ui'
import { observer, use$ } from '@legendapp/state/react'
import {
  journal$,
  updateCurrentFlowContent,
  startNewFlowSession,
  saveCurrentFlowSession,
  waitForJournalLoaded,
} from '../../state/journal'

export const JournalingScreen = observer(function JournalingScreen() {
  const [isLoaded, setIsLoaded] = useState(false)

  const currentContent = use$(journal$.currentFlowContent)
  const wordCount = use$(journal$.currentFlowWordCount)

  const dailyTarget = 750 // Default daily target words

  // Wait for persistence to load, but don't auto-initialize flow session
  useEffect(() => {
    const loadPersistence = async () => {
      // Wait for journal state to be loaded from persistence
      await waitForJournalLoaded()
      setIsLoaded(true)
      // Don't auto-initialize - let first keystroke trigger flow creation
    }

    loadPersistence()
  }, [])

  // Show loading state while persistence is loading
  if (!isLoaded) {
    return (
      <Theme name="blue">
        <YStack flex={1} padding="$4" alignItems="center" justifyContent="center" minHeight={400}>
          <H4>Loading...</H4>
        </YStack>
      </Theme>
    )
  }

  return (
    <Theme name="blue">
      <YStack
        flex={1}
        padding="$4"
        gap="$2"
        maxWidth={800}
        width="100%"
        alignSelf="center"
        backgroundColor="$background"
        $sm={{
          padding: '$3',
          gap: '$3',
        }}
        $md={{
          padding: '$4',
          gap: '$4',
        }}
      >
        {/* Header area with controls */}
        <XStack justifyContent="space-between" alignItems="center">
          <H4>River Journal</H4>
          <XStack gap="$2" alignItems="center">
            {/* Let's make this button have a different, more active theme */}
            <Button
              variant="outlined"
              size="$3"
              onPress={() => {
                saveCurrentFlowSession()
              }}
            >
              Save Flow
            </Button>
            <Button variant="outlined" size="$3" disabled>
              Settings
            </Button>
          </XStack>
        </XStack>

        <WordCountDisplay currentCount={wordCount} dailyTarget={dailyTarget} />

        <JournalTextArea
          placeholder="Begin your stream-of-consciousness writing here..."
          value={currentContent}
          onChangeText={updateCurrentFlowContent}
          keyboardPadding={40}
        />
      </YStack>
    </Theme>
  )
})
