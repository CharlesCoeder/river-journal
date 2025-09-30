'use client'

import { DayViewScreen } from 'app/features/day-view'
import { YStack } from 'tamagui'

export default function DayViewPage() {
  return (
    <YStack flex={1} width="100%" minHeight="100vh">
      <DayViewScreen />
    </YStack>
  )
}
