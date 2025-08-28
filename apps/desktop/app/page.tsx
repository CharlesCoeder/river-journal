'use client'

import { HomeScreen } from 'app/features/home/HomeScreen'
import { YStack } from 'tamagui'

export default function Page() {
  return (
    <YStack flex={1} width="100%" minHeight="100vh">
      <HomeScreen />
    </YStack>
  )
}
