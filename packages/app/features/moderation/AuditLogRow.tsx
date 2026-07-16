// packages/app/features/moderation/AuditLogRow.tsx
//
// A single audit-log row: the humanized action type, actor, target linkout
// label, reason, optional note, and timestamp — plus an expand-to-detail
// toggle that opens an in-place panel showing the referenced post's CURRENT
// state and the target's full moderation history. Reuses the Collective-feed
// styling (dense, no card borders); the row divider is drawn by the screen.
//
// Boundary rule (D7): no Legend-State imports in this file. Platform-agnostic
// (no expo-*/react-native-mmkv/Tauri/Node imports) so web + desktop render
// identically.
//
// Honesty guards (do not mislead the operator):
//   - The row copy is PAST TENSE ("Removed post"), a point-in-time fact; the
//     panel's post-detail + history is what reconciles it against current state.
//   - The history is TARGET-KEYED, not entity-graph-complete — a post's history
//     does not surface author-level suspensions — so it is labelled as this
//     post's / user's actions, not a blanket "everything about this author".
//   - The tapped row's own action shares the target, so it appears in the
//     rendered history (same table, same filter) — never filtered out.
//
// Privacy invariant: reason/note are rendered in the UI only and NEVER passed to any logger.
//
// The panel hooks are called at the ROW level (always, never conditionally) and
// gated via their `enabled` flag on `expanded` — so React's hook order is
// stable and a collapsed row issues no fetch.

import { useState } from 'react'
import { View, Text, XStack, YStack } from '@my/ui'
import type { AuditLogItem } from 'app/state/collective/auditLog'
import { usePostAdminDetail, useTargetModerationHistory } from 'app/state/collective/auditLog'
import { timeAgoCasual } from 'app/features/collective/_shared'

export interface AuditLogRowProps {
  item: AuditLogItem
  currentUserId: string | null | undefined
}

// Humanized action-type labels. The column is a TEXT CHECK today; fall back to
// the raw code for any unknown value so the row stays total.
const ACTION_LABELS: Record<string, string> = {
  remove_post: 'Removed post',
  suspend_user: 'Suspended user',
  add_note: 'Added note',
  reinstate: 'Reinstated post',
}

function actionLabel(actionType: string): string {
  return ACTION_LABELS[actionType] ?? actionType
}

const stop = (e?: { stopPropagation?: () => void }) => e?.stopPropagation?.()

export function AuditLogRow({ item, currentUserId }: AuditLogRowProps) {
  const [expanded, setExpanded] = useState(false)

  // Target linkout: whichever target id is set (post preferred), sliced. When
  // BOTH are null (an add_note with neither target), render a neutral "—" and
  // offer NO expand toggle — never `.slice` an undefined.
  const hasTarget = item.target_post_id != null || item.target_user_id != null
  const hasPost = item.target_post_id != null

  // Panel hooks — always called (stable hook order); `enabled` gates the fetch
  // on `expanded` so a collapsed row issues nothing.
  const {
    data: detail,
    isLoading: detailLoading,
    isError: detailError,
  } = usePostAdminDetail(item.target_post_id, expanded)

  const {
    data: history,
    isLoading: historyLoading,
    isError: historyError,
  } = useTargetModerationHistory({
    targetPostId: item.target_post_id,
    targetUserId: item.target_user_id,
    enabled: expanded,
  })

  // Actor: null → deleted moderator; own id → "You"; else the anonymized slice.
  const actorLabel =
    item.actor_user_id == null
      ? '[deleted moderator]'
      : item.actor_user_id === currentUserId
        ? 'You'
        : item.actor_user_id.slice(0, 8)

  const targetLabel = hasTarget ? (item.target_post_id ?? item.target_user_id)!.slice(0, 8) : '—'

  // Deletion-state precedence for the post block: is_user_deleted (content
  // self-delete) WINS over author_user_id === null (account deletion).
  const selfDeleted = detail?.is_user_deleted === true
  const accountDeleted = detail?.author_user_id == null
  const detailAuthor = detail?.author_user_id?.slice(0, 8) ?? '[deleted]'
  const bodyText = selfDeleted ? '[deleted]' : detail?.body

  return (
    <View
      tag="article"
      role="article"
      paddingVertical="$5"
      gap="$3"
    >
      {/* ─── Action · actor · target · time ────────────────────────────────── */}
      <XStack
        alignItems="center"
        gap="$3"
        flexWrap="wrap"
      >
        <Text
          fontFamily="$body"
          fontSize="$3"
          color="$color12"
          fontWeight="600"
        >
          {actionLabel(item.action_type)}
        </Text>
        <Text
          fontFamily="$body"
          fontSize="$1"
          color="$color9"
          textTransform="uppercase"
          letterSpacing={1}
        >
          {actorLabel}
        </Text>
        <Text
          fontFamily="$body"
          fontSize="$1"
          color="$color9"
          textTransform="uppercase"
          letterSpacing={1}
        >
          {targetLabel}
        </Text>
        {/* Absolute ISO instant preserved on aria-label so the relative label
            never hides the precise moment (forensic legibility / handoff). */}
        <Text
          tag="span"
          data-testid="audit-row-timestamp"
          fontFamily="$body"
          fontSize="$1"
          color="$color9"
          aria-label={item.created_at}
        >
          {timeAgoCasual(item.created_at)}
        </Text>
      </XStack>

      {/* ─── Reason + note (rendered only when non-null) ────────────────────── */}
      {item.reason != null ? (
        <Text
          fontFamily="$body"
          fontSize="$2"
          color="$color11"
        >
          {item.reason}
        </Text>
      ) : null}
      {item.note != null ? (
        <Text
          fontFamily="$body"
          fontSize="$2"
          color="$color10"
        >
          {item.note}
        </Text>
      ) : null}

      {/* ─── Expand toggle (only when there is a target to detail) ──────────── */}
      {hasTarget ? (
        <View
          tag="button"
          role="button"
          data-testid="audit-row-expand-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide detail' : 'Show detail'}
          alignSelf="flex-start"
          cursor="pointer"
          onPress={(e) => {
            stop(e)
            setExpanded((v) => !v)
          }}
        >
          <Text
            fontFamily="$body"
            fontSize="$1"
            color="$color9"
          >
            {expanded ? 'Hide detail' : 'Show detail'}
          </Text>
        </View>
      ) : null}

      {/* ─── Inline detail panel ────────────────────────────────────────────── */}
      {hasTarget && expanded ? (
        <YStack
          data-testid="audit-row-panel"
          gap="$3"
          paddingLeft="$3"
          paddingTop="$2"
        >
          {/* Post current-state block (post-referencing rows only). */}
          {hasPost ? (
            detailLoading ? (
              <Text
                fontFamily="$body"
                fontSize="$2"
                color="$color9"
              >
                Loading…
              </Text>
            ) : detailError ? (
              <Text
                fontFamily="$body"
                fontSize="$2"
                color="$color9"
              >
                Couldn&apos;t load the post. Try again shortly.
              </Text>
            ) : detail == null ? (
              <Text
                fontFamily="$body"
                fontSize="$2"
                color="$color9"
              >
                Post no longer available.
              </Text>
            ) : (
              <YStack gap="$2">
                {detail.title != null ? (
                  <Text
                    tag="h4"
                    fontFamily="$journal"
                    fontSize="$5"
                    color="$color12"
                    textDecorationLine={detail.is_removed ? 'line-through' : 'none'}
                    opacity={detail.is_removed ? 0.5 : 1}
                  >
                    {detail.title}
                  </Text>
                ) : null}
                <Text
                  fontFamily="$body"
                  fontSize="$3"
                  color="$color11"
                  textDecorationLine={detail.is_removed ? 'line-through' : 'none'}
                  opacity={detail.is_removed ? 0.5 : 1}
                >
                  {bodyText}
                </Text>
                <XStack
                  alignItems="center"
                  gap="$3"
                  flexWrap="wrap"
                >
                  <Text
                    fontFamily="$body"
                    fontSize="$1"
                    color="$color9"
                    textTransform="uppercase"
                    letterSpacing={1}
                  >
                    {detailAuthor}
                  </Text>
                  {detail.is_removed ? (
                    <Text
                      fontFamily="$body"
                      fontSize="$1"
                      color="$color9"
                    >
                      Removed
                    </Text>
                  ) : null}
                  {selfDeleted ? (
                    <Text
                      fontFamily="$body"
                      fontSize="$1"
                      color="$color9"
                    >
                      Author self-deleted
                    </Text>
                  ) : accountDeleted ? (
                    <Text
                      fontFamily="$body"
                      fontSize="$1"
                      color="$color9"
                    >
                      Author deleted account
                    </Text>
                  ) : null}
                </XStack>
              </YStack>
            )
          ) : null}

          {/* Target moderation history (target-keyed, not entity-complete). */}
          <YStack gap="$2">
            <Text
              fontFamily="$body"
              fontSize="$1"
              color="$color9"
              textTransform="uppercase"
              letterSpacing={1}
            >
              {hasPost ? "This post's actions" : "This user's actions"}
            </Text>
            {historyLoading ? (
              <Text
                fontFamily="$body"
                fontSize="$2"
                color="$color9"
              >
                Loading…
              </Text>
            ) : historyError ? (
              <Text
                fontFamily="$body"
                fontSize="$2"
                color="$color9"
              >
                Couldn&apos;t load the history. Try again shortly.
              </Text>
            ) : (
              (history ?? []).map((h) => (
                <YStack
                  key={h.id}
                  gap="$1"
                >
                  <XStack
                    gap="$2"
                    alignItems="center"
                    flexWrap="wrap"
                  >
                    <Text
                      fontFamily="$body"
                      fontSize="$2"
                      color="$color11"
                    >
                      {actionLabel(h.action_type)}
                    </Text>
                    <Text
                      fontFamily="$body"
                      fontSize="$1"
                      color="$color9"
                    >
                      {timeAgoCasual(h.created_at)}
                    </Text>
                  </XStack>
                  {h.reason != null ? (
                    <Text
                      fontFamily="$body"
                      fontSize="$2"
                      color="$color10"
                    >
                      {h.reason}
                    </Text>
                  ) : null}
                  {h.note != null ? (
                    <Text
                      fontFamily="$body"
                      fontSize="$2"
                      color="$color10"
                    >
                      {h.note}
                    </Text>
                  ) : null}
                </YStack>
              ))
            )}
          </YStack>
        </YStack>
      ) : null}
    </View>
  )
}

export default AuditLogRow
