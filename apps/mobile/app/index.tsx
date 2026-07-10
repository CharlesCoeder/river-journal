import { HomeScreen } from 'app/features/home/HomeScreen'
import { OnboardingGate } from 'app/features/onboarding/OnboardingGate'
import { YStack } from '@my/ui'

export default function HomeRoute() {
  return (
    <YStack flex={1}>
      <OnboardingGate>
        <HomeScreen />
      </OnboardingGate>
    </YStack>
  )
}
