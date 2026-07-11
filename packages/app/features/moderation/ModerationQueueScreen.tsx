// packages/app/features/moderation/ModerationQueueScreen.tsx
//
// The admin moderation queue (web + desktop, behind the admin route gate).
// Renders the pending-flags list with the Collective-feed state ladder:
// skeleton (initial load) → ambient error strip → quiet empty state → the list
// of ModerationQueueRow separated by 1px dividers (no card borders).
//
// Boundary rule (D7): no Legend-State imports in this file. Platform-agnostic
// (no expo-*/react-native-mmkv/Tauri/Node imports) so web + desktop render
// identically from this single shared source.
//
// Error resilience: the skeleton is gated on `isLoading` (initial load only),
// NEVER `isFetching`/`isError` — a failed background refetch on the calm poll
// must keep the last-good queue on screen and surface the error ambiently,
// never blank Charlie's screen mid-triage.

import { YStack, View, Text, Separator, useReducedMotion } from '@my/ui'
import {
  useModerationQueue,
  useLastModerationActionAt,
} from 'app/state/collective/moderation'
import { ModerationQueueRow } from 'app/features/moderation/ModerationQueueRow'
import { SkeletonRows, timeAgoCasual } from 'app/features/collective/_shared'

export default function ModerationQueueScreen() {
  const { data, isLoading, isError } = useModerationQueue()
  const { data: lastActionAt, isLoading: lastActionLoading } = useLastModerationActionAt()
  const reducedMotion = useReducedMotion()

  // ─── Loading (initial only) — gated on isLoading, never isFetching/isError ──
  if (isLoading && data === undefined) {
    return (
      <YStack data-testid="moderation-queue-screen" width="100%" maxWidth={720} marginHorizontal="auto" paddingHorizontal="$5" paddingVertical="$8">
        <SkeletonRows reducedMotion={reducedMotion} />
      </YStack>
    )
  }

  // ─── Initial error (no cached data) — bare error line, no list ─────────────
  if (isError && data === undefined) {
    return (
      <YStack data-testid="moderation-queue-screen" width="100%" maxWidth={720} marginHorizontal="auto" paddingHorizontal="$5" paddingVertical="$8">
        <Text fontSize="$2" color="$color9" textAlign="center" paddingVertical="$4">
          Couldn&apos;t load the queue. Try again shortly.
        </Text>
      </YStack>
    )
  }

  const items = data ?? []
  const isEmpty = items.length === 0
  // Keep the last-good list on a background refetch error; surface it ambiently.
  const showErrorStrip = isError && data !== undefined
  // Prefer "No pending flags." over flashing a stale/undefined timestamp while
  // the last-action query is still resolving.
  const hasLastAction = !lastActionLoading && lastActionAt != null

  return (
    <YStack
      data-testid="moderation-queue-screen"
      width="100%"
      maxWidth={720}
      marginHorizontal="auto"
      paddingHorizontal="$5"
      paddingVertical="$8"
    >
      {showErrorStrip ? (
        <Text fontSize="$1" color="$color9" textAlign="center" paddingVertical="$2">
          Couldn&apos;t refresh. Showing the last update.
        </Text>
      ) : null}

      {isEmpty ? (
        hasLastAction ? (
          <YStack paddingVertical="$8" gap="$2" alignItems="center">
            <Text fontFamily="$journal" fontSize="$6" color="$color10" fontStyle="italic">
              Queue clear.
            </Text>
            <Text fontFamily="$body" fontSize="$1" color="$color9">
              Last action {timeAgoCasual(lastActionAt as string)}
            </Text>
          </YStack>
        ) : (
          <YStack paddingVertical="$8" alignItems="center">
            <Text fontFamily="$journal" fontSize="$6" color="$color10" fontStyle="italic">
              No pending flags.
            </Text>
          </YStack>
        )
      ) : (
        items.map((item, index) => (
          <View key={item.post_id}>
            <ModerationQueueRow item={item} />
            {index < items.length - 1 ? (
              <Separator borderColor="$color3" borderBottomWidth={1} />
            ) : null}
          </View>
        ))
      )}
    </YStack>
  )
}
