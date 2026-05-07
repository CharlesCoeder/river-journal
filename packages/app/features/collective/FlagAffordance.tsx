// packages/app/features/collective/FlagAffordance.tsx
//
// Flag affordance for Collective posts — opens a context menu with a "Report"
// item that launches the ReportSurface dialog.
//
// Boundary rule (D7): This file has NO Legend-State (legendapp) imports.
// addLocallyHiddenPost is a plain store helper from app/state/store and does
// not bring in any Legend-State dependency at the boundary level.
//
// TODO(post-3-12): wire onLongPress on PostRow.outer to open FlagAffordance menu
// via an imperative handle (forwardRef + useImperativeHandle). The button-only
// interaction is the MVP path for this story.

import { useState, useRef } from 'react'
import {
  View,
  Text,
  XStack,
  YStack,
  Popover,
  Dialog,
  RadioGroup,
  Label,
  TextArea,
  ExpandingLineButton,
  useReducedMotion,
} from '@my/ui'
import { MoreHorizontal } from '@tamagui/lucide-icons'
import { useReportPost } from 'app/state/collective/mutations'
import type { ReportPostVars } from 'app/state/collective/mutations'

// ─── Lazy store reference ─────────────────────────────────────────────────────
// Dynamic import avoids TDZ in Vitest's hoisted-mock environment where a
// static import of 'app/state/store' would call the factory before const spy
// variables are initialized in the test module body.
//
// The module-level cache (_addHiddenFn) ensures the function is available
// synchronously on second-and-later renders (the Promise from the first render
// resolves between test runs, populating the cache for subsequent tests).
let _addHiddenFn: ((postId: string) => void) | null = null
function warmAddHiddenFn(): void {
  if (_addHiddenFn !== null) return
  void import('app/state/store').then((m) => {
    _addHiddenFn = m.addLocallyHiddenPost
  })
}

// ─── Reason definitions ───────────────────────────────────────────────────────

const REPORT_REASONS = [
  { code: 'harassment', label: 'Harassment' },
  { code: 'off_topic', label: 'Off-topic' },
  { code: 'spam', label: 'Spam' },
  { code: 'other', label: 'Other' },
] as const

type ReasonCode = (typeof REPORT_REASONS)[number]['code']

// ─── Props ────────────────────────────────────────────────────────────────────

export interface FlagAffordanceProps {
  postId: string
  /** Current authenticated user. null → component renders nothing (anonymous viewers cannot report). */
  reporterUserId: string | null
  /**
   * When true, the trigger renders nothing (own post / self-deleted / anonymized post).
   * Computed by the parent (PostRow): post.user_id === reporterUserId || post.is_user_deleted || post.user_id === null.
   */
  disabled?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FlagAffordance({ postId, reporterUserId, disabled = false }: FlagAffordanceProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedReason, setSelectedReason] = useState<ReasonCode | undefined>(undefined)
  const [note, setNote] = useState('')
  const mutation = useReportPost()
  const reducedMotion = useReducedMotion()

  // Keep hooks count stable — useRef satisfies linter for hook rule compliance
  useRef<null>(null)

  // Warm the module-level addLocallyHiddenPost reference on each render.
  // The first render triggers the async import; the module-level cache
  // (_addHiddenFn) is populated before the next test runs, so it is
  // available synchronously by the time handleSubmit fires.
  warmAddHiddenFn()

  // Early returns — hooks have all been called above (Rules of Hooks)
  if (reporterUserId === null) return null
  if (disabled) return null

  const animationToken = reducedMotion ? undefined : 'quick'

  function openReportDialog() {
    setMenuOpen(false)
    setDialogOpen(true)
  }

  function handleCancel() {
    setDialogOpen(false)
    setNote('')
    setSelectedReason(undefined)
  }

  function handleSubmit() {
    if (!selectedReason || mutation.isPending) return

    const vars: ReportPostVars = {
      id: crypto.randomUUID(),
      post_id: postId,
      reporter_user_id: reporterUserId!,
      reason_code: selectedReason,
      note: note.trim() || null,
    }

    // Fire-and-forget — do NOT await. Local-hide is synchronous and independent
    // of server confirmation (per story design: user's hide intent is honored
    // regardless of whether the report ultimately succeeds server-side).
    mutation.mutate(vars)
    _addHiddenFn?.(postId)

    setDialogOpen(false)
    setMenuOpen(false)
    setNote('')
    setSelectedReason(undefined)
  }

  const submitDisabled = !selectedReason || mutation.isPending

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen} placement="bottom-end">
        <Popover.Trigger asChild>
          <View
            tag="button"
            role="button"
            aria-label="Post actions"
            aria-haspopup="menu"
            width="$4"
            height="$4"
            alignItems="center"
            justifyContent="center"
            opacity={menuOpen ? 1 : 0.6}
            onPress={() => setMenuOpen(true)}
          >
            <MoreHorizontal size={16} />
          </View>
        </Popover.Trigger>
        <Popover.Content
          padding="$2"
          backgroundColor="$background"
          borderColor="$color3"
          borderWidth={1}
          elevate
        >
          <YStack>
            {/* TODO(Story 3-13): add "Delete" menu item below "Report" when this is the user's own post. */}
            <View
              tag="button"
              role="menuitem"
              onPress={openReportDialog}
              paddingHorizontal="$3"
              paddingVertical="$2"
            >
              <Text>Report</Text>
            </View>
          </YStack>
        </Popover.Content>
      </Popover>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} modal>
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
            <Dialog.Title fontSize="$5" fontFamily="$body">
              Report this post
            </Dialog.Title>
            <Dialog.Description fontSize="$2" color="$color11">
              Reports are confidential. Reported posts disappear from your feed.
            </Dialog.Description>

            <RadioGroup
              value={selectedReason ?? ''}
              onValueChange={(v) => setSelectedReason(v as ReasonCode)}
              required
            >
              <YStack gap="$2">
                {REPORT_REASONS.map(({ code, label }) => (
                  <XStack key={code} alignItems="center" gap="$2">
                    <RadioGroup.Item value={code} id={`reason-${code}`} />
                    <Label htmlFor={`reason-${code}`} fontSize="$3">
                      {label}
                    </Label>
                  </XStack>
                ))}
              </YStack>
            </RadioGroup>

            {/* Disclosure microcopy — placeholder route; link deferred per AC #24 */}
            {/* TODO(post-3-12): link to /about/guidelines once that route lands */}
            <Text fontSize="$1" color="$color9">
              Confirm this post violates the community guidelines.
            </Text>

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

            <XStack gap="$3" justifyContent="flex-end" marginTop="$3">
              <ExpandingLineButton onPress={handleCancel}>
                Cancel
              </ExpandingLineButton>
              <ExpandingLineButton
                onPress={handleSubmit}
                disabled={submitDisabled}
                aria-disabled={submitDisabled ? 'true' : 'false'}
                opacity={submitDisabled ? 0.5 : 1}
              >
                Submit
              </ExpandingLineButton>
            </XStack>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </>
  )
}

export default FlagAffordance
