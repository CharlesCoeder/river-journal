// packages/app/features/moderation/AddNoteDialog.tsx
//
// Controlled note dialog: collects a required private moderation note and fires
// the row-hosted add-note mutation. The post is NOT removed. Mirrors the locked
// Dialog primitive styling from FlagAffordance.tsx.
//
// Boundary rule (D7): no Legend-State imports; platform-agnostic.
//
// Confirm flow (a note has no optimistic feedback, so it stays open until the
// mutation settles): the dialog stays OPEN while `isPending` (Confirm disabled),
// CLOSES only on success (via the per-call `onSuccess` callback), and STAYS OPEN
// on error rendering the calm inline error — Confirm re-enables so pressing it
// again is the retry. `mutation.reset()` runs on open so a stale error from a
// previous attempt never shows on a fresh open.

import { useEffect, useState } from 'react'
import { Dialog, TextArea, XStack, Text, ExpandingLineButton, useReducedMotion } from '@my/ui'

// Disclosure copy — rendered verbatim.
const DISCLOSURE = 'This adds a private moderation note. The post is NOT removed.'

const GENERIC_ERROR_COPY = "Couldn't complete that. Try again."

interface NoteMutationLike {
  mutate: (
    vars: { note: string; target_post_id: string },
    options?: { onSuccess?: () => void }
  ) => void
  isPending: boolean
  error: unknown
  reset?: () => void
}

export interface AddNoteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  postId: string
  mutation: NoteMutationLike
}

export function AddNoteDialog({ open, onOpenChange, postId, mutation }: AddNoteDialogProps) {
  const [note, setNote] = useState('')
  const reducedMotion = useReducedMotion()
  const animationToken = reducedMotion ? undefined : 'quick'

  const submitDisabled = note.trim().length === 0 || mutation.isPending

  // Clear any stale error/success from a previous attempt when the dialog opens.
  useEffect(() => {
    if (open) mutation.reset?.()
  }, [open])

  function resetLocal() {
    setNote('')
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetLocal()
    onOpenChange(next)
  }

  function handleConfirm() {
    if (submitDisabled) return
    // Stay open while the mutation is in flight; close ONLY on success. On error
    // the dialog stays open and surfaces the inline error below.
    mutation.mutate(
      { note: note.trim(), target_post_id: postId },
      { onSuccess: () => handleOpenChange(false) }
    )
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
            Add a note
          </Dialog.Title>
          <Dialog.Description
            fontSize="$2"
            color="$color11"
          >
            {DISCLOSURE}
          </Dialog.Description>

          <TextArea
            value={note}
            onChangeText={setNote}
            placeholder="Write a private note"
            maxLength={500}
            multiline
            numberOfLines={4}
            fontSize="$2"
            borderColor="$color3"
          />

          {mutation.error ? (
            <Text
              fontSize="$2"
              color="$color9"
            >
              {GENERIC_ERROR_COPY}
            </Text>
          ) : null}

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

export default AddNoteDialog
