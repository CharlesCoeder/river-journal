// packages/app/features/moderation/ModerationQueueRow.tsx
//
// A single moderation-queue row: the reported post's title/body preview, the
// aggregated flag count, the anonymized author, the post timestamp, the latest
// report reason/note preview, an expand-to-show-all-reports toggle, and four
// action affordances. Reuses the Collective-feed styling (dense, no card
// borders); the row divider is drawn by the screen.
//
// Boundary rule (D7): no Legend-State imports in this file.
//
// Deletion-state rendering mirrors FeedPostRow / ThreadView / PostRow verbatim.
// Precedence: is_user_deleted (content self-delete) WINS when it co-occurs with
// author_user_id === null (account deletion) — render ONLY the self-deleted
// tombstone + "Author self-deleted" marker, never also "Author deleted account".
//
// The four action affordances are STUBBED here: they are inert unless a caller
// wires an `on*` handler. The removal/suspension/note dialogs are wired in a
// later change.

import { useState } from 'react'
import { View, Text, XStack, YStack } from '@my/ui'
import type { ModerationQueueItem } from 'app/state/collective/moderation'
import { timeAgoCasual } from 'app/features/collective/_shared'

// Body preview cap — never dump a full (up to 500-word) body into the row.
const BODY_PREVIEW_CAP = 240

export interface ModerationQueueRowProps {
  item: ModerationQueueItem
  // Stub action handlers — unwired in this change. When absent the affordance
  // is inert (no handler fires, no crash). A later change wires these to the
  // removal / note / suspension / dismiss dialogs.
  onRemove?: (postId: string) => void
  onAddNote?: (postId: string) => void
  onSuspend?: (postId: string) => void
  onDismiss?: (postId: string) => void
}

function truncateBody(body: string): string {
  if (body.length <= BODY_PREVIEW_CAP) return body
  return `${body.slice(0, BODY_PREVIEW_CAP).trimEnd()}…`
}

export function ModerationQueueRow({
  item,
  onRemove,
  onAddNote,
  onSuspend,
  onDismiss,
}: ModerationQueueRowProps) {
  const [expanded, setExpanded] = useState(false)

  // Deletion-state precedence: is_user_deleted wins when both coincide.
  const selfDeleted = item.is_user_deleted === true
  const accountDeleted = item.author_user_id === null

  // Author identity: the anonymized 8-char slice used across the Collective.
  const author = item.author_user_id?.slice(0, 8) ?? '[deleted]'

  // Body: self-deleted content is a tombstone; an account-deleted author keeps
  // the original body (only the account row is gone).
  const bodyText = selfDeleted ? '[deleted]' : truncateBody(item.body)

  const flagLabel = `${item.flag_count} report${item.flag_count === 1 ? '' : 's'}`

  const reports = item.reports ?? []

  // Always attach a press handler -- even when no `on*` prop is wired -- so a
  // press on an inert stub stops propagation instead of bubbling up to the
  // row's own onPress and toggling expand/collapse.
  const stub = (handler?: (postId: string) => void) =>
    (e?: { stopPropagation?: () => void }) => {
      e?.stopPropagation?.()
      handler?.(item.post_id)
    }

  return (
    <View
      tag="article"
      role="article"
      accessibilityRole="button"
      onPress={() => setExpanded((v) => !v)}
      cursor="pointer"
      paddingVertical="$5"
      gap="$3"
    >
      {/* ─── Title + body preview ──────────────────────────────────────────── */}
      <YStack gap="$2">
        {item.title != null ? (
          <Text
            tag="h3"
            fontFamily="$journal"
            fontSize="$6"
            color="$color12"
            textDecorationLine={item.is_removed ? 'line-through' : 'none'}
            opacity={item.is_removed ? 0.5 : 1}
          >
            {item.title}
          </Text>
        ) : null}
        <Text
          fontFamily="$body"
          fontSize="$3"
          color="$color11"
          textDecorationLine={item.is_removed ? 'line-through' : 'none'}
          opacity={item.is_removed ? 0.5 : 1}
        >
          {bodyText}
        </Text>
      </YStack>

      {/* ─── Metadata line: author · time · flag count · markers ───────────── */}
      <XStack alignItems="center" gap="$3" flexWrap="wrap">
        <Text
          fontFamily="$body"
          fontSize="$1"
          color="$color9"
          textTransform="uppercase"
          letterSpacing={1}
        >
          {author}
        </Text>
        <Text fontFamily="$body" fontSize="$1" color="$color9">
          {timeAgoCasual(item.post_created_at)}
        </Text>
        <Text fontFamily="$body" fontSize="$1" color="$color11" fontWeight="600">
          {flagLabel}
        </Text>
        {item.is_removed ? (
          <Text fontFamily="$body" fontSize="$1" color="$color9">
            Removed
          </Text>
        ) : null}
        {selfDeleted ? (
          <Text fontFamily="$body" fontSize="$1" color="$color9">
            Author self-deleted
          </Text>
        ) : accountDeleted ? (
          <Text fontFamily="$body" fontSize="$1" color="$color9">
            Author deleted account
          </Text>
        ) : null}
      </XStack>

      {/* ─── Latest-report preview (collapsed) ─────────────────────────────── */}
      <Text fontFamily="$body" fontSize="$2" color="$color10">
        {item.latest_report_note != null
          ? `${item.latest_report_reason} · ${item.latest_report_note}`
          : item.latest_report_reason}
      </Text>

      {/* ─── Expanded: all individual pending reports ──────────────────────── */}
      {expanded ? (
        <YStack data-testid="moderation-row-reports" gap="$2" paddingLeft="$3">
          {reports.map((r) => (
            <YStack key={r.id} gap="$1">
              <XStack gap="$2" alignItems="center">
                <Text fontFamily="$body" fontSize="$2" color="$color11">
                  {r.reason_code}
                </Text>
                <Text fontFamily="$body" fontSize="$1" color="$color9">
                  {timeAgoCasual(r.created_at)}
                </Text>
              </XStack>
              {r.note != null ? (
                <Text fontFamily="$body" fontSize="$2" color="$color10">
                  {r.note}
                </Text>
              ) : null}
            </YStack>
          ))}
        </YStack>
      ) : null}

      {/* ─── Stubbed action affordances (wired in a later change) ──────────── */}
      <XStack gap="$4" flexWrap="wrap">
        <View data-testid="moderation-action-remove" onPress={stub(onRemove)} cursor="pointer">
          <Text fontFamily="$body" fontSize="$2" color="$color10">
            Remove
          </Text>
        </View>
        <View data-testid="moderation-action-add-note" onPress={stub(onAddNote)} cursor="pointer">
          <Text fontFamily="$body" fontSize="$2" color="$color10">
            Add note
          </Text>
        </View>
        <View data-testid="moderation-action-suspend" onPress={stub(onSuspend)} cursor="pointer">
          <Text fontFamily="$body" fontSize="$2" color="$color10">
            Suspend author
          </Text>
        </View>
        <View data-testid="moderation-action-dismiss" onPress={stub(onDismiss)} cursor="pointer">
          <Text fontFamily="$body" fontSize="$2" color="$color10">
            Dismiss reports
          </Text>
        </View>
      </XStack>
    </View>
  )
}

export default ModerationQueueRow
