import React from 'react'
import { YStack } from '@my/ui'

interface JournalingContainerProps {
  children: React.ReactNode
}

/**
 * Main container for the journaling screen with clean, distraction-free styling
 * Takes full screen with appropriate padding, margins, and visual hierarchy
 */
export const JournalingContainer: React.FC<JournalingContainerProps> = ({ children }) => {
  return (
    <YStack
      flex={1}
      backgroundColor="$background"
      paddingHorizontal="$4"
      paddingVertical="$3"
      gap="$4"
      width="100%"
      maxWidth={800}
      alignSelf="center"
      minHeight="100vh"
      $sm={{
        paddingHorizontal: '$3',
        paddingVertical: '$2',
        gap: '$3',
      }}
      $md={{
        paddingHorizontal: '$6',
        paddingVertical: '$4',
        gap: '$5',
      }}
      $lg={{
        paddingHorizontal: '$8',
        paddingVertical: '$5',
        gap: '$6',
      }}
    >
      {children}
    </YStack>
  )
} 