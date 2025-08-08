import type React from 'react'
import { YStack } from '@my/ui'
import LexicalEditor from './LexicalEditor'

interface JournalingEditorProps {
  content: string
  onContentChange: (content: string) => void
  placeholder?: string
}

/**
 * Main editor component for the journaling screen
 * Currently uses JournalTextArea - will be replaced with Lexical editor in Task 5
 * Designed for center-aligned, focused writing experience
 */
export const JournalingEditor: React.FC<JournalingEditorProps> = ({
  content,
  onContentChange,
  placeholder = 'Begin your stream-of-consciousness writing here...',
}) => {
  return (
    <YStack
      flex={1}
      width="100%"
      alignItems="center"
      justifyContent="flex-start"
      paddingTop="$4"
      $sm={{
        paddingTop: '$3',
      }}
    >
      {/* Center-aligned writing area with ample whitespace on sides */}
      <YStack
        width="100%"
        maxWidth={800}
        flex={1}
        backgroundColor="$background"
        borderRadius="$4"
        padding="$4"
        $sm={{
          maxWidth: '100%',
          padding: '$3',
          borderRadius: '$3',
        }}
        $md={{
          maxWidth: 700,
          padding: '$5',
        }}
        $lg={{
          maxWidth: 800,
          padding: '$6',
        }}
      >
        <LexicalEditor className="lex-root" placeholder={placeholder} onChange={onContentChange} />
      </YStack>
    </YStack>
  )
}
