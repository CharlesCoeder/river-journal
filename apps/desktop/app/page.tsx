'use client'

import { HomeScreen } from 'app/features/home/HomeScreen'
import { OnboardingGate } from 'app/features/onboarding/OnboardingGate'

export default function Page() {
  return (
    <OnboardingGate>
      <HomeScreen />
    </OnboardingGate>
  )
}
