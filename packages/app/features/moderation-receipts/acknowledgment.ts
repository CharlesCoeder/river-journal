/**
 * Moderation-receipt acknowledgment — Legend-State side effect.
 *
 * Lives in the FEATURE layer (not state/collective/**) because it touches
 * `store$.profile.preferences` (Legend-State). The state/collective subtree
 * forbids Legend-State imports (D7 boundary); the disclosure feature
 * (`features/disclosure/ThreePostureDisclosure.tsx`) is the precedent for a
 * Legend-State acknowledgment side-effect living in the feature layer.
 *
 * Acknowledgment is stored on
 * `store$.profile.preferences.moderationReceipts.<receiptId> = { acknowledged_at }`
 * — server-synced, so a receipt acknowledged on one device never re-surfaces on
 * another. The write is local-first (durable across an app restart before it
 * syncs), so an offline dismiss suppresses the receipt immediately and survives
 * a force-quit.
 */

import { store$ } from 'app/state/store'

// ─── receiptId builders ────────────────────────────────────────────────────────

/**
 * Stable composite key for a removed-post receipt.
 *
 * `removedAt` MUST be the RAW string returned by the RPC, used verbatim on BOTH
 * the write (`acknowledgeReceipt`) and read (`hasAcknowledgedReceipt`) paths —
 * never a `date-fns`-reparsed/reformatted/timezone-shifted value. If the two
 * paths formatted `removed_at` differently the keys wouldn't match and an
 * already-acknowledged receipt would re-surface on next load. The human-readable
 * date shown in the dialog copy is a SEPARATE derived value and must not feed
 * this key. The `removed_at` suffix means a re-removal after reinstatement
 * yields a fresh (unacknowledged) receipt.
 */
export function removedPostReceiptId(postId: string, removedAt: string): string {
  return `removed_post:${postId}:${removedAt}`
}

/** Stable composite key for a suspension receipt. */
export function suspensionReceiptId(id: string): string {
  return `suspension:${id}`
}

// ─── Persistence helpers ───────────────────────────────────────────────────────

/**
 * Returns true if the current user has acknowledged the given receipt.
 * Synchronous and null-safe — safe to call during render (the gate calls it to
 * filter the receipt queue). Returns false when `store$.profile` is null
 * (anonymous) or the path does not yet exist in the observable tree.
 */
export function hasAcknowledgedReceipt(receiptId: string): boolean {
  try {
    const acknowledgedAt =
      store$.profile.preferences?.moderationReceipts?.[receiptId]?.acknowledged_at?.get?.()
    return Boolean(acknowledgedAt)
  } catch {
    return false
  }
}

/**
 * Records an acknowledgment timestamp for the given receipt.
 *
 * Idempotent — a no-op if already acknowledged, so a double-dismiss (e.g. a
 * cross-device race, or a lapsed-then-reappearing cache) never overwrites the
 * first `acknowledged_at`. Mirrors `completeOnboarding`'s guard and the
 * disclosure write. Guards a null profile defensively even though the gate only
 * renders for an authenticated user (profile present).
 */
export function acknowledgeReceipt(
  receiptId: string,
  now: string = new Date().toISOString()
): void {
  if (hasAcknowledgedReceipt(receiptId)) return
  try {
    // Read-merge-write the whole map (mirrors addLocallyHiddenPost) rather than
    // a dynamic-index observable write, so the write goes through the known
    // optional `moderationReceipts` property and stays cleanly typed.
    const current = store$.profile.preferences.moderationReceipts.get() ?? {}
    store$.profile.preferences.moderationReceipts.set({
      ...current,
      [receiptId]: { acknowledged_at: now },
    })
  } catch (error) {
    // Profile is null / observable path unavailable — nothing to persist. The
    // gate's session-local dismissed set still suppresses the receipt for this
    // mount, but without a persisted timestamp it re-surfaces on the next
    // mount, so make the failure observable in dev (receiptId is metadata —
    // ids + a timestamp — never user content).
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[moderation-receipts] failed to persist acknowledgment for ${receiptId}`, error)
    }
  }
}
