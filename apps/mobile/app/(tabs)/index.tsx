import { HomeScreen } from 'app/features/home/HomeScreen'
import { SliderHub } from 'app/features/navigation/SliderHub'
import { YStack } from '@my/ui'

export default function HomeTab() {
  return (
    <YStack flex={1}>
      <SliderHub>
        <HomeScreen />
      </SliderHub>
    </YStack>
  )
}
