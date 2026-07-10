import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, useReducedMotion } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { PracticeScreen } from './components/PracticeScreen'
import { CommunityScreen } from './components/CommunityScreen'
import { ProgressionScreen } from './components/ProgressionScreen'

// ---------------------------------------------------------------------------
// OnboardingSequence — a calm, typography-led 3-screen intro to the product
// model (practice → community → progression).
//
// Forward-only: each screen has exactly one primary CTA (Continue on 1–2,
// Get started on 3) plus a quiet Skip. There is no Back. Skip exits to home
// from anywhere; Get started completes and exits to home. Both exits are
// single-pass and never blocking.
//
// Scope: this component is the sequence only. First-launch display logic and
// completion persistence are wired downstream through the optional props
// (`onDone`, `initialScreen`, `onScreenChange`) — this component just provides
// sensible defaults so it renders and tests standalone.
// ---------------------------------------------------------------------------

export type OnboardingDoneReason = 'completed' | 'skipped'

export interface OnboardingSequenceProps {
  /** Fired once when the sequence exits, with why: finished vs skipped. */
  onDone?: (reason: OnboardingDoneReason) => void
  /** Screen to mount on (0-based). Enables resume; defaults to 0. */
  initialScreen?: number
  /** Fired when the active screen changes (not on first mount). */
  onScreenChange?: (screen: number) => void
}

const LAST_SCREEN = 2

const headlineIdFor = (screen: number) => `onboarding-headline-${screen}`

export function OnboardingSequence({
  onDone,
  initialScreen = 0,
  onScreenChange,
}: OnboardingSequenceProps) {
  const router = useRouter()
  const reduceMotion = useReducedMotion()
  const [currentScreen, setCurrentScreen] = useState(initialScreen)

  // Reduced-motion users get the sanctioned '100ms' fade instead of the spring.
  const transition = reduceMotion ? '100ms' : 'designEnterSlow'

  // Re-entrancy guard for exit navigation: a double-tap on Get started / Skip
  // (or a Skip fired mid-transition) must fire router.push + onDone at most
  // once. A ref survives re-renders and reads synchronously, so a second
  // synchronous tap is a no-op.
  const hasExitedRef = useRef(false)

  const exit = useCallback(
    (reason: OnboardingDoneReason) => {
      if (hasExitedRef.current) return
      hasExitedRef.current = true
      onDone?.(reason)
      router.push('/')
    },
    [onDone, router]
  )

  // Advance guard (AC7): the functional updater only steps forward when the
  // current screen still matches the one the tap originated from, so a stale /
  // rapid second tap can't leapfrog a screen.
  const advanceFrom = useCallback((from: number) => {
    setCurrentScreen((s) => (s === from ? s + 1 : s))
  }, [])

  // Notify downstream of screen changes, skipping the first mount so resume
  // (initialScreen) doesn't read as a change.
  const isFirstRenderRef = useRef(true)
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }
    onScreenChange?.(currentScreen)
  }, [currentScreen, onScreenChange])

  // Focus management (AC5): move focus to the active screen's headline on the
  // first mount AND on every transition, so screen-reader users land on the
  // new heading. Web-only via getElementById (ExpandingLineButton/Text don't
  // forwardRef); on native this is a deliberate no-op — VoiceOver/TalkBack
  // announce the freshly-mounted <section> + <h1> instead. This mirrors the
  // established ThreePostureDisclosure precedent.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const raf = requestAnimationFrame(() => {
      document.getElementById(headlineIdFor(currentScreen))?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [currentScreen])

  const headlineId = headlineIdFor(currentScreen)
  const handleContinue = () => advanceFrom(currentScreen)
  const handleSkip = () => exit('skipped')
  const handleGetStarted = () => exit('completed')

  const renderScreen = () => {
    if (currentScreen >= LAST_SCREEN) {
      return (
        <ProgressionScreen
          key="onboarding-screen-2"
          headlineId={headlineId}
          transition={transition}
          onGetStarted={handleGetStarted}
          onSkip={handleSkip}
        />
      )
    }
    if (currentScreen === 1) {
      return (
        <CommunityScreen
          key="onboarding-screen-1"
          headlineId={headlineId}
          transition={transition}
          onContinue={handleContinue}
          onSkip={handleSkip}
        />
      )
    }
    return (
      <PracticeScreen
        key="onboarding-screen-0"
        headlineId={headlineId}
        transition={transition}
        onContinue={handleContinue}
        onSkip={handleSkip}
      />
    )
  }

  return <AnimatePresence>{renderScreen()}</AnimatePresence>
}
