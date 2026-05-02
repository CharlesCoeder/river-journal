import { HomeScreen } from 'app/features/home/HomeScreen'
import { YStack } from '@my/ui'

export default function HomeRoute() {
  return (
    <YStack flex={1}>
      <HomeScreen />
    </YStack>
  )
}
