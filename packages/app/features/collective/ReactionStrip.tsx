// packages/app/features/collective/ReactionStrip.tsx
//
// Cross-platform reaction strip for collective posts.
// Boundary rule (D7): MUST NOT import the Legend-State package.
//
// Props: { postId, userId, disabled? }
// Returns null when userId is null (anonymous viewer).

import { XStack, View, Text, useReducedMotion } from '@my/ui'
import { Heart, Sparkles, Flame, Leaf, Waves } from '@tamagui/lucide-icons'
import { useToggleReaction } from 'app/state/collective/mutations'
import { usePostReactions } from 'app/state/collective/reactions'
import type { ReactionKind } from 'app/state/collective/types'
import { generateUUID } from 'app/utils/uuid'

// ─── Icon registry ────────────────────────────────────────────────────────────

type ReactionDef = {
  kind: ReactionKind
  Icon: React.ComponentType<{ size?: number; color?: string }>
  label: string
}

const REACTIONS: ReactionDef[] = [
  { kind: 'heart', Icon: Heart, label: 'Heart' },
  { kind: 'sparkle', Icon: Sparkles, label: 'Sparkles' },
  { kind: 'flame', Icon: Flame, label: 'Flame' },
  { kind: 'leaf', Icon: Leaf, label: 'Leaf' },
  { kind: 'wave', Icon: Waves, label: 'Waves' },
]

// ─── Empty/default cache shape ────────────────────────────────────────────────

const EMPTY_COUNTS: Record<ReactionKind, number> = {
  heart: 0,
  sparkle: 0,
  flame: 0,
  leaf: 0,
  wave: 0,
}

const EMPTY_USER_REACTIONS: Record<ReactionKind, string | null> = {
  heart: null,
  sparkle: null,
  flame: null,
  leaf: null,
  wave: null,
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ReactionStripProps {
  postId: string
  userId: string | null
  /** When true, strip is visible but non-interactive (for preview / sub-500 mode). */
  disabled?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ReactionStrip({ postId, userId, disabled = false }: ReactionStripProps) {
  // Hooks must be called unconditionally (Rules of Hooks).
  // The null-userId guard is applied AFTER all hooks.
  const { data } = usePostReactions(postId, userId ?? '')
  const { mutate } = useToggleReaction()
  const reduceMotion = useReducedMotion()

  // Hide entirely from anonymous viewers
  if (userId === null) return null

  // Cold-cache (data undefined during loading) — fall back to all-zero / all-null
  const counts = data?.counts ?? EMPTY_COUNTS
  const userReactions = data?.userReactions ?? EMPTY_USER_REACTIONS

  // Tint transition: 'quick' token unless reduced motion is active
  const tintTransition = reduceMotion ? undefined : 'quick'

  function handlePress(kind: ReactionKind) {
    if (disabled) return

    const existingId = userReactions[kind]
    if (existingId !== null) {
      // toggle: remove
      mutate({ id: existingId, post_id: postId, kind, user_id: userId!, toggle: 'remove' })
    } else {
      // toggle: add -- generate UUID at call time (per ID GENERATION discipline)
      mutate({ id: generateUUID(), post_id: postId, kind, user_id: userId!, toggle: 'add' })
    }
  }

  return (
    <XStack gap="$2" role="group" aria-label="Reactions">
      {REACTIONS.map(({ kind, Icon, label }) => {
        const isReacted = userReactions[kind] !== null
        const count = counts[kind] ?? 0
        const iconColor = isReacted ? '$color12' : '$color9'

        return (
          <View
            key={kind}
            tag="button"
            role="button"
            aria-pressed={isReacted}
            aria-label={`${label} reaction (${count})`}
            aria-disabled={disabled || undefined}
            width="$4"
            height="$4"
            alignItems="center"
            justifyContent="center"
            flexDirection="row"
            gap="$1"
            backgroundColor="transparent"
            borderWidth={0}
            padding={0}
            cursor={disabled ? 'not-allowed' : 'pointer'}
            opacity={disabled ? 0.4 : 1}
            transition={tintTransition as any}
            focusVisibleStyle={{
              outlineWidth: 1,
              outlineColor: '$color12',
              outlineStyle: 'solid',
            }}
            onPress={disabled ? undefined : () => handlePress(kind)}
            onKeyDown={
              disabled
                ? undefined
                : (e: any) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault()
                      handlePress(kind)
                    }
                  }
            }
          >
            <Icon size={16} color={iconColor} />
            {count > 0 ? (
              <Text fontSize="$1" color="$color9">
                {count}
              </Text>
            ) : null}
          </View>
        )
      })}
    </XStack>
  )
}
