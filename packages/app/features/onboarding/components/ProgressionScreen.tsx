import { ExpandingLineButton, XStack } from '@my/ui'
import { OnboardingScreenLayout, OnboardingSkipButton } from './OnboardingScreenLayout'

// Screen 3 — Progression. Primary CTA is Get started (completes the sequence
// and drops the user to home). Skip also routes home but reports a distinct
// reason so completion vs skip can be persisted separately downstream.

export interface ProgressionScreenProps {
  headlineId: string
  transition: string
  onGetStarted: () => void
  onSkip: () => void
}

export function ProgressionScreen({
  headlineId,
  transition,
  onGetStarted,
  onSkip,
}: ProgressionScreenProps) {
  return (
    <OnboardingScreenLayout
      headlineId={headlineId}
      headline="Progression"
      body="Sustained practice unlocks more — themes, grace days, customization."
      transition={transition}
    >
      <XStack
        alignItems="center"
        gap="$6"
        flexWrap="wrap"
      >
        <ExpandingLineButton
          size="cta"
          onPress={onGetStarted}
          accessibilityLabel="Get started"
        >
          Get started
        </ExpandingLineButton>
        <OnboardingSkipButton onPress={onSkip} />
      </XStack>
    </OnboardingScreenLayout>
  )
}
