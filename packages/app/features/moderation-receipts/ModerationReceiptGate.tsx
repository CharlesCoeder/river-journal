/**
 * ModerationReceiptGate — the calm, one-at-a-time receipt queue.
 *
 * Cross-domain composition (allowed ONLY at the component layer): it reads the
 * TQ data hooks (`useMyRemovedPosts`, `useMyActiveSuspension`) AND the
 * Legend-State acknowledgment helpers. It builds an ordered queue —
 * SUSPENSION FIRST (the actionable "here's what you can still do" notice), then
 * removed posts newest-first (the RPC's own ordering) — filters out any receipt
 * the user has already acknowledged, and renders `ModerationReceiptDialog` for
 * the FIRST remaining receipt only. Dismissing writes the acknowledgment and
 * advances to the next; acknowledged receipts never re-appear.
 *
 * Calm-queue discipline: a user with a large removed-posts backlog never faces
 * a wall of dialogs — the RPC caps the fetch, only one shows at a time, and the
 * rest wait (no badge pile-on, no auto-escalation) for a later session.
 *
 * Renders null when `userId` is not a string (undefined=loading,
 * null=logged-out) — it must never render pre-auth — or when the queue is empty.
 */

import { useState } from 'react'
import { useCurrentUserId } from 'app/state/collective/currentUser'
import { useMyActiveSuspension } from 'app/state/collective/suspension'
import { useMyRemovedPosts } from 'app/state/collective/moderationReceipts'
import { ModerationReceiptDialog, type ModerationReceipt } from './ModerationReceiptDialog'
import {
  hasAcknowledgedReceipt,
  acknowledgeReceipt,
  removedPostReceiptId,
  suspensionReceiptId,
} from './acknowledgment'

function receiptIdFor(receipt: ModerationReceipt): string {
  return receipt.kind === 'suspension'
    ? suspensionReceiptId(receipt.id)
    : removedPostReceiptId(receipt.id, receipt.removed_at)
}

export function ModerationReceiptGate() {
  const userId = useCurrentUserId()
  const activeUserId = typeof userId === 'string' ? userId : null

  // Hooks called unconditionally (Rules of Hooks) — they self-disable when the
  // userId is null, so no receipt fetch surfaces pre-auth.
  const suspension = useMyActiveSuspension(activeUserId)
  const removedPostsQuery = useMyRemovedPosts(activeUserId)

  // Session-local record of receipts dismissed this render session. The
  // acknowledgment write lands in Legend-State but the gate does not subscribe
  // reactively (D7 — hasAcknowledgedReceipt is a synchronous non-reactive read),
  // so this state is what advances the queue to the next receipt after a dismiss.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())

  if (activeUserId === null) return null

  const receipts: ModerationReceipt[] = []

  // Suspension first — with a render-time expiry guard. `useMyActiveSuspension`
  // filters `ends_at > now` only at fetch time (staleTime 60s), so a suspension
  // that lapsed mid-session can still sit in cache; re-check here so it is never
  // shown as "paused until {a past date}".
  if (suspension !== null && new Date(suspension.ends_at).getTime() > Date.now()) {
    receipts.push({
      kind: 'suspension',
      id: suspension.id,
      ends_at: suspension.ends_at,
      reason: suspension.reason,
    })
  }

  // Then removed posts, in the RPC's newest-first order.
  const removedPosts = removedPostsQuery.data ?? []
  for (const post of removedPosts) {
    receipts.push({
      kind: 'removed_post',
      id: post.id,
      parent_post_id: post.parent_post_id,
      created_at: post.created_at,
      removed_reason: post.removed_reason,
      removed_at: post.removed_at,
    })
  }

  const next = receipts.find((receipt) => {
    const id = receiptIdFor(receipt)
    return !dismissed.has(id) && !hasAcknowledgedReceipt(id)
  })

  if (next === undefined) return null

  const nextReceiptId = receiptIdFor(next)

  return (
    <ModerationReceiptDialog
      receipt={next}
      onAcknowledge={() => {
        acknowledgeReceipt(nextReceiptId)
        setDismissed((prev) => {
          const updated = new Set(prev)
          updated.add(nextReceiptId)
          return updated
        })
      }}
    />
  )
}

export default ModerationReceiptGate
