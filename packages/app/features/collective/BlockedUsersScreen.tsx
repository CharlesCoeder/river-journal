// packages/app/features/collective/BlockedUsersScreen.tsx
//
// Settings → Collective → Blocked users. Lists the calling user's own block
// list (RLS-scoped to own rows) and offers a per-row Unblock with an inline
// confirm. Mirrors YourPostsScreen's structure: hooks-first, AnimatePresence
// mount fade, cold-cache skeleton, tappable-retry error state, mapped rows with
// parent-rendered 1px separators, centered serif empty state.
//
// SILENT-BOUNDARY INVARIANT: the row shows ONLY the anonymized 8-char id
// slice + the blocked-at date + an Unblock control. It renders NOTHING derived
// from the blocked user's activity (no posts/reactions/last-seen) — a future
// enrichment join would reintroduce the leak. No signal ever reaches the blocked
// user; unblock is a plain DELETE.
//
// Suspension orthogonality (AC): this screen NEVER consults suspension state —
// blocking/unblocking is a safety affordance that stays available while
// suspended. Do not wire any suspension hook into the block flow.
//
// Boundary rule (D7): no Legend-State imports. This screen ships to ALL
// platforms and must not import the admin moderation feature tree (admin-only,
// mobile-excluded).

import { useEffect, useState } from 'react'
import {
  AnimatePresence,
  YStack,
  XStack,
  View,
  Text,
  Separator,
  Dialog,
  ExpandingLineButton,
  useReducedMotion,
} from '@my/ui'
import { useCurrentUserId } from 'app/state/collective/currentUser'
import { useBlockedUsers, useUnblockUser } from 'app/state/collective/blocks'
import { SkeletonRows } from './_shared'

function formatBlockedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function BlockedUsersScreen() {
  // All hooks unconditionally before any early return (Rules of Hooks).
  const currentUserId = useCurrentUserId()
  const blockedUsers = useBlockedUsers(currentUserId)
  const unblockMutation = useUnblockUser()
  const reducedMotion = useReducedMotion()
  const animationToken = reducedMotion ? undefined : 'quick'

  // Which row's inline Unblock confirm is open (row id), or null.
  const [pendingUnblockId, setPendingUnblockId] = useState<string | null>(null)

  // Ease the list in on mount — mirrors the feed/thread/Settings entrance.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  const rows = blockedUsers.data ?? []
  const pendingRow = rows.find((r) => r.id === pendingUnblockId) ?? null

  // ─── Loading state (cold cache) ─────────────────────────────────────────────
  // Also gates on the session still resolving (`currentUserId === undefined`):
  // while that's true the query is `enabled: false`, so `isLoading` is false
  // and a user WITH blocks would otherwise see the empty state flash before
  // their session (and then the list) resolves. `currentUserId === null`
  // (signed out, resolved) is intentionally excluded — that case should show
  // the empty state, not spin forever.
  if ((blockedUsers.isLoading || currentUserId === undefined) && blockedUsers.data === undefined) {
    return (
      <YStack>
        <SkeletonRows reducedMotion={reducedMotion} />
      </YStack>
    )
  }

  // ─── Error state — no cached data ───────────────────────────────────────────
  // Tappable retry text (contains "retry" so getByText(/retry/i) resolves it).
  if (blockedUsers.isError && blockedUsers.data === undefined) {
    return (
      <YStack>
        <View onPress={() => blockedUsers.refetch()}>
          <Text
            fontSize="$2"
            color="$color9"
            textAlign="center"
            paddingVertical="$4"
          >
            Couldn&apos;t load your blocked list. Pull to retry.
          </Text>
        </View>
      </YStack>
    )
  }

  const isEmpty = rows.length === 0

  function handleUnblockConfirm() {
    // Always clear the pending row on confirm, even on the (now effectively
    // unreachable, since row triggers are disabled mid-flight — see the
    // Unblock ExpandingLineButton below) isPending guard, so a confirm dialog
    // can never be left stranded open with no feedback.
    if (unblockMutation.isPending) {
      setPendingUnblockId(null)
      return
    }
    if (pendingRow) {
      unblockMutation.mutate({ id: pendingRow.id })
    }
    setPendingUnblockId(null)
  }

  return (
    <AnimatePresence>
      {mounted && (
        <YStack
          key="collective-blocked-users-body"
          transition="designEnter"
          enterStyle={{ opacity: 0, y: 10 }}
          opacity={1}
          y={0}
          width="100%"
          maxWidth={720}
          marginHorizontal="auto"
        >
          {/* Empty state */}
          {isEmpty ? (
            <Text
              fontFamily="$journal"
              fontSize="$5"
              color="$color11"
              textAlign="center"
              marginTop="$8"
            >
              You haven&apos;t blocked anyone.
            </Text>
          ) : null}

          {/* Block list — divider-free rows, parent-rendered separators */}
          {rows.map((row, index) => (
            <View key={row.id}>
              <XStack
                justifyContent="space-between"
                alignItems="center"
                paddingVertical="$3"
              >
                <YStack>
                  <Text
                    fontFamily="$body"
                    fontSize="$4"
                    color="$color"
                  >
                    {row.blocked_user_id.slice(0, 8)}
                  </Text>
                  <Text
                    fontSize="$1"
                    color="$color9"
                  >
                    Blocked {formatBlockedAt(row.created_at)}
                  </Text>
                </YStack>
                <ExpandingLineButton
                  size="default"
                  disabled={unblockMutation.isPending}
                  onPress={() => setPendingUnblockId(row.id)}
                >
                  Unblock
                </ExpandingLineButton>
              </XStack>
              {index < rows.length - 1 ? (
                <Separator
                  borderColor="$color3"
                  borderBottomWidth={1}
                />
              ) : null}
            </View>
          ))}

          {/* Inline Unblock confirm — a single screen-level controlled dialog,
              keyed by pendingUnblockId (one confirm surface at a time). Built
              on the locked Dialog primitive (Portal/Overlay/Content) — same
              structure, styling, animation, and focus-trap/no-tap-outside
              behavior as BlockUserConfirmDialog and FlagAffordance's
              delete-confirm dialog: $shadow6 overlay, $background card, 1px
              $color3 border, reduced-motion-gated animation token,
              right-aligned Cancel + Unblock ExpandingLineButtons. */}
          <Dialog
            modal
            open={pendingRow !== null}
            onOpenChange={(open: boolean) => {
              if (!open) setPendingUnblockId(null)
            }}
          >
            <Dialog.Portal>
              <Dialog.Overlay
                key="unblock-overlay"
                backgroundColor="$shadow6"
                animation={animationToken}
                enterStyle={{ opacity: 0 }}
                exitStyle={{ opacity: 0 }}
              />
              <Dialog.Content
                key="unblock-content"
                gap="$3"
                padding="$4"
                maxWidth={420}
                width="90%"
                backgroundColor="$background"
                borderColor="$color3"
                borderWidth={1}
                animation={animationToken}
              >
                {pendingRow ? (
                  <>
                    <Dialog.Title
                      fontSize="$5"
                      fontFamily="$body"
                    >
                      Unblock {pendingRow.blocked_user_id.slice(0, 8)}?
                    </Dialog.Title>
                    <Dialog.Description
                      fontSize="$2"
                      color="$color11"
                    >
                      They&apos;ll be able to see your posts and you&apos;ll see theirs again.
                    </Dialog.Description>
                    <XStack
                      gap="$3"
                      justifyContent="flex-end"
                      marginTop="$3"
                    >
                      <ExpandingLineButton onPress={() => setPendingUnblockId(null)}>
                        Cancel
                      </ExpandingLineButton>
                      <ExpandingLineButton onPress={handleUnblockConfirm}>
                        Unblock
                      </ExpandingLineButton>
                    </XStack>
                  </>
                ) : null}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog>
        </YStack>
      )}
    </AnimatePresence>
  )
}
