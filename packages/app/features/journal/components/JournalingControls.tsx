import React from 'react'
import { XStack, Button, H4 } from '@my/ui'

interface JournalingControlsProps {
  onExitFlow: () => void
}

/**
 * Essential controls for the journaling screen positioned to not interfere with writing focus
 * Includes Exit Flow button and placeholders for other controls
 */
export const JournalingControls: React.FC<JournalingControlsProps> = ({ onExitFlow }) => {
  return (
    <XStack 
      justifyContent="space-between" 
      alignItems="center"
      paddingVertical="$2"
      $sm={{
        paddingVertical: '$1',
      }}
    >
      {/* App title - minimal and unobtrusive */}
      <H4 
        color="$color" 
        fontSize="$6"
        fontWeight="400"
        $sm={{
          fontSize: '$5',
        }}
      >
        River Journal
      </H4>
      
      {/* Control buttons - positioned to not interfere with writing */}
      <XStack gap="$2" alignItems="center">
        <Button
          variant="outlined"
          size="$3"
          onPress={onExitFlow}
          backgroundColor="$background"
          borderColor="$borderColor"
          color="$color"
          hoverStyle={{
            backgroundColor: '$backgroundHover',
          }}
          $sm={{
            size: '$2',
          }}
        >
          Exit Flow
        </Button>
        
        {/* Placeholder for future controls */}
        <Button 
          variant="outlined" 
          size="$3" 
          disabled
          opacity={0.5}
          backgroundColor="$background"
          borderColor="$borderColor"
          color="$color"
          $sm={{
            size: '$2',
          }}
        >
          Settings
        </Button>
      </XStack>
    </XStack>
  )
} 