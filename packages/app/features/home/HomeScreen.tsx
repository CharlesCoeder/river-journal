import { AnimatePresence, YStack, Text, XStack, ScrollView, View, useReducedMotion, StreakChip, CollectiveEntry } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { isSyncReady$ } from 'app/state/syncConfig'
import { pendingCollectiveReturn$ } from 'app/state/authReturn'
import type { StreakState } from 'app/state/streak'
import { useEffect, useState } from 'react'
import { EncryptionModeDialog } from 'app/features/home/components/EncryptionModeDialog'
import { KeyringPrompt } from 'app/features/home/components/KeyringPrompt'
import { OrphanFlowsDialog } from 'app/features/home/components/OrphanFlowsDialog'
import { LapsedPrompt } from 'app/features/home/components/LapsedPrompt'
import { useToday } from 'app/state/today'
import { WordLinkNav } from 'app/features/navigation/WordLinkNav'
import { useLapsedPrompt } from 'app/features/home/useLapsedPrompt'
import { COLLECTIVE_DEV_ROUTE, isCollectiveDevEnabled } from 'app/features/collective/isCollectiveDevEnabled'

export function HomeScreen() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // useToday() re-renders this screen at local midnight so the date hero,
  // today's stats, and the streak chip roll over without a remount.
  const todayJournalDay = useToday()
  const todayStats = use$(store$.views.statsByDate(todayJournalDay))
  const { shouldShow: showLapsed, dismiss: dismissLapsed } = useLapsedPrompt()
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const isSyncReady = use$(isSyncReady$)

  // Post-auth return-to-Collective forwarding. The account gate records a
  // persisted pending marker, then auth lands back on home (as always) so the
  // device-setup dialogs mounted on this screen (orphan adoption, encryption
  // setup) can run. Once sync readiness opens, forward to the Collective —
  // consuming the marker exactly once: it is cleared BEFORE navigating so a
  // later readiness recompute (or re-render) can never re-fire the navigation.
  // If readiness never opens (setup abandoned), the user simply stays on home;
  // a manual authenticated Collective tap below remains the escape hatch.
  useEffect(() => {
    if (!isSyncReady) return
    if (!pendingCollectiveReturn$.peek()) return
    pendingCollectiveReturn$.set(false)
    router.replace('/collective')
  }, [isSyncReady, router])

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const handleBeginFlow = () => {
    if (showLapsed) dismissLapsed()
    router.push('/journal')
  }

  const handleCollectivePress = () => {
    if (showLapsed) dismissLapsed()
    if (!isAuthenticated) {
      // Account gate: joining the Collective requires an account. The gate
      // carries the origin + return target so the auth surface can show
      // Collective-context copy and route back here-then-forward after auth.
      router.push('/auth?from=collective&returnTo=%2Fcollective')
      return
    }
    // Direct authenticated entry — clear any stale pending return marker so a
    // later sync-readiness change can never trigger a surprise auto-navigation.
    pendingCollectiveReturn$.set(false)
    router.push('/collective')
  }

  // Dev-only convenience link to the real Collective feed at /collective/dev.
  // Gated by an env flag so it stays hidden on public production builds; the
  // route itself is always reachable by typing it. See isCollectiveDevEnabled.
  const showCollectiveDev = isCollectiveDevEnabled()
  const handleCollectiveDevPress = () => {
    if (showLapsed) dismissLapsed()
    router.push(COLLECTIVE_DEV_ROUTE)
  }

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
    >
      <ScrollView
        flex={1}
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        onScroll={() => { if (showLapsed) dismissLapsed() }}
        scrollEventThrottle={1000}
        testID="home-scroll-view"
      >
        <AnimatePresence>
          {mounted && (
            <YStack
              key="home-content"
              transition="designEnter"
              enterStyle={{ opacity: 0, y: 15 }}
              opacity={1}
              y={0}
              width="100%"
              flex={1}
              maxWidth={1024}
              alignSelf="center"
              paddingHorizontal="$4"
              justifyContent="center"
              alignItems="flex-start"
              $sm={{ paddingHorizontal: '$6' }}
              $md={{ paddingHorizontal: '$8' }}
              $lg={{ paddingHorizontal: '$12' }}
              position="relative"
            >
              {/* StreakChip — anchored to top-right of the centered content card (M1 fix from 1-6 review) */}
              <HomeStreakChipSlot />
              {/* Content — left-aligned, generous spacing */}
              <YStack
                gap={96}
                width="100%"
              >
                {/* Date display */}
                <YStack gap="$5">
                  <Text
                    fontFamily="$body"
                    fontSize={14}
                    color="$color8"
                    letterSpacing={1}
                    textTransform="uppercase"
                  >
                    Today
                  </Text>
                  <Text
                    fontFamily="$journal"
                    fontSize={60}
                    color="$color"
                    letterSpacing={-1}
                    lineHeight={68}
                    $sm={{ fontSize: 48, lineHeight: 56 }}
                  >
                    {today}.
                  </Text>
                  {/* CollectiveEntry — below date, inside date YStack */}
                  <HomeCollectiveEntrySlot onPress={handleCollectivePress} />
                  {/* Dev-only link to the real Collective feed (env-gated) */}
                  {showCollectiveDev && (
                    <Text
                      testID="home-collective-dev-link"
                      onPress={handleCollectiveDevPress}
                      fontFamily="$body"
                      fontSize={13}
                      color="$color8"
                      letterSpacing={0.5}
                      textTransform="uppercase"
                      cursor="pointer"
                      pressStyle={{ opacity: 0.6 }}
                      hoverStyle={{ color: '$color' }}
                    >
                      Collective — dev →
                    </Text>
                  )}
                </YStack>

                {/* Lapsed prompt — between date block and action area */}
                <LapsedPrompt />

                {/* Action area */}
                <XStack
                  flexWrap="wrap"
                  alignItems="baseline"
                  gap="$6"
                >
                  {/* Primary CTA — serif italic underline */}
                  <BeginWritingCTA onPress={handleBeginFlow} />

                  {/* Word-link nav row (web/desktop wide viewports only) */}
                  <WordLinkNav variant="home" />
                </XStack>
              </YStack>
            </YStack>
          )}
        </AnimatePresence>

        <KeyringPrompt />
        <OrphanFlowsDialog />
      </ScrollView>
      <EncryptionModeDialog />
    </YStack>
  )
}

/** State-driven CTA so the spring animation works in production (not CSS-extracted) */
function BeginWritingCTA({ onPress }: { onPress: () => void }) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const reduceMotion = useReducedMotion()

  const active = hovered || pressed

  return (
    <Text
      fontFamily="$journalItalic"
      fontStyle="italic"
      fontSize={36}
      $sm={{ fontSize: 30 }}
      color="$color"
      cursor="pointer"
      transition={reduceMotion ? undefined : 'ctaSpring'}
      x={!reduceMotion && active ? 5 : 0}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      aria-label="Begin writing"
      role="button"
      // onHoverIn/onHoverOut are handled at runtime by Tamagui's web component
      // but are absent from the Text prop types (only present on Stack-based types).
      {...({
        onHoverIn: () => setHovered(true),
        onHoverOut: () => setHovered(false),
      } as object)}
    >
      Begin writing
    </Text>
  )
}

/** StreakChip slot — anchored to top-right of the centered content card (M1 fix: moved inside maxWidth={1024} YStack) */
function HomeStreakChipSlot() {
  const streak = use$(store$.views.streak) as StreakState | undefined
  const currentStreak = streak?.currentStreak ?? 0
  const today = useToday()
  const state = streak?.lastQualifyingDate === today ? 'active' : 'pending'
  return (
    <View
      testID="home-streak-chip-slot"
      position="absolute"
      top="$4"
      right="$4"
    >
      <StreakChip dayCount={currentStreak} state={state} />
    </View>
  )
}

/** CollectiveEntry slot — below date hero inside date YStack */
function HomeCollectiveEntrySlot({ onPress }: { onPress: () => void }) {
  return (
    <View testID="home-collective-entry-slot">
      <CollectiveEntry onPress={onPress} />
    </View>
  )
}

