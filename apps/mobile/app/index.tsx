import { HomeScreen } from 'app/features/home/HomeScreen'
import { OnboardingGate } from 'app/features/onboarding/OnboardingGate'
import { SliderHub } from 'app/features/navigation/SliderHub'
import { YStack } from '@my/ui'

export default function HomeRoute() {
  return (
    <YStack flex={1}>
      <OnboardingGate>
        {/*
          The Slider Hub gesture lives on the home route only. Home is the one
          surface where "slide right = write, slide left = menu" is the mental
          model; on every pushed screen the native stack back-swipe is the only
          horizontal gesture, so a swipe on the menu can never be mistaken for
          a swipe into the editor.
        */}
        <SliderHub>
          <HomeScreen />
        </SliderHub>
      </OnboardingGate>
    </YStack>
  )
}
