'use client'

import { JournalScreen } from 'app/features/journal'
import { YStack } from 'tamagui'

export default function JournalPage() {
  return (
    <YStack flex={1} width="100%" minHeight="100vh">
      <JournalScreen />
    </YStack>
  )
}
