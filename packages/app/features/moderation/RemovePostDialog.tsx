// packages/app/features/moderation/RemovePostDialog.tsx
//
// Controlled removal dialog: collects a templated reason (+ optional note) and
// fires the row-hosted remove mutation. Mirrors the locked Dialog primitive
// styling from features/collective/FlagAffordance.tsx.
//
// Boundary rule (D7): no Legend-State imports; platform-agnostic (web + desktop
// render from this single shared source).
//
// The mutation hook is hosted by ModerationQueueRow and passed in as `mutation`
// so its `isPending` survives this dialog's fire-and-forget close.
//
// Confirm flow — the EXCEPTION to the other two dialogs: removal is optimistic
// (the row is patched struck-through immediately and rolled back on error), so
// the dialog keeps close-on-confirm rather than staying open. A failed remove is
// NOT silent — the row surfaces it via a toast (see ModerationQueueRow's
// RemoveAction), which is why this dialog renders no inline error and does not
// reset on open (resetting would drop the `isPending` double-submit guard the
// row relies on across the fire-and-forget close).

import { useState } from 'react'
import {
  Dialog,
  RadioGroup,
  Label,
  TextArea,
  XStack,
  YStack,
  ExpandingLineButton,
  useReducedMotion,
} from '@my/ui'

// Templated removal reasons — a superset of FlagAffordance's report reasons.
// Reused by SuspendUserDialog.
export const REMOVAL_REASONS = [
  { code: 'harassment', label: 'Harassment' },
  { code: 'off_topic', label: 'Off-topic' },
  { code: 'spam', label: 'Spam' },
  { code: 'threats', label: 'Threats' },
  { code: 'illegal_content', label: 'Illegal content' },
  { code: 'other', label: 'Other' },
] as const

export type RemovalReasonCode = (typeof REMOVAL_REASONS)[number]['code']

// Minimal externally-owned mutation shape (a useMutation result subset). The
// error is handled by the row (toast), so this dialog does not read it.
interface RemoveMutationLike {
  mutate: (vars: {
    target_post_id: string
    reason_code: string
    custom_note: string | null
  }) => void
  isPending: boolean
}

export interface RemovePostDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  postId: string
  mutation: RemoveMutationLike
}

export function RemovePostDialog({ open, onOpenChange, postId, mutation }: RemovePostDialogProps) {
  const [selectedReason, setSelectedReason] = useState<RemovalReasonCode | undefined>(undefined)
  const [note, setNote] = useState('')
  const reducedMotion = useReducedMotion()
  const animationToken = reducedMotion ? undefined : 'quick'

  const submitDisabled = !selectedReason || mutation.isPending

  function resetLocal() {
    setSelectedReason(undefined)
    setNote('')
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetLocal()
    onOpenChange(next)
  }

  function handleConfirm() {
    if (submitDisabled) return
    mutation.mutate({
      target_post_id: postId,
      reason_code: selectedReason!,
      custom_note: note.trim() || null,
    })
    handleOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      modal
    >
      <Dialog.Portal>
        <Dialog.Overlay
          key="overlay"
          backgroundColor="$shadow6"
          animation={animationToken}
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
        />
        <Dialog.Content
          key="content"
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
            Remove this post
          </Dialog.Title>
          <Dialog.Description
            fontSize="$2"
            color="$color11"
          >
            The post is removed for everyone and its open reports are resolved.
          </Dialog.Description>

          <RadioGroup
            value={selectedReason ?? ''}
            onValueChange={(v) => setSelectedReason(v as RemovalReasonCode)}
            required
          >
            <YStack gap="$2">
              {REMOVAL_REASONS.map(({ code, label }) => (
                <XStack
                  key={code}
                  alignItems="center"
                  gap="$2"
                >
                  <RadioGroup.Item
                    value={code}
                    id={`remove-reason-${code}`}
                  />
                  <Label
                    htmlFor={`remove-reason-${code}`}
                    fontSize="$3"
                  >
                    {label}
                  </Label>
                </XStack>
              ))}
            </YStack>
          </RadioGroup>

          <TextArea
            value={note}
            onChangeText={setNote}
            placeholder="Add a note (optional)"
            maxLength={500}
            multiline
            numberOfLines={3}
            fontSize="$2"
            borderColor="$color3"
          />

          <XStack
            gap="$3"
            justifyContent="flex-end"
            marginTop="$3"
          >
            <ExpandingLineButton onPress={() => handleOpenChange(false)}>
              Cancel
            </ExpandingLineButton>
            <ExpandingLineButton
              onPress={handleConfirm}
              disabled={submitDisabled}
            >
              Confirm
            </ExpandingLineButton>
          </XStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export default RemovePostDialog
