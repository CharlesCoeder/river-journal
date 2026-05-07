// packages/app/features/collective/YourPostRow.tsx
//
// Private row component for YourPostsScreen.
// Renders a single own-post with self-deletion state branching.
//
// Diverges from PostRow intentionally:
//   - No FlagAffordance (AC #14: no re-interaction surface)
//   - No ReactionStrip (AC #14: record view, not action surface)
//   - Adds self-deletion date marker (AC #11)
//   - Shows aggregated engagement counts (AC #12)
//   - Self-deleted rows show replies-only count (AC #12)
//
// Boundary rule (D7): no Legend-State imports in this file.
// features/collective/** MUST NOT import Legend-State or app/state/store.

import { View, Text, XStack, AuthorByline, Pressable } from '@my/ui'
import { useRouter } from 'solito/router'
import type { YourPost } from 'app/state/collective/yourPosts'

interface YourPostRowProps {
  post: YourPost
  currentUserId: string | null | undefined
}

export function YourPostRow({ post }: YourPostRowProps) {
  const router = useRouter()

  const displayName = post.user_id?.slice(0, 8) ?? '[deleted]'

  // a11y label: truncated body for screen readers
  const bodyPreview = post.body.slice(0, 80) + (post.body.length > 80 ? '…' : '')
  const a11yLabel = `${post.is_user_deleted ? '[deleted]' : displayName}, posted: ${bodyPreview}`

  // Format deletion date as "Month Day, Year" (e.g. "May 7, 2026")
  const deletionDateDisplay =
    post.is_user_deleted && post.user_deleted_at !== null
      ? new Date(post.user_deleted_at).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : null

  function handlePress() {
    router.push('/collective/thread/' + post.id)
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="link"
      accessibilityLabel={`Open thread for: ${bodyPreview}`}
      data-testid="pressable-wrapper"
    >
      <View
        tag="article"
        accessible
        accessibilityRole="article"
        accessibilityLabel={a11yLabel}
      >
        <XStack justifyContent="space-between" alignItems="center">
          {/* Wrap AuthorByline in View for flexShrink — AuthorBylineProps does not extend ViewProps
              and does not accept flexShrink directly (AC #8). */}
          <View flexShrink={1}>
            <AuthorByline
              displayName={displayName}
              postedAt={post.created_at}
              tenureTier={post.tenure_tier ?? undefined}
              deletedDisplay={post.is_user_deleted}
            />
          </View>
          {/* NO FlagAffordance — AC #14: this is a record view, not an action surface */}
        </XStack>

        {/* Body area: match on is_user_deleted flag, NOT body string (AC #10)
            For self-deleted posts, AuthorByline already renders [deleted] via
            deletedDisplay prop (the "header" slot). We do NOT render a separate
            [deleted] body Text here to avoid duplicate text nodes that confuse
            a11y queries — this mirrors PostRow.tsx:63-68 exactly.
            The deletion-date marker below communicates the body area deletion state. */}
        {!post.is_user_deleted ? (
          <Text fontFamily="$journal" fontSize="$4">
            {post.body}
          </Text>
        ) : null}

        {/* Self-deletion date marker: only when user_deleted_at is non-null (AC #11) */}
        {post.is_user_deleted && deletionDateDisplay !== null ? (
          <Text fontSize="$1" color="$color9">
            you deleted this on {deletionDateDisplay}
          </Text>
        ) : null}

        {/* Engagement metadata row (AC #12)
            - Self-deleted: suppresses reaction count (reactions deleted transactionally per Story 3-1),
              shows replies-only count (replies survive self-delete per Reddit pattern).
              AC #37: stale reaction_count post-delete is masked by this suppression branch —
              the optimistic update in useDeleteOwnPost does NOT decrement reaction_count,
              but it is invisible because this branch only renders reply count.
            - Non-deleted: show both reaction count and reply count (zeroes rendered — record view). */}
        {post.is_user_deleted ? (
          <XStack gap="$2">
            <Text fontSize="$1" color="$color9">
              {post.descendant_count} {post.descendant_count === 1 ? 'reply' : 'replies'}
            </Text>
          </XStack>
        ) : (
          <XStack gap="$2">
            <Text fontSize="$1" color="$color9">
              {post.reaction_count} {post.reaction_count === 1 ? 'reaction' : 'reactions'}
            </Text>
            <Text fontSize="$1" color="$color9">
              {post.descendant_count} {post.descendant_count === 1 ? 'reply' : 'replies'}
            </Text>
          </XStack>
        )}
      </View>
    </Pressable>
  )
}
