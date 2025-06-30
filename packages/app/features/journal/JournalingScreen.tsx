import { useState } from 'react'
import { YStack, XStack, Button, H4, Theme } from '@my/ui'
import { WordCountDisplay, JournalTextArea } from '@my/ui'

export function JournalingScreen() {
  const [content, setContent] = useState('')

  // Calculate word count
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const dailyTarget = 750 // Default daily target words

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
        $gtSm={{
          padding: '$3',
          gap: '$3',
        }}
        $gtMd={{
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
                // Exit Flow functionality
              }}
            >
              Exit Flow
            </Button>
            <Button variant="outlined" size="$3" disabled>
              Settings
            </Button>
          </XStack>
        </XStack>

        <WordCountDisplay currentCount={wordCount} dailyTarget={dailyTarget} />

        <JournalTextArea
          placeholder="Begin your stream-of-consciousness writing here..."
          value={content}
          onChangeText={setContent}
          keyboardPadding={40}
        />
      </YStack>
    </Theme>
  )
}
