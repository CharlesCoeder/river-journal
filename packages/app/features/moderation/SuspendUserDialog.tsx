// packages/app/features/moderation/SuspendUserDialog.tsx
//
// Controlled suspension dialog: collects a duration (preset or custom days) + a
// required templated reason (+ optional note folded into the single `reason`
// arg) and fires the row-hosted suspend mutation. Mirrors the locked Dialog
// primitive styling from FlagAffordance.tsx.
//
// Boundary rule (D7): no Legend-State imports; platform-agnostic.
//
// Confirm flow (a suspension has no optimistic queue feedback, so the dialog
// stays open until the mutation settles): stays OPEN while `isPending` (Confirm
// disabled), CLOSES only on success (per-call `onSuccess`), and STAYS OPEN on
// error rendering the calm inline error — Confirm re-enables so pressing it
// again is the retry. `mutation.reset()` runs on open so a stale error never
// shows on a fresh open.

import { useEffect, useState } from 'react'
import {
  Dialog,
  RadioGroup,
  Label,
  TextArea,
  Input,
  XStack,
  YStack,
  Text,
  ExpandingLineButton,
  useReducedMotion,
} from '@my/ui'
import { REMOVAL_REASONS, type RemovalReasonCode } from './RemovePostDialog'

const DURATION_PRESETS = [
  { value: '1', label: '1 day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
] as const

// FR26 scope statement — rendered verbatim.
const SCOPE_WARNING =
  'Suspension blocks posting and reacting only. Writing and reading remain available.'

const GENERIC_ERROR_COPY = "Couldn't complete that. Try again."

interface SuspendMutationLike {
  mutate: (
    vars: { target_user_id: string; duration_days: number; reason: string },
    options?: { onSuccess?: () => void }
  ) => void
  isPending: boolean
  error: unknown
  reset?: () => void
}

// Upper bound on a custom suspension length (~10 years). A value above the cap
// is treated as invalid so Confirm stays gated.
const MAX_CUSTOM_DAYS = 3650

export interface SuspendUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  authorUserId: string
  mutation: SuspendMutationLike
}

// A valid custom-days value is an integer in [1, MAX_CUSTOM_DAYS] (rejects
// empty, 0, negatives, decimals, non-numeric, and anything above the cap). It
// always wins over a selected preset; an invalid value falls back to the preset.
function resolveDuration(customDays: string, preset: string | undefined): number | null {
  const trimmed = customDays.trim()
  if (/^\d+$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10)
    if (n >= 1 && n <= MAX_CUSTOM_DAYS) return n
  }
  if (preset != null) return Number(preset)
  return null
}

export function SuspendUserDialog({
  open,
  onOpenChange,
  authorUserId,
  mutation,
}: SuspendUserDialogProps) {
  const [preset, setPreset] = useState<string | undefined>(undefined)
  const [customDays, setCustomDays] = useState('')
  const [selectedReason, setSelectedReason] = useState<RemovalReasonCode | undefined>(undefined)
  const [note, setNote] = useState('')
  const reducedMotion = useReducedMotion()
  const animationToken = reducedMotion ? undefined : 'quick'

  const resolvedDuration = resolveDuration(customDays, preset)
  const submitDisabled = !selectedReason || resolvedDuration == null || mutation.isPending

  // Clear any stale error/success from a previous attempt when the dialog opens.
  useEffect(() => {
    if (open) mutation.reset?.()
  }, [open])

  function resetLocal() {
    setPreset(undefined)
    setCustomDays('')
    setSelectedReason(undefined)
    setNote('')
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetLocal()
    onOpenChange(next)
  }

  function handleConfirm() {
    if (submitDisabled) return
    const trimmedNote = note.trim()
    const reason = trimmedNote ? `${selectedReason}: ${trimmedNote}` : (selectedReason as string)
    // Stay open while the mutation is in flight; close ONLY on success. On error
    // the dialog stays open and surfaces the inline error below.
    mutation.mutate(
      {
        target_user_id: authorUserId,
        duration_days: resolvedDuration!,
        reason,
      },
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
            Suspend author
          </Dialog.Title>
          <Dialog.Description
            fontSize="$2"
            color="$color11"
          >
            {SCOPE_WARNING}
          </Dialog.Description>

          {/* ─── Duration: presets + custom days ───────────────────────────── */}
          <RadioGroup
            value={preset ?? ''}
            onValueChange={(v) => setPreset(v)}
          >
            <YStack gap="$2">
              {DURATION_PRESETS.map(({ value, label }) => (
                <XStack
                  key={value}
                  alignItems="center"
                  gap="$2"
                >
                  <RadioGroup.Item
                    value={value}
                    id={`suspend-preset-${value}`}
                  />
                  <Label
                    htmlFor={`suspend-preset-${value}`}
                    fontSize="$3"
                  >
                    {label}
                  </Label>
                </XStack>
              ))}
            </YStack>
          </RadioGroup>

          <Input
            value={customDays}
            onChangeText={setCustomDays}
            placeholder="Custom days"
            keyboardType="numeric"
            fontSize="$2"
            borderColor="$color3"
          />

          {/* ─── Reason ─────────────────────────────────────────────────────── */}
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
                    id={`suspend-reason-${code}`}
                  />
                  <Label
                    htmlFor={`suspend-reason-${code}`}
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

export default SuspendUserDialog
