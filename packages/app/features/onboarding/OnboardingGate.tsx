import { useState } from 'react'
import { use$ } from '@legendapp/state/react'
import { OnboardingSequence } from 'app/features/onboarding/OnboardingSequence'
import { onboarding$, completeOnboarding, setOnboardingScreen } from 'app/state/onboarding'

// ---------------------------------------------------------------------------
// OnboardingGate — first-launch gate wrapping the home entry point.
//
// Renders OnboardingSequence INSTEAD of its children (HomeScreen)
// until the local-only `onboardingCompletedAt` flag is set, after which it
// renders children directly on every subsequent launch. The flag is persisted
// and loaded before children render (via PersistenceGate), so a returning user
// never sees a flash of onboarding on cold start.
//
// Because HomeScreen literally does not mount during onboarding, everything it
// hosts (LapsedPrompt, OrphanFlowsDialog, streak surfaces) stays dormant while
// the sequence is showing.
// ---------------------------------------------------------------------------

/** Clamp a persisted screen index into OnboardingSequence's valid [0, 2] range. */
function clampScreen(screen: number): number {
  return Math.max(0, Math.min(2, Math.trunc(screen)))
}

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  // Reactive read: re-renders (swapping in children) the moment completion fires.
  const completedAt = use$(onboarding$.onboardingCompletedAt)

  // Read the persisted screen ONCE at mount (non-reactive peek in a useState
  // initializer). Live writes from onScreenChange must not remount/reset the
  // sequence mid-flow — only the initial resume position matters here.
  const [initialScreen] = useState(() => clampScreen(onboarding$.currentScreen.peek()))

  if (completedAt !== null) {
    return <>{children}</>
  }

  return (
    <OnboardingSequence
      onDone={handleDone}
      initialScreen={initialScreen}
      onScreenChange={setOnboardingScreen}
    />
  )
}

// Both 'completed' (Get started) and 'skipped' (Skip) set the same flag —
// skip == completion for this single-pass onboarding. The reason is not
// branched on for MVP. completeOnboarding is idempotent, so wiring both exits
// here is race-safe.
function handleDone(_reason: 'completed' | 'skipped'): void {
  completeOnboarding()
}
