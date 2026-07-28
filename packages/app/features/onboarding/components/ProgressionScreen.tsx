import { ExpandingLineButton, XStack } from '@my/ui'
import { OnboardingScreenLayout, OnboardingSkipButton } from './OnboardingScreenLayout'

// Screen 3 — Progression. Primary CTA is Continue (advances to the consent
// screen, which is the final step). Skip routes home from here as elsewhere.

export interface ProgressionScreenProps {
  headlineId: string
  transition: string
  onContinue: () => void
  onSkip: () => void
}

export function ProgressionScreen({
  headlineId,
  transition,
  onContinue,
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
          onPress={onContinue}
          accessibilityLabel="Continue"
        >
          Continue
        </ExpandingLineButton>
        <OnboardingSkipButton onPress={onSkip} />
      </XStack>
    </OnboardingScreenLayout>
  )
}
