// packages/app/features/collective/PostRow.tsx
//
// Private helper shared by CollectiveFeedScreen and CollectivePreview.
// Boundary rule (D7): no Legend-State imports in this file.
//
// Renders a single post row with the correct deletion-state branching:
//   - is_user_deleted: shows [deleted] body + AuthorByline deletedDisplay, no ReactionStrip
//   - user_id === null (anon): shows original body + AuthorByline deletedDisplay, ReactionStrip preserved
//   - is_removed: caller should filter these out; PostRow renders nothing for safety
//   - normal: original body + AuthorByline, ReactionStrip

import { View, Text, XStack, AuthorByline } from '@my/ui'
import { ReactionStrip } from 'app/features/collective/ReactionStrip'
import { FlagAffordance } from './FlagAffordance'
import type { Post } from 'app/state/collective/feed'

export interface PostRowProps {
  post: Post
  currentUserId: string | null | undefined
  /** When true, reaction strip is disabled (preview mode or suspended user). */
  disabled?: boolean
}

export function PostRow({ post, currentUserId, disabled = false }: PostRowProps) {
  // Defensive guard — removed posts are filtered upstream, but protect here
  if (post.is_removed) return null

  // Deletion-state precedence: is_user_deleted wins when both flags coincide
  const isDeleted = post.is_user_deleted || post.user_id === null
  const selfDeleted = post.is_user_deleted === true

  // displayName placeholder from user_id slice; future story will JOIN profiles in the RPC
  const displayName = post.user_id?.slice(0, 8) ?? '[deleted]'

  // a11y label: truncated body for screen readers (not full body to avoid bloated announcement)
  const bodyPreview = post.body.slice(0, 80) + (post.body.length > 80 ? '…' : '')
  const a11yLabel = `${isDeleted ? '[deleted]' : displayName}, posted: ${bodyPreview}`

  return (
    <View
      tag="article"
      accessible
      accessibilityRole="article"
      accessibilityLabel={a11yLabel}
    >
      <XStack justifyContent="space-between" alignItems="center">
        <AuthorByline
          displayName={displayName}
          postedAt={post.created_at}
          tenureTier={undefined}
          deletedDisplay={isDeleted}
          flexShrink={1}
        />
        <FlagAffordance
          postId={post.id}
          reporterUserId={currentUserId ?? null}
          canSelfDelete={post.user_id === currentUserId && post.is_user_deleted === false}
          canReport={post.user_id !== currentUserId && post.is_user_deleted === false && post.user_id !== null}
        />
      </XStack>
      {/* For self-deleted posts, body is the literal '[deleted]' — AuthorByline already
          communicates this. Render body only for non-self-deleted posts to avoid duplicate
          '[deleted]' text nodes that confuse a11y queries. */}
      {!selfDeleted ? (
        <Text fontFamily="$journal" fontSize="$4">
          {post.body}
        </Text>
      ) : null}
      {/* ReactionStrip: NOT rendered for self-deleted posts */}
      {!selfDeleted && currentUserId !== undefined ? (
        <ReactionStrip
          postId={post.id}
          userId={currentUserId ?? null}
          disabled={disabled}
        />
      ) : null}
    </View>
  )
}
