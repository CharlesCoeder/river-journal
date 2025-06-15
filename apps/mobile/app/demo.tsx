import { DemoScreen } from 'app/features/demo/screen'
import { Stack } from 'expo-router'
import { ScrollView } from '@my/ui'

export default function Screen() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Persistence Demo',
          headerShown: true,
        }}
      />
      <ScrollView>
        <DemoScreen />
      </ScrollView>
    </>
  )
}
