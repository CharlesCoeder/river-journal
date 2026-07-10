import { ExpandingLineButton, XStack } from '@my/ui'
import { OnboardingScreenLayout, OnboardingSkipButton } from './OnboardingScreenLayout'

// Screen 1 — Practice. Primary CTA is Continue (advances to Community).

export interface PracticeScreenProps {
  headlineId: string
  transition: string
  onContinue: () => void
  onSkip: () => void
}

export function PracticeScreen({
  headlineId,
  transition,
  onContinue,
  onSkip,
}: PracticeScreenProps) {
  return (
    <OnboardingScreenLayout
      headlineId={headlineId}
      headline="Practice"
      body="Write 500 words a day. Keep them private."
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
