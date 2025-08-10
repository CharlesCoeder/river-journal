import type React from 'react'
import { YStack, useTheme } from '@my/ui'
import { Platform } from 'react-native'
import LexicalEditor from './LexicalEditor'

interface JournalingEditorProps {
  content: string
  onContentChange: (content: string) => void
  placeholder?: string
}

/**
 * Main editor component for the journaling screen
 * Designed for center-aligned, focused writing experience
 */
export const JournalingEditor: React.FC<JournalingEditorProps> = ({
  content,
  onContentChange,
  placeholder = 'Begin your stream-of-consciousness writing here...',
}) => {
  const theme = useTheme()

  // Extract theme values for mobile Lexical editor
  const themeValues = {
    textColor: theme.color.val,
    // Use placeholderColor if available, otherwise create a translucent version of the text color
    placeholderColor:
      theme.placeholderColor?.val ||
      (theme.color.val.startsWith('#')
        ? `${theme.color.val}80` // Add alpha to hex colors
        : `rgba(${theme.color.val}, 0.5)`), // Convert others to rgba with 50% opacity
  }
  return (
    <YStack flex={1} width="100%" alignItems="center" justifyContent="flex-start">
      {/* Center-aligned writing area with ample whitespace on sides */}
      <YStack
        width="100%"
        maxWidth={800}
        flex={1}
        backgroundColor="$background"
        borderRadius="$4"
        $sm={{
          maxWidth: '100%',
          borderRadius: '$3',
        }}
        $md={{
          maxWidth: 700,
        }}
        $lg={{
          maxWidth: 800,
        }}
      >
        <LexicalEditor
          className="lex-root"
          placeholder={placeholder}
          onChange={onContentChange}
          {...(Platform.OS !== 'web' ? { themeValues } : {})}
        />
      </YStack>
    </YStack>
  )
}
