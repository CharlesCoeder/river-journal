import { ExpandingLineButton, XStack } from '@my/ui'
import { OnboardingScreenLayout, OnboardingSkipButton } from './OnboardingScreenLayout'

// Screen 2 — Community. Primary CTA is Continue (advances to Progression).

export interface CommunityScreenProps {
  headlineId: string
  transition: string
  onContinue: () => void
  onSkip: () => void
}

export function CommunityScreen({
  headlineId,
  transition,
  onContinue,
  onSkip,
}: CommunityScreenProps) {
  return (
    <OnboardingScreenLayout
      headlineId={headlineId}
      headline="Community"
      body="Then meet others doing the same."
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
