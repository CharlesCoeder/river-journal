import React, { useState } from 'react'
import { Platform } from 'react-native'
import { YStack, XStack, TextArea, Button, H4, WordCountDisplay } from '@my/ui'
import { KeyboardAwareContainer } from 'app/provider/keyboard-aware'

export function JournalingScreen() {
  const [content, setContent] = useState('')

  // Calculate word count
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const dailyTarget = 750 // Default daily target words

  const isMobile = Platform.OS === 'ios' || Platform.OS === 'android'

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

      {/* Primary text input area - only this gets keyboard avoidance */}
      {isMobile ? (
        <KeyboardAwareContainer flex={1}>
          <TextArea
            placeholder="Begin your stream-of-consciousness writing here..."
            value={content}
            onChangeText={setContent}
            flex={1}
            minHeight={400}
            fontSize="$5"
            lineHeight="$6"
            padding="$3"
            borderRadius="$4"
            borderWidth={1}
            borderColor="$borderColor"
            backgroundColor="$background"
            $gtSm={{
              minHeight: 350,
              fontSize: '$4',
              padding: '$4',
            }}
            $gtMd={{
              minHeight: 400,
              fontSize: '$5',
              padding: '$4',
            }}
          />
        </KeyboardAwareContainer>
      ) : (
        <YStack flex={1} gap="$2">
          <TextArea
            placeholder="Begin your stream-of-consciousness writing here..."
            value={content}
            onChangeText={setContent}
            flex={1}
            minHeight={400}
            fontSize="$5"
            lineHeight="$6"
            padding="$3"
            borderRadius="$4"
            borderWidth={1}
            borderColor="$borderColor"
            backgroundColor="$background"
            $gtSm={{
              minHeight: 350,
              fontSize: '$4',
              padding: '$4',
            }}
            $gtMd={{
              minHeight: 400,
              fontSize: '$5',
              padding: '$4',
            }}
          />
        </YStack>
      )}
    </YStack>
  )
}
