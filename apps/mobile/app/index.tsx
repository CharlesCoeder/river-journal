import { JournalScreen } from 'app/features/journal/screen'
import { HelloComponent } from '@my/ui'
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
      <YStack>
        <HelloComponent />
        <JournalScreen />
      </YStack>
    </>
  )
}
