'use client'

import { JournalScreen } from 'app/features/journal/screen'
import { Button, XStack, YStack } from 'tamagui'
import { useRouter } from 'solito/navigation'

export default function Page() {
  const router = useRouter()

  return (
    <YStack
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        paddingTop: 32,
      }}
    >
      <XStack style={{ marginBottom: 16 }} space={8}>
        <Button onPress={() => router.push('/theme-demo')} theme="blue">
          Theme Demo
        </Button>
      </XStack>

      <JournalScreen />
    </YStack>
  )
}
