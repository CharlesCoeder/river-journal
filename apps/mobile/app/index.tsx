import { InlineHomeScreen } from 'app/features/home/InlineHomeScreen'
import { OnboardingGate } from 'app/features/onboarding/OnboardingGate'
import { YStack } from '@my/ui'

export default function HomeRoute() {
  return (
    <YStack flex={1}>
      <OnboardingGate>
        {/*
          Experiment: home IS the writing surface. The editor sits on the page
          under today's date; tapping into it fades the chrome away and you are
          writing. There is no Slider Hub here — the menu has a visible entry
          top-left, and writing needs no gesture at all.
        */}
        <InlineHomeScreen />
      </OnboardingGate>
    </YStack>
  )
}
