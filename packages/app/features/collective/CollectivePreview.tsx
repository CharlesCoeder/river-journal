// packages/app/features/collective/CollectivePreview.tsx
//
// Boundary rule (D7): no Legend-State imports in this file.
//
// Preview surface shown to sub-500 users. Renders:
//   - Inline gating message
//   - Most-recent post (with ReactionStrip disabled)
//   - Up to 3 teasers (single-line, truncated)
//   - "Begin writing" CTA

import { YStack, Text, ExpandingLineButton } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { PostRow } from 'app/features/collective/PostRow'
import type { Post } from 'app/state/collective/feed'

export interface CollectivePreviewProps {
  posts: Post[]
  currentUserId: string | null | undefined
}

export function CollectivePreview({ posts, currentUserId }: CollectivePreviewProps) {
  const router = useRouter()

  const [mostRecent, ...teasers] = posts

  function handleBeginWriting() {
    // Mobile home is '/'; web/desktop may route to '/journal'.
    // Using '/' uniformly per corrected routing decision.
    router.push('/')
  }

  return (
    <YStack>
      {/* Inline gating message */}
      <Text
        fontSize="$3"
        color="$color11"
        textAlign="center"
        paddingVertical="$4"
      >
        Write 500 today to join the conversation.
      </Text>

      {/* Most-recent post — guard against empty posts array */}
      {mostRecent ? (
        <PostRow
          post={mostRecent}
          currentUserId={currentUserId}
          disabled={true}
        />
      ) : null}

      {/* Up to 3 teasers — only render block if teasers exist */}
      {teasers.length > 0 ? (
        <YStack>
          <Text
            fontSize="$1"
            color="$color9"
            textTransform="uppercase"
          >
            Other recent posts
          </Text>
          {teasers.slice(0, 3).map((teaser) => (
            <Text key={teaser.id} fontSize="$1" color="$color9" numberOfLines={1}>
              {teaser.body}
            </Text>
          ))}
        </YStack>
      ) : null}

      {/* Begin writing CTA */}
      <ExpandingLineButton onPress={handleBeginWriting}>
        Begin writing
      </ExpandingLineButton>
    </YStack>
  )
}

export default CollectivePreview
