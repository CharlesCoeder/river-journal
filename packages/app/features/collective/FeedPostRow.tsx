// packages/app/features/collective/FeedPostRow.tsx
//
// Title-led feed row for the Collective "room" (title-led redesign, Story 3-16).
// Boundary rule (D7): no Legend-State imports in this file.
//
// The feed is a scannable list of letter TITLES — not bodies. The feed RPC
// (collective_feed_page) no longer returns a full `body`; it returns `title`,
// a server-truncated `excerpt`, `descendant_count`, and a per-kind `reactions`
// tally. This row renders the title as the lead, a metadata line
// (author · time · reply count), and a READ-ONLY reaction tally (the live,
// interactive reaction set lives inside the thread, per the design). Tapping
// the row opens the thread.
//
// Identity divergence (architecture §9 / D7): the design mocks show pen names
// ("wren", "tomas"); the real RPC returns only `user_id` + `tenure_tier`. We
// render the interim `user_id` slice the rest of the surface uses. Pen names
// are a separate future identity milestone — NOT faked here.
//
// Deletion-state branching mirrors PostRow:
//   - is_user_deleted  → quiet "withdrawn" placeholder, no reaction tally
//   - user_id === null → title + "[deleted]" author + reaction tally (anonymized)
//   - is_removed       → caller filters these; render nothing for safety
//   - normal           → title + author byline + reaction tally

import { View, Text, XStack } from '@my/ui'
import { Heart, Sparkles, Flame, Leaf, Waves, ArrowRight } from '@tamagui/lucide-icons'
import type { Post } from 'app/state/collective/feed'
import type { ReactionKind } from 'app/state/collective/types'
import { timeAgoCasual } from './_shared'

// ─── Read-only reaction tally ─────────────────────────────────────────────────
// The locked five-icon set, in display order. Mirrors ReactionStrip's registry
// but renders a non-interactive echo (icon + count) for kinds that have any
// reactions — a quiet thread reads as quiet.

const REACTION_ORDER: { kind: ReactionKind; Icon: typeof Heart }[] = [
  { kind: 'heart', Icon: Heart },
  { kind: 'sparkle', Icon: Sparkles },
  { kind: 'flame', Icon: Flame },
  { kind: 'leaf', Icon: Leaf },
  { kind: 'wave', Icon: Waves },
]

function ReactionTally({ reactions }: { reactions: { [key: string]: number } }) {
  const shown = REACTION_ORDER.filter(({ kind }) => (reactions[kind] ?? 0) > 0)
  if (shown.length === 0) return null
  return (
    <XStack
      gap="$3"
      alignItems="center"
      role="group"
      aria-label="Reaction tally"
    >
      {shown.map(({ kind, Icon }) => (
        <XStack
          key={kind}
          gap="$1"
          alignItems="center"
        >
          <Icon
            size={13}
            color="$color9"
          />
          <Text
            fontSize="$1"
            color="$color9"
          >
            {reactions[kind]}
          </Text>
        </XStack>
      ))}
    </XStack>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface FeedPostRowProps {
  post: Post
  currentUserId: string | null | undefined
  /** Opens the thread for this post. Wired by the feed screen to the router. */
  onOpen?: (postId: string) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FeedPostRow({ post, currentUserId, onOpen }: FeedPostRowProps) {
  // Defensive guard — removed posts are filtered upstream, protect here too.
  if (post.is_removed) return null

  // Deletion-state precedence: is_user_deleted wins when both coincide.
  const isDeleted = post.is_user_deleted || post.user_id === null
  const selfDeleted = post.is_user_deleted === true

  const mine = post.user_id != null && post.user_id === currentUserId
  // Interim identity: user_id slice. A future identity milestone supplies a
  // friendlier name; until then "You" for your own letters, the slice otherwise.
  const displayName = isDeleted
    ? '[deleted]'
    : mine
      ? 'You'
      : (post.user_id?.slice(0, 8) ?? '[deleted]')

  // a11y label mirrors PostRow's discipline: deleted rows announce ONLY
  // '[deleted]' so the screen reader never carries withdrawn body text; normal
  // rows announce the title + excerpt for context.
  const excerpt = post.excerpt ?? ''
  const a11yLabel = isDeleted
    ? '[deleted]'
    : `${post.title ?? 'Untitled'}, by ${displayName}: ${excerpt.slice(0, 80)}`

  const replies = post.descendant_count ?? 0
  const replyLabel = `${replies} ${replies === 1 ? 'reply' : 'replies'}`

  // ─── Withdrawn placeholder ──────────────────────────────────────────────────
  if (selfDeleted) {
    return (
      <View
        tag="article"
        role="article"
        aria-label={a11yLabel}
        paddingVertical="$5"
      >
        <Text
          fontFamily="$journal"
          fontSize="$5"
          color="$color8"
          fontStyle="italic"
        >
          This letter was withdrawn.
        </Text>
      </View>
    )
  }

  // ─── Title-led row ──────────────────────────────────────────────────────────
  return (
    <View
      tag="article"
      role="article"
      aria-label={a11yLabel}
      onPress={onOpen ? () => onOpen(post.id) : undefined}
      cursor={onOpen ? 'pointer' : undefined}
      paddingVertical="$5"
      group
    >
      <XStack
        justifyContent="space-between"
        alignItems="flex-start"
        gap="$4"
      >
        <Text
          tag="h2"
          fontFamily="$journal"
          fontSize="$8"
          lineHeight="$8"
          color="$color12"
          flexShrink={1}
        >
          {post.title ?? 'Untitled'}
        </Text>
        <View
          opacity={0}
          $group-hover={{ opacity: 1 }}
          marginTop="$2"
        >
          <ArrowRight
            size={20}
            color="$color9"
          />
        </View>
      </XStack>

      <XStack
        justifyContent="space-between"
        alignItems="center"
        gap="$4"
        marginTop="$3"
        flexWrap="wrap"
      >
        <Text
          fontFamily="$body"
          fontSize="$1"
          color="$color9"
          textTransform="uppercase"
          letterSpacing={1}
        >
          {displayName}
          {'  ·  '}
          {timeAgoCasual(post.created_at)}
          {'  ·  '}
          {replyLabel}
        </Text>
        <ReactionTally reactions={post.reactions ?? {}} />
      </XStack>
    </View>
  )
}

export default FeedPostRow
