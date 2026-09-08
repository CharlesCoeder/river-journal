/**
 * CelebrationScreen.tsx
 *
 * Variant-aware celebration screen that branches on whether the just-saved flow
 * is the first 500-crossing flow on today's writing day:
 *
 *  - Handoff variant: serif word count, streak day, "The Collective is open."
 *    microcopy + Visit, optional UnlockNotification, Done dismiss.
 *  - Quieter variant: the same summary in a quieter register — word count and
 *    a Done dismiss.
 *
 * Both variants show THIS flow's word count (never the day's total — the day's
 * running total is a separate, clearly-labelled secondary line) and both put the
 * saved flow below the fold in a read-only Editor so the writing can be re-read
 * and scrolled. Neither variant auto-dismisses: the user leaves via Done.
 *
 * Focus trap note: this is a full-page route, not an overlay modal.
 * There is no underlying page content for focus to leak into — the browser's
 * natural tab loop within the route body satisfies the intent.
 * If CelebrationScreen is ever converted to a Tamagui Dialog overlay, add the
 * trap at that point — Tamagui's Dialog provides it built-in.
 *
 * Focus return on dismiss: router.push(...) replaces the route;
 * the browser manages focus restoration as part of the page lifecycle.
 * No explicit previousFocus.focus() is needed for route-based navigation.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LayoutChangeEvent } from 'react-native'
import {
  AnimatePresence,
  YStack,
  Text,
  XStack,
  ScrollView,
  View,
  ExpandingLineButton,
  useReducedMotion,
  isWeb,
} from '@my/ui'
import { useRouter } from 'solito/navigation'
import { useNavigateHome } from 'app/features/navigation/useNavigateHome'
import { use$ } from '@legendapp/state/react'
import {
  store$,
  ephemeral$,
  clearLastSavedFlow,
  clearActiveFlow,
  markUnlockSurfaced,
} from 'app/state/store'
import { MILESTONES } from 'app/state/streak'
import { getTodayJournalDayString } from 'app/state/date-utils'
import { chooseCelebrationVariant } from './celebrationVariant'
import { UnlockNotification } from 'app/features/streak/UnlockNotification'
import { Editor } from './components/Editor'

/**
 * DOM id of the quieter variant's dismiss control. ExpandingLineButton forwards
 * `id` to its root <button>, which is natively focusable — unlike the wrapper
 * <div> the handoff variant's ref points at — so mount focus can land on it.
 */
const QUIETER_DISMISS_ID = 'celebration-dismiss'

export function CelebrationScreen() {
  const router = useRouter()
  const navigateHome = useNavigateHome()
  const lastSavedFlow = use$(store$.lastSavedFlow)
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const [mounted, setMounted] = useState(false)
  const [showCelebration, setShowCelebration] = useState(false)
  const [nudgeDismissed, setNudgeDismissed] = useState(false)
  const nudgeHeight = useRef(0)
  const [nudgeCollapsedHeight, setNudgeCollapsedHeight] = useState<number | 'auto'>('auto')
  const reduceMotion = useReducedMotion()

  // Refs for focus management
  const visitButtonRef = useRef<any>(null)

  // Measured height of the scroll viewport. Native has no viewport units — Yoga
  // silently drops `minHeight: '100vh'`, which collapsed the hero to its content
  // height and pinned the summary to the very top of the scroll content. We size
  // the hero from the ScrollView's own frame instead, so the summary is centred
  // in the first screenful on device and the saved flow sits below the fold.
  const [viewportHeight, setViewportHeight] = useState(0)

  const onScrollViewLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height
    if (h > 0) setViewportHeight((prev) => (prev === h ? prev : h))
  }, [])

  const onNudgeLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height
    if (h > 0) nudgeHeight.current = h
  }, [])

  useEffect(() => {
    if (nudgeDismissed && nudgeHeight.current > 0) {
      // Snap to measured height so transition can animate from number → 0
      setNudgeCollapsedHeight(nudgeHeight.current)
      requestAnimationFrame(() => setNudgeCollapsedHeight(0))
    }
  }, [nudgeDismissed])

  // Variant + streak data (computed before early return so hooks are stable)
  const todayJournalDay = getTodayJournalDayString()
  const todayEntry = use$(store$.views.entryByDate(todayJournalDay))
  const variant = chooseCelebrationVariant(lastSavedFlow, todayEntry ?? null, todayJournalDay)

  // The day's running total, which is NOT the same number as the just-saved
  // flow's word count. `saveActiveFlowSession` has already committed the flow,
  // so this total includes it. Subscribe to the whole computed object — the
  // function-shaped-computed rule above applies to statsByDate too.
  const todayStats = use$(store$.views.statsByDate(todayJournalDay))
  const dayTotalWords = (todayStats as any)?.totalWords ?? 0

  // streak is a function-shaped computed view: subscribe as whole object, then destructure.
  // CRITICAL: use$(store$.views.streak.currentStreak) is NOT valid — sub-field subscriptions
  // on function-shaped computeds are not supported. Use whole-object pattern. (Dev Note #5)
  const streak = use$(store$.views.streak)
  const currentStreak = (streak as any)?.currentStreak ?? 0
  const tokensEarned = (streak as any)?.unlockTokensEarned ?? 0

  const surfaced = use$(ephemeral$.surfacedUnlockMilestones)

  // Most recent earned milestone (MILESTONES is sorted ascending; indexing logic)
  const latestEarnedMilestone = tokensEarned > 0 ? (MILESTONES[tokensEarned - 1] ?? null) : null
  const showUnlock =
    variant === 'handoff' && latestEarnedMilestone !== null && !surfaced.has(latestEarnedMilestone)

  // Mount + celebration entrance effect.
  // CRITICAL — record-as-surfaced timing: mark surfaced inside the same setTimeout that
  // triggers the entrance animation (showCelebration). Do NOT mark in render (infinite loop)
  // or on dismiss (re-prompts on next exit). "Surfaced once shown" is the rule.
  useEffect(() => {
    // Only wipe the active draft if we actually arrived here from a completed
    // save (lastSavedFlow present ⟺ saveActiveFlowSession committed the flow).
    // Guarding this prevents discarding an in-progress, never-saved draft if
    // this screen is ever reached without a real save (e.g. direct navigation).
    if (store$.lastSavedFlow.peek()) {
      clearActiveFlow()
    }
    setMounted(true)
    const t = setTimeout(() => {
      setShowCelebration(true)
      if (showUnlock && latestEarnedMilestone !== null) {
        markUnlockSurfaced(latestEarnedMilestone)
      }
      // Focus management: focus first interactive element on mount (web only)
      // On native, RN View lacks .focus(); TODO(native a11y focus): use
      // AccessibilityInfo.setAccessibilityFocus(findNodeHandle(ref.current)) when available.
      if (typeof window !== 'undefined') {
        requestAnimationFrame(() => {
          if (variant === 'handoff' && visitButtonRef.current?.focus) {
            visitButtonRef.current.focus()
          } else if (variant !== 'handoff' && typeof document !== 'undefined') {
            // `document` is undefined on native (where `window` is not) — the
            // guard keeps this web-only.
            document.getElementById(QUIETER_DISMISS_ID)?.focus()
          }
        })
      }
    }, 200)
    return () => clearTimeout(t)
  }, [showUnlock, latestEarnedMilestone]) // eslint-disable-line react-hooks/exhaustive-deps

  // No auto-dismiss on either variant: the saved flow is rendered below the fold
  // for re-reading, so the screen must stay put until the user taps Done.

  useEffect(() => {
    if (!lastSavedFlow) {
      navigateHome()
    }
  }, [lastSavedFlow, navigateHome])

  const handleDismiss = () => {
    clearLastSavedFlow()
    navigateHome()
  }

  const handleOpenCollective = () => {
    // Clear before navigation so the useEffect redirect-to-'/' is satisfied via
    // fresh null read. Clear-then-push works synchronously (no timeout needed here
    // unlike handleCreateAccount, because we're navigating away from '/', not to '/').
    clearLastSavedFlow()
    router.push('/collective')
  }

  const handleChooseTheme = () => {
    clearLastSavedFlow()
    router.push('/settings') // Theme picker UI handles unlock-token spending
  }

  const handleCreateAccount = () => {
    router.push('/auth?tab=signup')
    // Clear after navigation to avoid the useEffect redirect to '/'
    setTimeout(() => clearLastSavedFlow(), 100)
  }

  if (!lastSavedFlow) {
    return null
  }

  const { wordCount, content } = lastSavedFlow

  // Only worth showing the day's total when it says something the headline
  // doesn't — i.e. when this flow wasn't the only writing today.
  const showDayTotal = dayTotalWords > wordCount
  const hasContent = typeof content === 'string' && content.trim().length > 0

  // Fallback: if variant is handoff but streak hasn't recomputed yet, render quieter.
  // This handles the async subscription race on cold mount.
  const effectiveVariant = variant === 'handoff' && currentStreak >= 1 ? 'handoff' : variant

  // Animation tokens
  // Reduced motion: swap springs to '100ms' tween (≤200ms).
  const outerTransition = reduceMotion
    ? '100ms'
    : effectiveVariant === 'handoff'
      ? 'designEnterVerySlow'
      : 'designEnter'
  const innerTransition = reduceMotion
    ? '100ms'
    : effectiveVariant === 'handoff'
      ? 'celebrationSpring'
      : 'designEnter'
  const unlockTransition = reduceMotion ? '100ms' : undefined // passed to UnlockNotification

  // Web keeps the CSS viewport unit (correct through SSR, no measurement pass);
  // native uses the measured scroll viewport. See `viewportHeight` above.
  const heroMinHeight = isWeb ? '100vh' : viewportHeight || undefined

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{ flexGrow: 1 }}
      onLayout={onScrollViewLayout}
    >
      {/* Hero section — one screenful tall, centers the celebration summary */}
      <AnimatePresence>
        {mounted && (
          <YStack
            key="celebration-content"
            // dialog semantics on the outer variant-wrapping stack
            tag="div"
            role="dialog"
            aria-modal={true}
            {...(effectiveVariant === 'handoff'
              ? { 'aria-labelledby': 'celebration-wordcount' }
              : { 'aria-label': 'Celebration' })}
            transition={outerTransition as any}
            enterStyle={{ opacity: 0 }}
            opacity={1}
            width="100%"
            maxWidth={672}
            alignSelf="center"
            paddingHorizontal="$4"
            minHeight={heroMinHeight}
            justifyContent="center"
            alignItems="center"
            position="relative"
          >
            <AnimatePresence>
              {showCelebration && effectiveVariant === 'handoff' && (
                // ─── Handoff variant ───────────────────────────────────
                <YStack
                  key="celebration-center"
                  transition={innerTransition as any}
                  enterStyle={{ opacity: 0, y: 30 }}
                  opacity={1}
                  y={0}
                  alignItems="center"
                  gap="$6"
                >
                  {/* This flow's word count — serif $8; id for aria-labelledby.
                      The optional line beneath is the DAY's running total, a
                      different number, and is labelled as such. */}
                  <YStack
                    alignItems="center"
                    gap="$2"
                  >
                    <Text
                      id="celebration-wordcount"
                      fontFamily="$journal"
                      fontSize="$8"
                      color="$color"
                      letterSpacing={-0.5}
                    >
                      {wordCount} words.
                    </Text>
                    {showDayTotal && (
                      <Text
                        fontFamily="$body"
                        fontSize={13}
                        color="$color8"
                        letterSpacing={0.5}
                      >
                        {dayTotalWords} words today.
                      </Text>
                    )}
                  </YStack>

                  {/* Streak day — Outfit sans $4 */}
                  <Text
                    fontFamily="$body"
                    fontSize="$4"
                    color="$color"
                  >
                    Day {currentStreak}.
                  </Text>

                  {/* Collective microcopy + Visit CTA */}
                  <XStack
                    gap="$3"
                    alignItems="center"
                  >
                    <Text
                      fontFamily="$body"
                      fontSize={14}
                      color="$color8"
                      letterSpacing={0.5}
                    >
                      The Collective is open.
                    </Text>
                    {/* Visit button — primary focus target on handoff mount */}
                    <View ref={visitButtonRef}>
                      <ExpandingLineButton
                        size="default"
                        onPress={handleOpenCollective}
                      >
                        Visit
                      </ExpandingLineButton>
                    </View>
                  </XStack>

                  {/* UnlockNotification slot — handoff variant only */}
                  {showUnlock && (
                    <UnlockNotification
                      onChooseTheme={handleChooseTheme}
                      enterTransition={unlockTransition}
                    />
                  )}

                  {/* Done dismiss button — no auto-dismiss on handoff */}
                  <View marginTop={48}>
                    <ExpandingLineButton
                      size="default"
                      onPress={handleDismiss}
                    >
                      Done
                    </ExpandingLineButton>
                  </View>

                  {/* Auth nudge — handoff variant only */}
                  {!isAuthenticated && (
                    <YStack
                      overflow={nudgeCollapsedHeight === 'auto' ? undefined : 'hidden'}
                      transition={nudgeDismissed ? ('smoothCollapse' as any) : undefined}
                      height={nudgeCollapsedHeight}
                      opacity={nudgeDismissed ? 0 : 1}
                      marginTop={nudgeDismissed ? 0 : 28}
                      pointerEvents={nudgeDismissed ? 'none' : 'auto'}
                      width="100%"
                      maxWidth={384}
                    >
                      <YStack
                        onLayout={onNudgeLayout}
                        borderWidth={1}
                        borderColor="$color3"
                        borderRadius="$2"
                        padding="$5"
                        alignItems="center"
                        gap="$3"
                      >
                        <Text
                          fontFamily="$body"
                          fontSize={12}
                          color="$color8"
                          textAlign="center"
                          lineHeight={20}
                        >
                          Your writing is saved on this device. Create an account to sync across
                          devices and keep it safe.
                        </Text>
                        <XStack
                          gap="$5"
                          paddingTop="$2"
                        >
                          <Text
                            fontFamily="$body"
                            fontSize={9}
                            letterSpacing={2.5}
                            textTransform="uppercase"
                            color="$color7"
                            cursor="pointer"
                            hoverStyle={{ color: '$color8' }}
                            onPress={() => setNudgeDismissed(true)}
                          >
                            Dismiss
                          </Text>
                          <Text
                            fontFamily="$body"
                            fontSize={9}
                            letterSpacing={2.5}
                            textTransform="uppercase"
                            color="$color"
                            cursor="pointer"
                            hoverStyle={{ opacity: 0.7 }}
                            borderBottomWidth={1}
                            borderColor="$color5"
                            paddingBottom={1}
                            onPress={handleCreateAccount}
                          >
                            Create Account
                          </Text>
                        </XStack>
                      </YStack>
                    </YStack>
                  )}
                </YStack>
              )}

              {showCelebration && effectiveVariant !== 'handoff' && (
                // ─── Quieter variant ───────────────────────────────────
                // Full-page route — no focus trap needed. Browser tab loop
                // within this route body satisfies the intent: there is no
                // underlying page content for focus to escape to.
                <YStack
                  key="celebration-center-quieter"
                  transition={innerTransition as any}
                  enterStyle={{ opacity: 0, y: 30 }}
                  opacity={1}
                  y={0}
                  alignItems="center"
                  gap="$6"
                >
                  {/* Tap-to-dismiss is deliberately gone: the saved flow now sits
                      below the fold, and a screen-sized dismiss target next to a
                      scrollable re-read is an accidental exit waiting to happen.
                      Done below is the way out. */}
                  <YStack
                    alignItems="center"
                    gap="$2"
                  >
                    {/* THIS flow's word count — body sans; aria-live announces it */}
                    <Text
                      fontFamily="$body"
                      fontSize={18}
                      color="$color"
                      letterSpacing={0.5}
                      aria-live="polite"
                      role="status"
                    >
                      {wordCount} words.
                    </Text>
                    {/* The day's running total — a different number, said plainly */}
                    {showDayTotal && (
                      <Text
                        fontFamily="$body"
                        fontSize={13}
                        color="$color8"
                        letterSpacing={0.5}
                      >
                        {dayTotalWords} words today.
                      </Text>
                    )}
                  </YStack>

                  <View marginTop={16}>
                    <ExpandingLineButton
                      id={QUIETER_DISMISS_ID}
                      size="default"
                      onPress={handleDismiss}
                    >
                      Done
                    </ExpandingLineButton>
                  </View>
                </YStack>
              )}
            </AnimatePresence>

            {/* Scroll indicator — pinned to the bottom of the hero viewport, on
                both variants, whenever there are words to scroll down to */}
            {hasContent && (
              <YStack
                position="absolute"
                bottom={40}
                left={0}
                right={0}
                alignItems="center"
                gap="$1"
                opacity={0.3}
              >
                <Text
                  fontFamily="$body"
                  fontSize={10}
                  letterSpacing={2}
                  textTransform="uppercase"
                  color="$color8"
                >
                  Your words
                </Text>
                <Text
                  fontFamily="$body"
                  fontSize={14}
                  color="$color8"
                >
                  {'↓'}
                </Text>
              </YStack>
            )}
          </YStack>
        )}
      </AnimatePresence>

      {/* Re-read section — the finished flow, below the fold, on both variants */}
      {hasContent && (
        <YStack
          width="100%"
          maxWidth={672}
          alignSelf="center"
          paddingHorizontal="$4"
          paddingBottom={96}
        >
          <YStack
            borderTopWidth={1}
            borderColor="$color2"
            paddingTop="$6"
          >
            <Editor
              readOnly
              initialContent={content}
            />
          </YStack>
        </YStack>
      )}
    </ScrollView>
  )
}
