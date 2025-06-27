'use client'

import { JournalingScreen } from 'app/features/journal'
import { YStack } from 'tamagui'

export default function Page() {
  return (
    <YStack flex={1} width="100%" minHeight="100vh">
      <JournalingScreen />
    </YStack>
  )
}
