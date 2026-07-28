import { ExpandingLineButton, XStack } from '@my/ui'
import { OnboardingScreenLayout, OnboardingSkipButton } from './OnboardingScreenLayout'
import { setTelemetryConsent } from '../../../utils/telemetry/consent'

// Screen 4 — Telemetry consent (the final screen). Telemetry is opt-in:
// "Enable" turns the device-local consent flag ON (initializing crash + usage
// reporting immediately); "Not now" leaves it OFF (the default). Both complete
// onboarding and drop the user to home. This is the first-run consent surface;
// the Privacy Center toggle mirrors it later.

export interface ConsentScreenProps {
  headlineId: string
  transition: string
  /** Completes onboarding and exits to home (fired by both choices). */
  onComplete: () => void
}

export function ConsentScreen({ headlineId, transition, onComplete }: ConsentScreenProps) {
  const handleEnable = () => {
    setTelemetryConsent(true)
    onComplete()
  }

  // "Not now" leaves consent at its default OFF — no state write needed.
  const handleNotNow = () => {
    onComplete()
  }

  return (
    <OnboardingScreenLayout
      headlineId={headlineId}
      headline="Help improve River Journal"
      body="Share anonymous crash and usage reports so we can fix problems and improve the app. Your journal entries are never collected. You can change this anytime in Privacy Center."
      transition={transition}
    >
      <XStack
        alignItems="center"
        gap="$6"
        flexWrap="wrap"
      >
        <ExpandingLineButton
          size="cta"
          onPress={handleEnable}
          accessibilityLabel="Enable"
        >
          Enable
        </ExpandingLineButton>
        <OnboardingSkipButton
          onPress={handleNotNow}
          label="Not now"
        />
      </XStack>
    </OnboardingScreenLayout>
  )
}
