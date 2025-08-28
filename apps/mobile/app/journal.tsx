import { JournalScreen } from 'app/features/journal/JournalScreen'
import { Stack } from 'expo-router'
import { YStack } from '@my/ui'

export default function JournalScreenPage() {
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
