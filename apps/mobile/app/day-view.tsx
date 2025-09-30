import { DayViewScreen } from 'app/features/day-view/DayViewScreen'
import { Stack } from 'expo-router'
import { YStack } from '@my/ui'

export default function DayViewScreenPage() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Day View',
          headerShown: false,
        }}
      />
      <YStack flex={1}>
        <DayViewScreen />
      </YStack>
    </>
  )
}
