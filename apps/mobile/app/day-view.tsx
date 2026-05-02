import { DayViewScreen } from 'app/features/day-view/DayViewScreen'
import { YStack } from '@my/ui'

export default function DayViewRoute() {
  return (
    <YStack flex={1}>
      <DayViewScreen />
    </YStack>
  )
}
