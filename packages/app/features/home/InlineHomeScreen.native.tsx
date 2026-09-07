import { useCallback, useEffect, useState } from 'react'
import { BackHandler } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { YStack, XStack, Text, View, StreakChip, CollectiveEntry, useReducedMotion } from '@my/ui'
import { X } from '@tamagui/lucide-icons'
import { useRouter } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import {
  store$,
  ephemeral$,
  showInlineEditor,
  hidePersistentEditor,
  setInlineEditorGeometry,
  expandInlineEditor,
  collapseInlineEditor,
  clearPersistentEditorContent,
  updatePersistentEditorBottomBarHeight,
  saveActiveFlowSession,
  discardActiveFlowSession,
  getActiveFlowContent,
  flushEditorContent,
  hasReachedAutosaveCheckpoint,
  setFocusMode,
} from 'app/state/store'
import { isSyncReady$ } from 'app/state/syncConfig'
import { pendingCollectiveReturn$ } from 'app/state/authReturn'
import type { StreakState } from 'app/state/streak'
import { useToday } from 'app/state/today'
import { KeyboardOffsetView } from 'app/features/journal/components/KeyboardOffsetView'
import {
  FlowSessionBottomBar,
  FlowExitConfirmDialog,
} from 'app/features/journal/components/FlowSessionChrome'
import { useTrackKeyboardHeight } from 'app/features/journal/hooks/useTrackKeyboardHeight'
import { EncryptionModeDialog } from 'app/features/home/components/EncryptionModeDialog'
import { KeyringPrompt } from 'app/features/home/components/KeyringPrompt'
import { OrphanFlowsDialog } from 'app/features/home/components/OrphanFlowsDialog'
import { LapsedPrompt } from 'app/features/home/components/LapsedPrompt'
import { useLapsedPrompt } from 'app/features/home/useLapsedPrompt'
import { ModerationReceiptGate } from 'app/features/moderation-receipts/ModerationReceiptGate'
import { StreakReminderPermissionGate } from 'app/features/notifications/StreakReminderPermissionGate'
import { InAppReminderGate } from 'app/features/notifications/InAppReminderGate'
import { refreshReminderOffsetOnAppOpen } from 'app/features/notifications/reminderPreferences'
import {
  COLLECTIVE_DEV_ROUTE,
  isCollectiveDevEnabled,
} from 'app/features/collective/isCollectiveDevEnabled'

// ---------------------------------------------------------------------------
// InlineHomeScreen (mobile experiment)
//
// Home IS the writing surface. The page reads, top to bottom: a quiet top row
// (Menu ⟷ streak chip), today's date, the Collective entry, and then the
// editor itself — live, with its placeholder — filling the rest of the screen.
//
//   collapsed  ──tap into the editor──▶  expanded (writing mode)
//   • chrome visible                     • chrome fades + lifts away
//   • editor rests under the chrome      • editor slides up to the top row
//                                        • close (×) replaces the streak chip
//
// Leaving writing mode is deliberately easy while nothing has been written:
// dismissing the keyboard (blur) with an empty page collapses straight back
// to home, as does the × or Android back. Once there are words, the keyboard
// can go up and down freely; the × pauses the session (content stays, the
// collapsed page still shows it) and Finish Session ends it — the same
// "<50 words → confirm" rule as JournalScreen, except a confirmed discard
// really does clear the page, since the editor stays on screen afterwards.
//
// Geometry: the header block reports its height (collapsed anchor), the top
// row reports its bottom (expanded anchor) and the hero its x (text inset);
// PersistentEditor.native.tsx turns those into the editor's frame.
// ---------------------------------------------------------------------------

/** Breathing room between the top row and the expanded editor's first line. */
const EXPANDED_TOP_GAP = 8

export function InlineHomeScreen() {
  const router = useRouter()
  const reduceMotion = useReducedMotion()
  useTrackKeyboardHeight()

  // useToday() re-renders this screen at local midnight so the date hero and
  // the streak chip roll over without a remount.
  const todayJournalDay = useToday()
  const { shouldShow: showLapsed, dismiss: dismissLapsed } = useLapsedPrompt()
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const isSyncReady = use$(isSyncReady$)

  const activeFlow = use$(store$.activeFlow)
  // Instant (non-debounced) word count so the bottom bar appears immediately.
  const wordCount = use$(ephemeral$.instantWordCount)
  const hasContent = wordCount > 0 || !!activeFlow?.content
  const expanded = use$(ephemeral$.persistentEditor.expanded)
  const isFocused = use$(ephemeral$.persistentEditor.isFocused)
  const focusMode = use$(store$.profile?.editor?.focusMode) ?? false
  const [showExitConfirmDialog, setShowExitConfirmDialog] = useState(false)

  // ── Carry-overs from HomeScreen (home is the post-auth landing surface) ──
  // Mount-once (empty dep list is deliberate): an app-open refresh, not a
  // reaction to auth-state changes within a session.
  useEffect(() => {
    if (!isAuthenticated) return
    refreshReminderOffsetOnAppOpen()
  }, [])

  // Post-auth return-to-Collective forwarding; the marker is cleared BEFORE
  // navigating so a later readiness recompute can never re-fire it.
  useEffect(() => {
    if (!isSyncReady) return
    if (!pendingCollectiveReturn$.peek()) return
    pendingCollectiveReturn$.set(false)
    router.replace('/collective')
  }, [isSyncReady, router])

  // ── Editor lifecycle ─────────────────────────────────────────────────────
  // The inline editor exists only while home is the focused route: pushing
  // the menu, settings or the celebration hides it (flushing typed words into
  // activeFlow), and coming back re-shows it with that content.
  useFocusEffect(
    useCallback(() => {
      showInlineEditor({ content: store$.activeFlow.content.get() || '' })
      return () => {
        hidePersistentEditor()
      }
    }, [])
  )

  // Focus (keyboard up) → writing mode.
  useEffect(() => {
    if (isFocused && !expanded) expandInlineEditor()
  }, [isFocused, expanded])

  // Keyboard down with nothing written → straight back to home, no ceremony.
  useEffect(() => {
    if (!isFocused && expanded && !hasContent) collapseInlineEditor()
  }, [isFocused, expanded, hasContent])

  // Android back while writing collapses the page instead of leaving the app.
  useEffect(() => {
    if (!expanded) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      collapseInlineEditor()
      return true
    })
    return () => subscription.remove()
  }, [expanded])

  // ── Geometry reports → PersistentEditor ──────────────────────────────────
  // All y values are relative to this screen's root, which sits at the
  // safe-area top; PersistentEditor adds insets.top itself.
  const handleTopRowLayout = useCallback((e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout
    setInlineEditorGeometry({ expandedTop: y + height + EXPANDED_TOP_GAP })
  }, [])
  const handleHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout
    setInlineEditorGeometry({ inlineTop: y + height })
  }, [])
  const handleHeroLayout = useCallback((e: LayoutChangeEvent) => {
    setInlineEditorGeometry({ insetX: e.nativeEvent.layout.x })
  }, [])
  const handleBottomBarLayout = useCallback((e: LayoutChangeEvent) => {
    updatePersistentEditorBottomBarHeight(e.nativeEvent.layout.height)
  }, [])

  // ── Finishing a session ──────────────────────────────────────────────────
  const finishAndCelebrate = () => {
    saveActiveFlowSession()
    setShowExitConfirmDialog(false)
    // The editor hides on route blur (useFocusEffect cleanup); collapsing
    // first sends the keyboard down before the celebration appears.
    collapseInlineEditor()
    router.push('/journal/celebration')
  }

  const discardAndCollapse = () => {
    setShowExitConfirmDialog(false)
    // Checkpoint any pending keystrokes first so a late debounced write can't
    // resurrect the discarded words after activeFlow is cleared.
    flushEditorContent()
    discardActiveFlowSession()
    clearPersistentEditorContent()
    collapseInlineEditor()
  }

  const handleFinish = () => {
    flushEditorContent()
    const content = getActiveFlowContent()
    const count = ephemeral$.instantWordCount.peek()
    if (!content.trim()) {
      collapseInlineEditor()
      return
    }
    if (count < 50 && !hasReachedAutosaveCheckpoint()) {
      setShowExitConfirmDialog(true)
      return
    }
    finishAndCelebrate()
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  const handleMenuPress = () => {
    if (showLapsed) dismissLapsed()
    router.push('/menu')
  }

  const handleCollectivePress = () => {
    if (showLapsed) dismissLapsed()
    if (!isAuthenticated) {
      router.push('/auth?from=collective&returnTo=%2Fcollective')
      return
    }
    pendingCollectiveReturn$.set(false)
    router.push('/collective')
  }

  const showCollectiveDev = isCollectiveDevEnabled()
  const handleCollectiveDevPress = () => {
    if (showLapsed) dismissLapsed()
    router.push(COLLECTIVE_DEV_ROUTE)
  }

  // ── Presentation ─────────────────────────────────────────────────────────
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
  const streak = use$(store$.views.streak) as StreakState | undefined
  const currentStreak = streak?.currentStreak ?? 0
  const streakState = streak?.lastQualifyingDate === todayJournalDay ? 'active' : 'pending'

  const chromeTransition = reduceMotion ? '100ms' : 'designEnter'
  const chromeHidden = expanded

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
    >
      {/* Header block — everything above the writing area. Its height is the
          collapsed editor's anchor, so the hero keeps its layout while faded. */}
      <YStack
        testID="inline-home-header"
        onLayout={handleHeaderLayout}
        width="100%"
        paddingHorizontal="$6"
      >
        {/* Top row: Menu ⟷ streak chip; in writing mode the chip yields to the close control. */}
        <XStack
          onLayout={handleTopRowLayout}
          minHeight={44}
          alignItems="center"
          justifyContent="space-between"
          paddingTop="$2"
        >
          <View
            opacity={chromeHidden ? 0 : 1}
            transition={chromeTransition}
            pointerEvents={chromeHidden ? 'none' : 'auto'}
          >
            <MenuWordLink onPress={handleMenuPress} />
          </View>
          <View
            position="relative"
            minHeight={44}
            justifyContent="center"
          >
            <View
              opacity={chromeHidden ? 0 : 1}
              transition={chromeTransition}
              pointerEvents={chromeHidden ? 'none' : 'auto'}
              testID="inline-home-streak-chip-slot"
            >
              <StreakChip
                dayCount={currentStreak}
                state={streakState}
              />
            </View>
            <View
              position="absolute"
              right={-12}
              top={0}
              bottom={0}
              justifyContent="center"
              opacity={chromeHidden ? 1 : 0}
              transition={chromeTransition}
              pointerEvents={chromeHidden ? 'auto' : 'none'}
            >
              <CloseEditorButton onPress={collapseInlineEditor} />
            </View>
          </View>
        </XStack>

        {/* Hero — fades and lifts away when writing begins; keeps its layout. */}
        <YStack
          onLayout={handleHeroLayout}
          gap="$5"
          paddingTop="$6"
          paddingBottom="$6"
          opacity={chromeHidden ? 0 : 1}
          y={chromeHidden ? -8 : 0}
          transition={chromeTransition}
          pointerEvents={chromeHidden ? 'none' : 'auto'}
        >
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
            fontSize={48}
            lineHeight={56}
            color="$color"
            letterSpacing={-1}
          >
            {today}.
          </Text>
          <View testID="home-collective-entry-slot">
            <CollectiveEntry onPress={handleCollectivePress} />
          </View>
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
            >
              Collective — dev →
            </Text>
          )}
          <LapsedPrompt />
        </YStack>
      </YStack>

      {/* Writing area — the persistent editor WebView overlays this region.
          Transparent on purpose: the page background shows through. */}
      <YStack
        flex={1}
        testID="inline-editor-slot"
      />

      {/* Session chrome — appears once there is something to finish. */}
      <KeyboardOffsetView>
        <FlowSessionBottomBar
          visible={hasContent}
          wordCount={wordCount}
          focusMode={focusMode}
          onToggleFocusMode={() => setFocusMode(!focusMode)}
          onFinish={handleFinish}
          onLayout={handleBottomBarLayout}
        />
      </KeyboardOffsetView>
      <FlowExitConfirmDialog
        open={showExitConfirmDialog}
        onOpenChange={setShowExitConfirmDialog}
        onCancel={() => setShowExitConfirmDialog(false)}
        onConfirm={discardAndCollapse}
      />

      {/* Post-auth / device-setup surfaces carried over from HomeScreen. Each
          self-gates and renders null when there is nothing to show. */}
      <KeyringPrompt />
      <OrphanFlowsDialog />
      <EncryptionModeDialog />
      <ModerationReceiptGate />
      <StreakReminderPermissionGate />
      <InAppReminderGate />
    </YStack>
  )
}

/** Quiet uppercase word-link in the streak chip's register, 44px hit target. */
function MenuWordLink({ onPress }: { onPress: () => void }) {
  return (
    <View
      role="button"
      aria-label="Open menu"
      cursor="pointer"
      minHeight={44}
      minWidth={44}
      justifyContent="center"
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
  )
}

/** Puts the page back: collapses the editor and dismisses the keyboard. Words stay. */
function CloseEditorButton({ onPress }: { onPress: () => void }) {
  return (
    <View
      role="button"
      aria-label="Close editor"
      cursor="pointer"
      width={44}
      height={44}
      alignItems="center"
      justifyContent="center"
      pressStyle={{ opacity: 0.6 }}
      onPress={onPress}
    >
      <X
        size={20}
        color="$color9"
      />
    </View>
  )
}
