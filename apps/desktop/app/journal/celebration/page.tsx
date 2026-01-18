'use client'

import { CelebrationScreen } from 'app/features/journal/CelebrationScreen'
import { YStack } from 'tamagui'

export default function CelebrationPage() {
  return (
    <YStack flex={1} width="100%" minHeight="100vh">
      <CelebrationScreen />
    </YStack>
  )
}
