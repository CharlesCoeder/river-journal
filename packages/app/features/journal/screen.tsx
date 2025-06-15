import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { Calendar, MoreHorizontal } from '@tamagui/lucide-icons'
import { XStack, YStack, TextArea, Button, Card, H4, Paragraph } from '@my/ui'
import { useRouter } from 'solito/navigation'

export function JournalScreen() {
  const [content, setContent] = useState('')
  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const today = new Date()
  const router = useRouter()

  // Update word and character counts reactively
  useEffect(() => {
    const words = content.trim() ? content.trim().split(/\s+/).length : 0
    setWordCount(words)
    setCharCount(content.length)
  }, [content])

  return (
    <YStack
      style={{
        maxWidth: 800,
        width: '100%',
        marginHorizontal: 'auto',
        padding: 16,
      }}
    >
      <XStack
        style={{
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          width: '100%',
        }}
      >
        <XStack style={{ alignItems: 'center' }}>
          <Calendar size={20} />
          <H4 style={{ marginLeft: 8 }}>{format(today, 'EEEE, MMMM d, yyyy')}</H4>
        </XStack>

        <Button
          size="$3"
          variant="outlined"
          icon={MoreHorizontal}
          onPress={() => {
            // Dummy menu
          }}
        />
      </XStack>

      <Card bordered style={{ marginBottom: 16, width: '100%' }}>
        <TextArea
          value={content}
          onChangeText={setContent}
          placeholder="What's on your mind today?"
          style={{
            height: 400,
            padding: 16,
            fontSize: 18,
            lineHeight: 24,
            borderWidth: 0,
          }}
        />
      </Card>

      <XStack style={{ justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <XStack>
          <Paragraph style={{ marginRight: 16 }}>{wordCount} words</Paragraph>
          <Paragraph>{charCount} characters</Paragraph>
        </XStack>

        <Button size="$3" variant="outlined" onPress={() => router.push('/demo')}>
          Try Persistence Demo
        </Button>
      </XStack>
    </YStack>
  )
}
