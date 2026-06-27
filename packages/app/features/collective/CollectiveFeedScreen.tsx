// packages/app/features/collective/CollectiveFeedScreen.tsx
//
// The Collective "room" — a title-led forum feed (title-led redesign, Story 3-16).
// Renders a scannable list of letter TITLES + metadata + a read-only reaction
// tally; tapping a title opens the thread. Bodies are NOT shown in the list
// (the feed RPC dropped `body`; see FeedPostRow).
//
// Defense-in-depth: NEVER read store$.streak.* for mode dispatch —
// feed.data.pages[0].mode is the SOLE source of truth (server has already
// returned the correct shape). Local streak state may lag or be tampered with.
//
// Boundary rule (D7): no Legend-State imports in this file.
// features/collective/** MUST NOT import Legend-State or app/state/store.

import { useEffect, useMemo, useState } from 'react'
import {
  AnimatePresence,
  YStack,
  View,
  Text,
  XStack,
  Separator,
  ScrollView,
  ExpandingLineButton,
  useReducedMotion,
} from '@my/ui'
import { PenLine } from '@tamagui/lucide-icons'
import { onlineManager } from '@tanstack/react-query'
import { useFeed } from 'app/state/collective/feed'
import { useIsSuspended } from 'app/state/collective/suspension'
import { useCurrentUserId } from 'app/state/collective/currentUser'
import { useLocallyHiddenPostIds } from 'app/state/collective/locallyHidden'
import {
  CollectiveLockedScreen,
  glimpseFromPosts,
} from 'app/features/collective/CollectiveLockedScreen'
import { FeedPostRow } from 'app/features/collective/FeedPostRow'
import { useRouter } from 'solito/navigation'
import { SkeletonRows, formatTimeAgo } from './_shared'

// ─── Header date ──────────────────────────────────────────────────────────────
// "Tuesday, June 23" — weekday + month + day, to anchor the daily room.
function todayLong(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CollectiveFeedScreen() {
  // All hooks must be called unconditionally before any early returns (Rules of Hooks)
  const feed = useFeed()
  const currentUserId = useCurrentUserId()
  const isSuspended = useIsSuspended(currentUserId ?? null)
  const reducedMotion = useReducedMotion()
  const router = useRouter()
  const hiddenIds = useLocallyHiddenPostIds()

  // Ease the room in on mount — mirrors the Settings/Preferences entrance so the
  // Collective screen fades into view rather than popping in. The `mounted` gate
  // forces a genuine client-side mount so Tamagui replays `enterStyle` reliably.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // Flatten pages, apply defensive is_removed filter, then apply local-hide
  // filter. is_removed runs first (global moderation override); local-hide
  // runs second (user preference).
  const allPosts = useMemo(() => {
    const flat = feed.data?.pages.flatMap((p) => p.items) ?? []
    return flat.filter((p) => !p.is_removed).filter((p) => !hiddenIds.has(p.id))
  }, [feed.data, hiddenIds])

  const isOnline = onlineManager.isOnline()

  // ─── Loading state (cold cache) ─────────────────────────────────────────────
  if (feed.isLoading && feed.data === undefined) {
    return (
      <YStack>
        <SkeletonRows reducedMotion={reducedMotion} />
      </YStack>
    )
  }

  // ─── Error state — no data ────────────────────────────────────────────────
  if (feed.isError && feed.data === undefined) {
    return (
      <YStack>
        <Text fontSize="$2" color="$color9" textAlign="center" paddingVertical="$4">
          Couldn&apos;t load the feed. Pull to retry.
        </Text>
        <ExpandingLineButton onPress={() => feed.refetch()}>Retry</ExpandingLineButton>
      </YStack>
    )
  }

  // ─── Mode dispatch ────────────────────────────────────────────────────────
  // Defense-in-depth: trust RPC mode, never local streak state.
  const mode = feed.data?.pages[0]?.mode

  // ─── Preview mode → the unified locked screen's `words` gate ───────────────
  // The sub-500 state is server-driven: we only know it once the feed RPC
  // returns mode:'preview' (auth + sync are already satisfied to get here). Hand
  // off to the shared CollectiveLockedScreen with the real preview posts for the
  // glimpse. This is the design's third gate state.
  if (mode === 'preview') {
    const posts = feed.data?.pages[0]?.items ?? []
    return (
      // key={mode} ensures clean re-mount on mode flip (preview ↔ full)
      // flex={1} threads the screen's height down to the locked screen's own
      // ScrollView so the preview (words gate) scrolls on native.
      <View key={mode} flex={1}>
        <AnimatePresence>
          {mounted && (
            <View
              key="collective-preview-body"
              flex={1}
              transition="designEnter"
              enterStyle={{ opacity: 0, y: 10 }}
              opacity={1}
              y={0}
            >
              <CollectiveLockedScreen
                gate="words"
                // TODO: wire the user's real daily word count here once a D7-safe
                // client source exists. This file must not read Legend-State / the
                // streak store, so we stub at 0 for now (the progress bar then reads
                // "0 / 500", and the CTA is "Begin writing").
                wordsToday={0}
                glimpse={glimpseFromPosts(posts)}
                onReturnHome={() => router.push('/')}
                onSignIn={() => router.push('/auth')}
                onEnableSync={() => router.push('/settings')}
                onStartWriting={() => router.push('/')}
              />
            </View>
          )}
        </AnimatePresence>
      </View>
    )
  }

  // ─── Full-feed mode ───────────────────────────────────────────────────────

  const isEmptyFull = allPosts.length === 0 && !feed.isLoading
  const letterCount = allPosts.length

  // ─── Ambient strip precedence: error > offline > empty ────────────────────
  // Only the highest-precedence strip renders to avoid cluttered UI when
  // multiple conditions coexist (e.g. error + offline + empty simultaneously).
  const showErrorStrip = feed.isError && feed.data !== undefined
  const showOfflineStrip = !showErrorStrip && !isOnline && feed.dataUpdatedAt > 0
  const showEmptyState = !showErrorStrip && isEmptyFull

  return (
    // key={mode} ensures clean re-mount on mode flip (preview ↔ full)
    // flex={1} + ScrollView: the feed owns its own scroll. On native there is no
    // ambient scroll around routed screens, so the (potentially long, paginated)
    // letter list would otherwise overflow the viewport with no way to reach the
    // footer or "Load more". Mirrors the locked screen's wrapper.
    <View key={mode} flex={1}>
      <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
        <AnimatePresence>
          {mounted && (
            <YStack
              key="collective-feed-body"
              transition="designEnter"
              enterStyle={{ opacity: 0, y: 10 }}
              opacity={1}
              y={0}
              width="100%"
              maxWidth={720}
              marginHorizontal="auto"
              paddingHorizontal="$5"
              paddingVertical="$8"
            >
              {/* ─── Room header ──────────────────────────────────────────────── */}
              <YStack marginBottom="$9">
                <Text
                  fontFamily="$body"
                  fontSize="$1"
                  color="$color9"
                  textTransform="uppercase"
                  letterSpacing={2}
                >
                  The Collective · {todayLong()}
                </Text>
                <Text
                  fontFamily="$journalItalic"
                  fontStyle="italic"
                  fontSize="$10"
                  lineHeight="$10"
                  color="$color12"
                  marginTop="$3"
                >
                  The room is open.
                </Text>
                <Text
                  fontFamily="$journal"
                  fontSize="$5"
                  color="$color10"
                  marginTop="$3"
                  maxWidth={460}
                >
                  You did the work today. So did everyone here. Read slowly; write back when
                  something moves you.
                </Text>
              </YStack>

              {/* ─── Compose + filter row ─────────────────────────────────────── */}
              <XStack
                justifyContent="space-between"
                alignItems="center"
                flexWrap="wrap"
                gap="$4"
                paddingBottom="$4"
                marginBottom="$7"
                borderBottomWidth={1}
                borderBottomColor="$color4"
              >
                <XStack
                  role="button"
                  aria-label="Write a letter"
                  onPress={() => router.push('/collective/compose')}
                  cursor="pointer"
                  alignItems="center"
                  gap="$3"
                  flexShrink={0}
                >
                  <PenLine size={20} color="$color12" />
                  <Text
                    fontFamily="$journalItalic"
                    fontStyle="italic"
                    fontSize="$7"
                    color="$color12"
                    numberOfLines={1}
                  >
                    Write a letter
                  </Text>
                </XStack>

                <XStack alignItems="center" gap="$5" flexShrink={0}>
                  <Text
                    fontFamily="$body"
                    fontSize="$1"
                    color="$color12"
                    textTransform="uppercase"
                    letterSpacing={1}
                  >
                    All letters
                  </Text>
                  <View
                    role="button"
                    aria-label="Your letters"
                    onPress={() => router.push('/collective/your-posts')}
                    cursor="pointer"
                  >
                    <Text
                      fontFamily="$body"
                      fontSize="$1"
                      color="$color9"
                      textTransform="uppercase"
                      letterSpacing={1}
                    >
                      Your letters
                    </Text>
                  </View>
                </XStack>
              </XStack>

              {/* Error with cached data — show refresh error strip (highest precedence) */}
              {showErrorStrip ? (
                <Text fontSize="$1" color="$color9" textAlign="center" paddingVertical="$2">
                  Couldn&apos;t refresh. Showing cached posts.
                </Text>
              ) : null}

              {/* Offline microcopy — only when error strip is not shown and timestamp is valid */}
              {showOfflineStrip ? (
                <Text fontSize="$1" color="$color9" paddingVertical="$2" textAlign="center">
                  Offline · last synced {formatTimeAgo(feed.dataUpdatedAt)}
                </Text>
              ) : null}

              {/* Suspended user microcopy */}
              {isSuspended === true ? (
                <Text fontSize="$2" color="$color11" textAlign="center" paddingVertical="$3">
                  Posting and reacting are paused for this account.
                </Text>
              ) : null}

              {/* Empty state */}
              {showEmptyState ? (
                <YStack paddingVertical="$8" gap="$5">
                  <Text fontFamily="$journal" fontSize="$7" color="$color10" fontStyle="italic">
                    Quiet here. Be the first.
                  </Text>
                  <ExpandingLineButton onPress={() => router.push('/collective/compose')}>
                    Compose
                  </ExpandingLineButton>
                </YStack>
              ) : null}

              {/* Post list — title-led rows */}
              {allPosts.map((post, index) => (
                <View key={post.id}>
                  <FeedPostRow
                    post={post}
                    currentUserId={currentUserId}
                    onOpen={(id) => router.push(`/collective/thread/${id}`)}
                  />
                  {index < allPosts.length - 1 ? (
                    <Separator borderColor="$color3" borderBottomWidth={1} />
                  ) : null}
                </View>
              ))}

              {/* Footer tally */}
              {!showEmptyState ? (
                <Text
                  fontFamily="$body"
                  fontSize="$1"
                  color="$color8"
                  textTransform="uppercase"
                  letterSpacing={2}
                  marginTop="$9"
                >
                  {letterCount} {letterCount === 1 ? 'letter' : 'letters'} in the room · access
                  resets at midnight
                </Text>
              ) : null}

              {/* Load more pagination trigger */}
              {feed.hasNextPage ? (
                <ExpandingLineButton
                  onPress={() => feed.fetchNextPage()}
                  disabled={feed.isFetchingNextPage}
                >
                  Load more
                </ExpandingLineButton>
              ) : null}
            </YStack>
          )}
        </AnimatePresence>
      </ScrollView>
    </View>
  )
}
