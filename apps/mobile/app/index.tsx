import { JournalScreen } from 'app/features/journal'
import { Stack } from 'expo-router'
import { YStack } from '@my/ui'

export default function Screen() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Journal',
          headerShown: false,
        }}
      />
      <YStack flex={1}>
        <JournalScreen />
      </YStack>
    </>
  )
}
