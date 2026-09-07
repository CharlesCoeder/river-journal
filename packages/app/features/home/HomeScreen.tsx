import {
  AnimatePresence,
  YStack,
  Text,
  XStack,
  ScrollView,
  View,
  useReducedMotion,
  StreakChip,
  CollectiveEntry,
  isWeb,
} from '@my/ui'
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
import { ModerationReceiptGate } from 'app/features/moderation-receipts/ModerationReceiptGate'
import { StreakReminderPermissionGate } from 'app/features/notifications/StreakReminderPermissionGate'
import { InAppReminderGate } from 'app/features/notifications/InAppReminderGate'
import { refreshReminderOffsetOnAppOpen } from 'app/features/notifications/reminderPreferences'
import { useToday } from 'app/state/today'
import { WordLinkNav } from 'app/features/navigation/WordLinkNav'
import { useLapsedPrompt } from 'app/features/home/useLapsedPrompt'
import {
  COLLECTIVE_DEV_ROUTE,
  isCollectiveDevEnabled,
} from 'app/features/collective/isCollectiveDevEnabled'

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

  // Keep the stored local UTC offset current once per app open, so a user who
  // travelled or crossed a DST boundary between sessions still fires their
  // streak reminder in their real local window. Guarded on an authenticated
  // user; the helper is itself a null-safe no-op when reminders are disabled or
  // the offset is unchanged. Home is the guaranteed post-auth landing surface on
  // every platform, so it is the natural once-per-open mount point.
  // Mount-once (empty dep list is deliberate): this is an app-open refresh, not
  // a reaction to auth-state changes within a session.
  useEffect(() => {
    if (!isAuthenticated) return
    refreshReminderOffsetOnAppOpen()
  }, [])

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

  // Mobile: the menu surface has a visible entry point, not a gesture-only
  // one. The Slider Hub slide-left remains as an accelerator for the same
  // destination, so there is exactly one mental model: home ⇄ menu.
  const handleMenuPress = () => {
    if (showLapsed) dismissLapsed()
    router.push('/menu')
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
        onScroll={() => {
          if (showLapsed) dismissLapsed()
        }}
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
              {/* Menu entry (mobile only) — anchored top-left, mirroring the streak chip */}
              {!isWeb && <HomeMenuButtonSlot onPress={handleMenuPress} />}
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

                  {/* Word-link nav row — web/desktop only. On mobile the same
                      destinations live in the menu surface (button top-left or
                      slide left), so rendering them here too would be a second,
                      competing navigation model. */}
                  {isWeb ? <WordLinkNav variant="home" /> : null}
                </XStack>
              </YStack>
            </YStack>
          )}
        </AnimatePresence>

        <KeyringPrompt />
        <OrphanFlowsDialog />
      </ScrollView>
      <EncryptionModeDialog />
      {/* Post-auth moderation receipts — self-gates on auth/queue, renders null
          when there's nothing to show. Mounted here (the guaranteed post-auth
          landing surface), not in the provider tree, so it never renders pre-auth. */}
      <ModerationReceiptGate />
      {/* First-streak-day push permission prompt — mobile only, once-ever.
          Self-gates on platform/streak/seen/token/permission; renders null on
          web/desktop and whenever the trigger condition is not met. Mounted
          here (the post-CelebrationScreen-handoff landing surface) so it
          re-evaluates on every home visit. */}
      <StreakReminderPermissionGate />
      {/* Web/desktop in-app reminder card — the parity backstop for OS push on
          those platforms. Self-gates on platform (web/desktop only), auth, and
          whether any reminder category is pending; renders null on mobile and
          whenever nothing is pending. Mounted here so it re-evaluates on every
          home landing. */}
      <InAppReminderGate />
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

/** Menu entry slot — mobile only. Quiet uppercase word-link in the streak chip's register, 44px hit target. */
function HomeMenuButtonSlot({ onPress }: { onPress: () => void }) {
  return (
    <View
      testID="home-menu-button-slot"
      position="absolute"
      top="$4"
      left="$4"
    >
      <View
        role="button"
        aria-label="Open menu"
        cursor="pointer"
        minHeight={44}
        minWidth={44}
        justifyContent="center"
        // Pull the visible label back to the content edge while keeping the
        // full 44px target (touch targets ≥ 44×44 is a locked mobile rule).
        marginTop={-12}
        marginLeft={-8}
        paddingHorizontal={8}
        pressStyle={{ opacity: 0.6 }}
        onPress={onPress}
      >
        <Text
          fontFamily="$body"
          fontSize="$3"
          color="$color8"
          letterSpacing={1}
          textTransform="uppercase"
        >
          Menu
        </Text>
      </View>
    </View>
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
      <StreakChip
        dayCount={currentStreak}
        state={state}
      />
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
