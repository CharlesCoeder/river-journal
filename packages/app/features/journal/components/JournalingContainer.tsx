import type React from 'react'
import { YStack, ScrollView } from '@my/ui'

interface JournalingContainerProps {
  children: React.ReactNode
}

/**
 * Main container for the journaling screen with clean, distraction-free styling
 * Takes full screen with appropriate padding, margins, and visual hierarchy
 */
export const JournalingContainer: React.FC<JournalingContainerProps> = ({ children }) => {
  return (
    <ScrollView flex={1} width="100%" alignSelf="stretch" backgroundColor="$background">
      <YStack
        flex={1}
        backgroundColor="$background"
        paddingHorizontal="$6"
        paddingVertical="$4"
        gap="$4"
        width="100%"
        alignSelf="stretch"
        $sm={{
          paddingHorizontal: '$4',
          paddingVertical: '$3',
          gap: '$3',
        }}
        $md={{
          paddingHorizontal: '$6',
          paddingVertical: '$5',
          gap: '$5',
        }}
        $lg={{
          paddingHorizontal: '$12',
          paddingVertical: '$6',
          gap: '$6',
        }}
      >
        {children}
      </YStack>
    </ScrollView>
  )
}
