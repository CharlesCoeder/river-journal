/**
 * CelebrationScreen.tsx
 *
 * Variant-aware celebration screen that branches on whether the just-saved flow
 * is the first 500-crossing flow on today's writing day:
 *
 *  - Handoff variant: serif word count, streak day, "The Collective is open."
 *    microcopy + Visit, optional UnlockNotification, Done dismiss.
 *  - Quieter variant: word count only, auto-dismisses ~2s or on tap.
 *
 * Focus trap note (AC 13): this is a full-page route, not an overlay modal.
 * There is no underlying page content for focus to leak into — the browser's
 * natural tab loop within the route body satisfies the intent of UX-DR52.
 * If CelebrationScreen is ever converted to a Tamagui Dialog overlay, add the
 * trap at that point — Tamagui's Dialog provides it built-in.
 *
 * Focus return on dismiss (AC 13): router.push(...) replaces the route;
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
} from '@my/ui'
import { useRouter } from 'solito/navigation'
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

export function CelebrationScreen() {
  const router = useRouter()
  const lastSavedFlow = use$(store$.lastSavedFlow)
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const [mounted, setMounted] = useState(false)
  const [showCelebration, setShowCelebration] = useState(false)
  const [nudgeDismissed, setNudgeDismissed] = useState(false)
  const nudgeHeight = useRef(0)
  const [nudgeCollapsedHeight, setNudgeCollapsedHeight] = useState<number | 'auto'>('auto')
  const reduceMotion = useReducedMotion()

  // Refs for focus management (AC 12)
  const visitButtonRef = useRef<any>(null)
  const quieterPressableRef = useRef<any>(null)

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

  // streak is a function-shaped computed view: subscribe as whole object, then destructure.
  // CRITICAL: use$(store$.views.streak.currentStreak) is NOT valid — sub-field subscriptions
  // on function-shaped computeds are not supported. Use whole-object pattern. (Dev Note #5)
  const streak = use$(store$.views.streak)
  const currentStreak = (streak as any)?.currentStreak ?? 0
  const tokensEarned = (streak as any)?.unlockTokensEarned ?? 0

  const surfaced = use$(ephemeral$.surfacedUnlockMilestones)

  // Most recent earned milestone (MILESTONES is sorted ascending; AC 6 indexing logic)
  const latestEarnedMilestone = tokensEarned > 0 ? (MILESTONES[tokensEarned - 1] ?? null) : null
  const showUnlock =
    variant === 'handoff' && latestEarnedMilestone !== null && !surfaced.has(latestEarnedMilestone)

  // Mount + celebration entrance effect.
  // CRITICAL — record-as-surfaced timing: mark surfaced inside the same setTimeout that
  // triggers the entrance animation (showCelebration). Do NOT mark in render (infinite loop)
  // or on dismiss (re-prompts on next exit). "Surfaced once shown" is the rule. (AC 6)
  useEffect(() => {
    clearActiveFlow()
    setMounted(true)
    const t = setTimeout(() => {
      setShowCelebration(true)
      if (showUnlock && latestEarnedMilestone !== null) {
        markUnlockSurfaced(latestEarnedMilestone)
      }
      // Focus management (AC 12): focus first interactive element on mount (web only)
      // On native, RN View lacks .focus(); TODO(native a11y focus): use
      // AccessibilityInfo.setAccessibilityFocus(findNodeHandle(ref.current)) when available.
      if (typeof window !== 'undefined') {
        requestAnimationFrame(() => {
          if (variant === 'handoff' && visitButtonRef.current?.focus) {
            visitButtonRef.current.focus()
          } else if (variant !== 'handoff' && quieterPressableRef.current?.focus) {
            quieterPressableRef.current.focus()
          }
        })
      }
    }, 200)
    return () => clearTimeout(t)
  }, [showUnlock, latestEarnedMilestone]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss for quieter variant (AC 7)
  useEffect(() => {
    if (variant !== 'handoff') {
      const t = setTimeout(() => handleDismiss(), 2000)
      return () => clearTimeout(t)
    }
  }, [variant]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lastSavedFlow) {
      router.push('/')
    }
  }, [lastSavedFlow, router])

  const handleDismiss = () => {
    clearLastSavedFlow()
    router.push('/')
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

  // AC 4 fallback: if variant is handoff but streak hasn't recomputed yet, render quieter.
  // This handles the async subscription race on cold mount.
  const effectiveVariant = variant === 'handoff' && currentStreak >= 1 ? 'handoff' : variant

  // Animation tokens (AC 5, AC 7, AC 15)
  // Reduced motion: swap springs to '100ms' tween (≤200ms, AC 15).
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

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{ flexGrow: 1 }}
    >
      {/* Hero section — takes full viewport height, centers celebration content */}
      <AnimatePresence>
        {mounted && (
          <YStack
            key="celebration-content"
            // AC 11: dialog semantics on the outer variant-wrapping stack
            tag="div"
            role="dialog"
            aria-modal="true"
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
            minHeight="100vh"
            justifyContent="center"
            alignItems="center"
            position="relative"
          >
            <AnimatePresence>
              {showCelebration && effectiveVariant === 'handoff' && (
                // ─── Handoff variant (AC 4) ───────────────────────────────────
                <YStack
                  key="celebration-center"
                  transition={innerTransition as any}
                  enterStyle={{ opacity: 0, y: 30 }}
                  opacity={1}
                  y={0}
                  alignItems="center"
                  gap="$6"
                >
                  {/* Word count — serif $8; id for aria-labelledby (AC 11, AC 12) */}
                  <Text
                    id="celebration-wordcount"
                    fontFamily="$journal"
                    fontSize="$8"
                    color="$color"
                    letterSpacing={-0.5}
                  >
                    {wordCount} words.
                  </Text>

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
                    {/* Visit button — primary focus target on handoff mount (AC 12) */}
                    <View ref={visitButtonRef}>
                      <ExpandingLineButton
                        size="default"
                        onPress={handleOpenCollective}
                      >
                        Visit
                      </ExpandingLineButton>
                    </View>
                  </XStack>

                  {/* UnlockNotification slot (AC 6) — handoff variant only */}
                  {showUnlock && (
                    <UnlockNotification
                      onChooseTheme={handleChooseTheme}
                      enterTransition={unlockTransition}
                    />
                  )}

                  {/* Done dismiss button — no auto-dismiss on handoff (AC 4) */}
                  <View marginTop={48}>
                    <ExpandingLineButton
                      size="default"
                      onPress={handleDismiss}
                    >
                      Done
                    </ExpandingLineButton>
                  </View>

                  {/* Auth nudge — handoff variant only (AC 8) */}
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
                // ─── Quieter variant (AC 7) ───────────────────────────────────
                // Full-page route — no focus trap needed (AC 13). Browser tab loop
                // within this route body satisfies UX-DR52's intent: there is no
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
                  {/* Tap-to-dismiss wrapper (AC 7) */}
                  <View
                    role="button"
                    aria-label="Dismiss"
                    onPress={handleDismiss}
                    cursor="pointer"
                    tabIndex={0}
                    onKeyDown={(e: any) => {
                      if (e.key === 'Enter' || e.key === ' ') handleDismiss()
                    }}
                    ref={quieterPressableRef}
                  >
                    {/* Word count only — body sans; aria-live for screen reader announce (AC 14) */}
                    <Text
                      fontFamily="$body"
                      fontSize={18}
                      color="$color"
                      letterSpacing={0.5}
                      aria-live="polite"
                      role="status"
                    >
                      {wordCount} words today.
                    </Text>
                  </View>
                </YStack>
              )}
            </AnimatePresence>

            {/* Scroll indicator — pinned to bottom of hero viewport (handoff only) */}
            {effectiveVariant === 'handoff' && (
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

      {/* Re-read section — below the fold (handoff variant only; quieter auto-dismisses) */}
      {effectiveVariant === 'handoff' && (
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
