import { CelebrationScreen } from 'app/features/journal/CelebrationScreen'
import { Stack } from 'expo-router'
import { YStack } from '@my/ui'

export default function CelebrationScreenPage() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Flow Complete',
          headerShown: false,
        }}
      />
      <YStack flex={1}>
        <CelebrationScreen />
      </YStack>
    </>
  )
}
