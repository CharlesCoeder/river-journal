// packages/app/features/collective/CollectiveFeedScreen.tsx
//
// Defense-in-depth: NEVER read store$.streak.* for mode dispatch —
// feed.data.pages[0].mode is the SOLE source of truth (server has already
// returned the correct shape). Local streak state may lag or be tampered with.
//
// Boundary rule (D7): no Legend-State imports in this file.
// features/collective/** MUST NOT import Legend-State or app/state/store.

import { useMemo } from 'react'
import { YStack, View, Text, Separator, ExpandingLineButton, useReducedMotion } from '@my/ui'
import { onlineManager } from '@tanstack/react-query'
import { useFeed } from 'app/state/collective/feed'
import { useIsSuspended } from 'app/state/collective/suspension'
import { useCurrentUserId } from 'app/state/collective/currentUser'
import { useLocallyHiddenPostIds } from 'app/state/collective/locallyHidden'
import { CollectivePreview } from 'app/features/collective/CollectivePreview'
import { PostRow } from 'app/features/collective/PostRow'
import { useRouter } from 'solito/navigation'
import { SkeletonRows, formatTimeAgo } from './_shared'

// ─── Component ────────────────────────────────────────────────────────────────

export default function CollectiveFeedScreen() {
  // All hooks must be called unconditionally before any early returns (Rules of Hooks)
  const feed = useFeed()
  const currentUserId = useCurrentUserId()
  const isSuspended = useIsSuspended(currentUserId ?? null)
  const reducedMotion = useReducedMotion()
  const router = useRouter()
  const hiddenIds = useLocallyHiddenPostIds()

  // Flatten pages, apply defensive is_removed filter, then apply local-hide
  // filter. is_removed runs first (global moderation override); local-hide
  // runs second (user preference).
  const allPosts = useMemo(() => {
    const flat = feed.data?.pages.flatMap((p) => p.items) ?? []
    return flat
      .filter((p) => !p.is_removed)
      .filter((p) => !hiddenIds.has(p.id))
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
        <ExpandingLineButton onPress={() => feed.refetch()}>
          Retry
        </ExpandingLineButton>
      </YStack>
    )
  }

  // ─── Mode dispatch ────────────────────────────────────────────────────────
  // Defense-in-depth: trust RPC mode, never local streak state.
  const mode = feed.data?.pages[0]?.mode

  // ─── Preview mode ─────────────────────────────────────────────────────────
  if (mode === 'preview') {
    const posts = feed.data?.pages[0]?.items ?? []
    return (
      // key={mode} ensures clean re-mount on mode flip (preview ↔ full)
      <View key={mode}>
        <CollectivePreview posts={posts} currentUserId={currentUserId} />
      </View>
    )
  }

  // ─── Full-feed mode ───────────────────────────────────────────────────────

  const isEmptyFull = allPosts.length === 0 && !feed.isLoading

  // ─── Ambient strip precedence: error > offline > empty ────────────────────
  // Only the highest-precedence strip renders to avoid cluttered UI when
  // multiple conditions coexist (e.g. error + offline + empty simultaneously).
  const showErrorStrip = feed.isError && feed.data !== undefined
  const showOfflineStrip = !showErrorStrip && !isOnline && feed.dataUpdatedAt > 0
  const showEmptyState = !showErrorStrip && isEmptyFull

  return (
    // key={mode} ensures clean re-mount on mode flip (preview ↔ full)
    <View key={mode}>
      <YStack width="100%" maxWidth={720} marginHorizontal="auto">
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
          <YStack>
            <Text
              fontSize="$5"
              color="$color11"
              textAlign="center"
              marginTop="$8"
            >
              Quiet here. Be the first.
            </Text>
            <ExpandingLineButton onPress={() => router.push('/collective/compose')}>
              Compose
            </ExpandingLineButton>
          </YStack>
        ) : null}

        {/* Post list */}
        {allPosts.map((post, index) => (
          <View key={post.id}>
            <PostRow
              post={post}
              currentUserId={currentUserId}
              disabled={isSuspended === true}
            />
            {index < allPosts.length - 1 ? (
              <Separator borderColor="$color3" borderBottomWidth={1} />
            ) : null}
          </View>
        ))}

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
    </View>
  )
}
