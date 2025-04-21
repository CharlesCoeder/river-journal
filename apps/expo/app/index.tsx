import { JournalScreen } from 'app/features/journal/screen'
import { Stack } from 'expo-router'

export default function Screen() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Journal',
          headerShown: false,
        }}
      />
      <JournalScreen />
    </>
  )
}
