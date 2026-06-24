// packages/app/features/collective/CollectivePreview.tsx
//
// Boundary rule (D7): no Legend-State imports in this file.
//
// The locked / preview surface (title-led redesign, Story 3-16), shown when the
// feed RPC returns mode: 'preview' for a sub-500 user. Mirrors the design's
// CollectiveLocked: a calm invitation, not a nag — a lock eyebrow, the headline,
// the "earn the room each morning" copy, a "Begin writing" door, and a blurred
// "glimpse inside" of the room's recent letter TITLES.
//
// Story 3-16 follow-up #3: the featured rows lost their full body (architecture
// D5) but were never updated to render the new lead field. Render `title` (and
// `excerpt`) so the glimpse has a lead. Preview rows carry title + excerpt +
// metadata only — never a full body — so we never try to show one here.

import { YStack, XStack, View, Text } from '@my/ui'
import { Lock, ArrowRight } from '@tamagui/lucide-icons'
import { useRouter } from 'solito/navigation'
import type { Post } from 'app/state/collective/feed'

export interface CollectivePreviewProps {
  posts: Post[]
  currentUserId: string | null | undefined
}

export function CollectivePreview({ posts }: CollectivePreviewProps) {
  const router = useRouter()

  function handleBeginWriting() {
    // Mobile home is '/'; web/desktop may route to '/journal'.
    // Using '/' uniformly per corrected routing decision.
    router.push('/')
  }

  const glimpse = posts.slice(0, 3)

  return (
    <YStack
      maxWidth={720}
      width="100%"
      marginHorizontal="auto"
      paddingHorizontal="$5"
      paddingVertical="$8"
    >
      {/* The invitation */}
      <YStack
        maxWidth={520}
        gap="$4"
      >
        <XStack
          alignItems="center"
          gap="$2"
        >
          <Lock
            size={14}
            color="$color9"
          />
          <Text
            fontFamily="$body"
            fontSize="$1"
            color="$color9"
            textTransform="uppercase"
            letterSpacing={2}
          >
            The Collective
          </Text>
        </XStack>

        <Text
          fontFamily="$journal"
          fontSize="$10"
          lineHeight="$10"
          color="$color12"
        >
          A quiet room, just through here.
        </Text>

        <Text
          fontFamily="$journal"
          fontSize="$5"
          color="$color10"
        >
          Everyone inside has written 500 words of their own today. Write yours, and the door opens
          — not owned, but earned, each morning anew.
        </Text>

        {/* Gate microcopy — kept explicit so the threshold is unmistakable. */}
        <Text
          fontFamily="$body"
          fontSize="$2"
          color="$color9"
        >
          Write 500 today to join the conversation.
        </Text>

        {/* The single door — go write. */}
        <View
          role="button"
          aria-label="Begin writing"
          onPress={handleBeginWriting}
          cursor="pointer"
          marginTop="$4"
        >
          <XStack
            alignItems="center"
            gap="$3"
          >
            <Text
              fontFamily="$journalItalic"
              fontStyle="italic"
              fontSize="$8"
              color="$color12"
            >
              Begin writing
            </Text>
            <ArrowRight
              size={22}
              color="$color12"
            />
          </XStack>
        </View>
      </YStack>

      {/* A glimpse of the room, behind the glass — recent letter titles, blurred. */}
      {glimpse.length > 0 ? (
        <YStack
          marginTop="$10"
          gap="$6"
        >
          <Text
            fontFamily="$body"
            fontSize="$1"
            color="$color8"
            textTransform="uppercase"
            letterSpacing={2}
          >
            A glimpse inside
          </Text>
          <YStack
            gap="$6"
            opacity={0.45}
            pointerEvents="none"
            // Web-only soft veil; native ignores `filter` (acceptable divergence).
            style={{ filter: 'blur(1.3px)' }}
          >
            {glimpse.map((post) => (
              <YStack
                key={post.id}
                gap="$2"
              >
                <Text
                  fontFamily="$journal"
                  fontSize="$7"
                  lineHeight="$7"
                  color="$color12"
                >
                  {post.title ?? 'Untitled'}
                </Text>
                <Text
                  fontFamily="$journal"
                  fontSize="$3"
                  color="$color9"
                  numberOfLines={1}
                >
                  {post.excerpt}
                </Text>
              </YStack>
            ))}
          </YStack>
        </YStack>
      ) : null}
    </YStack>
  )
}

export default CollectivePreview
