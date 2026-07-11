// packages/app/features/moderation/AuditLogScreen.tsx
//
// The admin audit log (web + desktop, behind the admin route gate). Renders a
// chronological, newest-first, paginated list of every moderation action with
// the Collective-feed state ladder: skeleton (initial load) → ambient error
// strip → quiet empty state → the list of AuditLogRow separated by 1px dividers
// (no card borders) → a "Load more" affordance.
//
// Boundary rule (D7): no Legend-State imports in this file. Platform-agnostic
// (no expo-*/react-native-mmkv/Tauri/Node imports) so web + desktop render
// identically from this single shared source.
//
// Error resilience: the skeleton is gated on `isLoading` (initial load only),
// NEVER `isFetching`/`isError` — a failed background refetch on the calm poll
// keeps the last-good list on screen and surfaces the error ambiently, never
// blanking the operator's screen mid-review.

import { YStack, View, Text, Separator, useReducedMotion } from '@my/ui'
import { useAuditLog } from 'app/state/collective/auditLog'
import { useCurrentUserId } from 'app/state/collective/currentUser'
import { AuditLogRow } from 'app/features/moderation/AuditLogRow'
import { SkeletonRows } from 'app/features/collective/_shared'

export default function AuditLogScreen() {
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useAuditLog()
  const currentUserId = useCurrentUserId()
  const reducedMotion = useReducedMotion()

  // ─── Loading (initial only) — gated on isLoading, never isFetching/isError ──
  if (isLoading && data === undefined) {
    return (
      <YStack
        data-testid="audit-log-screen"
        width="100%"
        maxWidth={720}
        marginHorizontal="auto"
        paddingHorizontal="$5"
        paddingVertical="$8"
      >
        <SkeletonRows reducedMotion={reducedMotion} />
      </YStack>
    )
  }

  // ─── Initial error (no cached data) — bare error line, no list ─────────────
  if (isError && data === undefined) {
    return (
      <YStack
        data-testid="audit-log-screen"
        width="100%"
        maxWidth={720}
        marginHorizontal="auto"
        paddingHorizontal="$5"
        paddingVertical="$8"
      >
        <Text fontSize="$2" color="$color9" textAlign="center" paddingVertical="$4">
          Couldn&apos;t load the audit log. Try again shortly.
        </Text>
      </YStack>
    )
  }

  const items = data?.pages.flatMap((p) => p.items) ?? []
  const isEmpty = items.length === 0
  // Keep the last-good list on a background refetch error; surface it ambiently.
  const showErrorStrip = isError && data !== undefined

  return (
    <YStack
      data-testid="audit-log-screen"
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
        <YStack paddingVertical="$8" alignItems="center">
          <Text fontFamily="$journal" fontSize="$6" color="$color10" fontStyle="italic">
            No moderation actions yet.
          </Text>
        </YStack>
      ) : (
        <>
          {items.map((item, index) => (
            <View key={item.id}>
              <AuditLogRow item={item} currentUserId={currentUserId} />
              {index < items.length - 1 ? (
                <Separator borderColor="$color3" borderBottomWidth={1} />
              ) : null}
            </View>
          ))}

          {hasNextPage ? (
            <View
              tag="button"
              role="button"
              data-testid="audit-log-load-more"
              alignSelf="center"
              cursor="pointer"
              marginTop="$5"
              disabled={isFetchingNextPage}
              opacity={isFetchingNextPage ? 0.4 : 1}
              onPress={() => {
                if (!isFetchingNextPage) fetchNextPage()
              }}
            >
              <Text fontFamily="$body" fontSize="$2" color="$color10">
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </YStack>
  )
}
