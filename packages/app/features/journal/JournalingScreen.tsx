import React, { useState } from 'react'
import { YStack, XStack, Button, H4, WordCountDisplay, ResizeableTextArea } from '@my/ui'

export function JournalingScreen() {
  const [content, setContent] = useState('')

  // Calculate word count
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const dailyTarget = 750 // Default daily target words

  return (
    <YStack
      flex={1}
      padding="$4"
      gap="$2"
      maxWidth={800}
      width="100%"
      alignSelf="center"
      $gtSm={{
        padding: '$3',
        gap: '$3',
      }}
      $gtMd={{
        padding: '$4',
        gap: '$4',
      }}
    >
      {/* Header area with controls - stays fixed */}
      <XStack justifyContent="space-between" alignItems="center">
        <H4>River Journal</H4>
        <XStack gap="$2" alignItems="center">
          <Button
            variant="outlined"
            size="$3"
            onPress={() => {
              // Exit Flow functionality - placeholder for future implementation
            }}
          >
            Exit Flow
          </Button>
          <Button variant="outlined" size="$3" disabled>
            Settings
          </Button>
        </XStack>
      </XStack>

      {/* Word count display area - stays fixed */}
      <WordCountDisplay currentCount={wordCount} dailyTarget={dailyTarget} />

      {/* Primary text input area - ResizeableTextArea handles keyboard behavior */}
      <ResizeableTextArea
        placeholder="Begin your stream-of-consciousness writing here..."
        value={content}
        onChangeText={setContent}
        flex={1}
        minHeight={150}
        fontSize="$5"
        lineHeight="$6"
        padding="$3"
        borderRadius="$4"
        borderWidth={1}
        borderColor="$borderColor"
        backgroundColor="$background"
        keyboardPadding={40}
        $gtSm={{
          minHeight: 120,
          fontSize: '$4',
          padding: '$4',
        }}
        $gtMd={{
          minHeight: 150,
          fontSize: '$5',
          padding: '$4',
        }}
      />
    </YStack>
  )
}
