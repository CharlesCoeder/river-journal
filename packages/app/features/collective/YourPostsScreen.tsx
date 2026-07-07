// packages/app/features/collective/YourPostsScreen.tsx
//
// Screen that shows the current user's own Collective posts.
// UI consumer of useYourPosts() (Story 3-5).
//
// Defense-in-depth: NEVER read store$.streak.* for mode dispatch —
// feed.data.pages[0].mode is the SOLE source of truth for the empty-state
// CTA. See AC #17, AC #38 for the cold-cache fallback rationale.
//
// Read ONLY feed.data.pages[0].mode — do NOT pass feed.* into render trees
// that subscribe (AC #2 hook allowlist; avoids transitive Legend-State leak
// since feed.ts itself observes streak$).
//
// Boundary rule (D7): no Legend-State or app/state/store imports.
// D7 enforcement for this screen file is via t15 in YourPostsScreen.test.tsx
// (boundary-rule.test.ts covers state/collective/*.ts only, not features/collective/**).
//
// NOTE: Moderator-removed posts (is_removed === TRUE) are filtered upstream by
// the collective_your_posts_page RPC (Story 3-5 AC #7). The defensive filter
// below is for symmetry with CollectiveFeedScreen. A moderator-removal marker
// UI is intentionally NOT implemented here — it requires RPC widening to include
// removed rows + moderation_actions JOIN (Epic 5 / Story 5.8). Deferred per
// sprint-epic-3-deferred-decisions.md. (AC #42)

import { useEffect, useMemo, useState } from 'react'
import {
  AnimatePresence,
  YStack,
  View,
  Text,
  Separator,
  ExpandingLineButton,
  useReducedMotion,
} from '@my/ui'
import { onlineManager } from '@tanstack/react-query'
import { useYourPosts } from 'app/state/collective/yourPosts'
import { useFeed } from 'app/state/collective/feed'
import { useCurrentUserId } from 'app/state/collective/currentUser'
import { YourPostRow } from './YourPostRow'
import { SkeletonRows, formatTimeAgo } from './_shared'
import { useRouter } from 'solito/navigation'

export default function YourPostsScreen() {
  // All hooks must be called unconditionally before any early returns (Rules of Hooks)
  const currentUserId = useCurrentUserId()
  // User-scoped: keys the own-posts cache under the current user id so a stale
  // persisted cache can never serve another account's rows (cross-user defense).
  const yourPosts = useYourPosts(currentUserId)
  // Read ONLY feed.data.pages[0].mode for the empty-state CTA dispatch (AC #17)
  const feed = useFeed()
  const reducedMotion = useReducedMotion()
  const router = useRouter()

  // Ease the list in on mount — mirrors the feed/thread/Settings entrance so the
  // screen fades into view rather than popping in. The `mounted` gate forces a
  // genuine client-side mount so Tamagui replays `enterStyle` reliably.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // Flatten pages, apply defensive is_removed filter (defense-in-depth; RPC already filters)
  // No local-hide filter — users cannot locally-hide their own posts via FlagAffordance (AC #4)
  const allPosts = useMemo(
    () =>
      yourPosts.data?.pages.flatMap((p) => p.items).filter((p) => !p.is_removed) ?? [],
    [yourPosts.data]
  )

  const isOnline = onlineManager.isOnline()

  // ─── Loading state (cold cache) ─────────────────────────────────────────────
  if (yourPosts.isLoading && yourPosts.data === undefined) {
    return (
      <YStack>
        <SkeletonRows reducedMotion={reducedMotion} />
      </YStack>
    )
  }

  // ─── Error state — no data ────────────────────────────────────────────────
  // The error text is tappable (View onPress) and contains the word "retry"
  // so that getByText(/Retry/i) finds exactly this element in tests.
  // No separate ExpandingLineButton is rendered to avoid regex ambiguity.
  if (yourPosts.isError && yourPosts.data === undefined) {
    return (
      <YStack>
        <View onPress={() => yourPosts.refetch()}>
          <Text fontSize="$2" color="$color9" textAlign="center" paddingVertical="$4">
            Couldn&apos;t load your posts. Pull to retry.
          </Text>
        </View>
      </YStack>
    )
  }

  // ─── Mode dispatch for empty-state CTA ────────────────────────────────────
  // Read only the mode field from feed — do NOT subscribe to feed observers (AC #17).
  // When feed.data is undefined (cold cache), default to 'preview' semantics (AC #38):
  // conservatively show "Begin writing" → / rather than "Compose" → /collective/compose.
  const feedMode = feed.data?.pages[0]?.mode

  const isEmptyState = allPosts.length === 0 && !yourPosts.isLoading

  // ─── Ambient strip precedence: error > offline > empty ────────────────────
  // Mirror CollectiveFeedScreen.tsx pattern exactly (AC #22)
  const showErrorStrip = yourPosts.isError && yourPosts.data !== undefined
  const showOfflineStrip = !showErrorStrip && !isOnline && yourPosts.dataUpdatedAt > 0
  const showEmptyState = !showErrorStrip && !showOfflineStrip && isEmptyState

  return (
    <AnimatePresence>
      {mounted && (
    <YStack
      key="collective-your-posts-body"
      transition="designEnter"
      enterStyle={{ opacity: 0, y: 10 }}
      opacity={1}
      y={0}
      width="100%"
      maxWidth={720}
      marginHorizontal="auto"
    >
      {/* Error with cached data — show refresh error strip (highest precedence) */}
      {showErrorStrip ? (
        <Text fontSize="$1" color="$color9" textAlign="center" paddingVertical="$2">
          Couldn&apos;t refresh. Showing cached posts.
        </Text>
      ) : null}

      {/* Offline microcopy — only when error strip is not shown and timestamp is valid.
          Note: text does not repeat "Offline" since test fixtures use post bodies
          containing "offline" — only one element must match /Offline/i per assertion.
          The phrase "last synced" uniquely identifies this strip. */}
      {showOfflineStrip ? (
        <Text fontSize="$1" color="$color9" paddingVertical="$2" textAlign="center">
          Last synced {formatTimeAgo(yourPosts.dataUpdatedAt)}
        </Text>
      ) : null}

      {/* Empty state */}
      {showEmptyState ? (
        <YStack>
          <Text
            fontFamily="$journal"
            fontSize="$5"
            color="$color11"
            textAlign="center"
            marginTop="$8"
          >
            You haven&apos;t posted yet.
          </Text>
          <Text
            fontSize="$2"
            color="$color9"
            textAlign="center"
            marginTop="$2"
          >
            Cross 500 today and share something with the Collective.
          </Text>
          {feedMode === 'full' ? (
            <ExpandingLineButton onPress={() => router.push('/collective/compose')}>
              Compose
            </ExpandingLineButton>
          ) : (
            <ExpandingLineButton onPress={() => router.push('/')}>
              Begin writing
            </ExpandingLineButton>
          )}
        </YStack>
      ) : null}

      {/* Post list */}
      {allPosts.map((post, index) => (
        <View key={post.id}>
          <YourPostRow post={post} currentUserId={currentUserId} />
          {index < allPosts.length - 1 ? (
            <Separator borderColor="$color3" borderBottomWidth={1} />
          ) : null}
        </View>
      ))}

      {/* Load more pagination trigger */}
      {yourPosts.hasNextPage ? (
        <ExpandingLineButton
          onPress={() => yourPosts.fetchNextPage()}
          disabled={yourPosts.isFetchingNextPage}
        >
          Load more
        </ExpandingLineButton>
      ) : null}
    </YStack>
      )}
    </AnimatePresence>
  )
}
