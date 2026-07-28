// packages/app/features/collective/BlockUserConfirmDialog.tsx
//
// Controlled confirm dialog for user-to-user blocking. Mirrors the
// delete-confirm dialog in FlagAffordance verbatim (locked Dialog primitive:
// $shadow6 overlay, $color3 1px content border, spring entry gated on reduced
// motion, right-aligned Cancel + Block ExpandingLineButtons).
//
// SILENT-BOUNDARY INVARIANT: blocking is silent and symmetric. Nothing here
// signals the blocked user — no toast, banner, push, or distinct copy. The
// copy is identical regardless of identity (no blocked-vs-removed asymmetry).
// The dialog closes IMMEDIATELY on confirm (fire-and-forget, never awaits the
// mutation) — the close is the acknowledgment, since there is no optimistic
// vanish.
//
// Boundary rule (D7): no Legend-State imports; no features/moderation imports.

import { Dialog, XStack, ExpandingLineButton, useReducedMotion } from '@my/ui'
import { useBlockUser } from 'app/state/collective/blocks'

export interface BlockUserConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The current authenticated user — the blocker. Sent explicitly in the INSERT. */
  blockerUserId: string
  /** The post author's user_id — the blocked party. Nullish → defensive bail. */
  blockedUserId: string | null | undefined
}

export function BlockUserConfirmDialog({
  open,
  onOpenChange,
  blockerUserId,
  blockedUserId,
}: BlockUserConfirmDialogProps) {
  const blockMutation = useBlockUser()
  const reducedMotion = useReducedMotion()
  const animationToken = reducedMotion ? undefined : 'quick'

  // Anonymized identity — the surface-wide 8-char slice convention.
  const anonymizedId = blockedUserId?.slice(0, 8) ?? ''

  function handleConfirm() {
    // Defensive UX bail (belt-and-suspenders): a self-block or a nullish target
    // is impossible to land — the DB `user_blocks_no_self_block CHECK` rejects a
    // self-block with 23514 (which falls through the constraint-scoped 23505
    // swallow and throws silently), and a nullish target has nothing to insert.
    // This only avoids a wasted round-trip + a doomed mutation; the CHECK is the
    // real backstop. Close with no side effect.
    if (!blockedUserId || blockerUserId === blockedUserId) {
      onOpenChange(false)
      return
    }
    // Double-tap guard.
    if (blockMutation.isPending) return
    // Fire-and-forget — do NOT await. The close IS the acknowledgment.
    blockMutation.mutate({ blocker_user_id: blockerUserId, blocked_user_id: blockedUserId })
    onOpenChange(false)
  }

  function handleCancel() {
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      modal
    >
      <Dialog.Portal>
        <Dialog.Overlay
          key="block-overlay"
          backgroundColor="$shadow6"
          animation={animationToken}
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
        />
        <Dialog.Content
          key="block-content"
          gap="$3"
          padding="$4"
          maxWidth={420}
          width="90%"
          backgroundColor="$background"
          borderColor="$color3"
          borderWidth={1}
          animation={animationToken}
        >
          <Dialog.Title
            fontSize="$5"
            fontFamily="$body"
          >
            Block this user?
          </Dialog.Title>
          <Dialog.Description
            fontSize="$2"
            color="$color11"
          >
            Block {anonymizedId}? You won&apos;t see their posts and they won&apos;t see yours.
          </Dialog.Description>

          <XStack
            gap="$3"
            justifyContent="flex-end"
            marginTop="$3"
          >
            <ExpandingLineButton onPress={handleCancel}>Cancel</ExpandingLineButton>
            <ExpandingLineButton onPress={handleConfirm}>Block</ExpandingLineButton>
          </XStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export default BlockUserConfirmDialog
