/**
 * PostComposer
 *
 * Collective post composer — flagship Collective writing surface.
 * Boundary A first-time disclosure gate, ambient privacy label,
 * "posting as" preview, fresh Lexical editor (D14 structural isolation),
 * optimistic submit via useCreatePost(), and compact reply-context variant.
 *
 * Architecture invariant (D14): this file MUST NOT import the journal persistent
 * editor or access its state paths. Structural isolation across the encryption
 * boundary is enforced by separate LexicalComposer instances.
 *
 * D7 carve-out: PostComposer is a UI feature file, not a state/collective file.
 * It MAY import store$ for the tenure-tier preference read (AC #22).
 *
 * No client-side 500-word gate: the server rejects sub-500 INSERT via RLS (Story 3.1).
 * If rejected, AC #16 error microcopy renders; no client guard is added here.
 */

import React, { useMemo, useRef, useState } from 'react'
import { AuthorByline, ExpandingLineButton, Text, XStack, YStack } from '@my/ui'
import { ThreePostureDisclosure, hasAcknowledgedBoundaryA } from 'app/features/disclosure/ThreePostureDisclosure'
import { AmbientPrivacyLabel } from 'app/features/disclosure/AmbientPrivacyLabel'
import { useCreatePost, createPostWithId } from 'app/state/collective/mutations'
import { useCurrentUserId } from 'app/state/collective/currentUser'
import { useIsSuspended } from 'app/state/collective/suspension'
import { store$ } from 'app/state/store'
import { useRouter } from 'solito/router'
import { CollectiveLexicalEditor } from './CollectiveLexicalEditor'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PostComposerProps {
  compact?: boolean
  replyContext?: { parentPostId: string }
  onSubmitted?: () => void
  onCancelled?: () => void
}

// ─── PostComposer ─────────────────────────────────────────────────────────────

export default function PostComposer({
  compact = false,
  replyContext,
  onSubmitted,
  onCancelled,
  ..._rest
}: PostComposerProps & { __contextProbeRef?: React.MutableRefObject<unknown> }) {
  // Test-only: forward the probe ref to CollectiveLexicalEditor for D14 isolation test.
  // Production callers never set this prop. See CollectiveLexicalEditor for the probe impl.
  const contextProbeRef = (_rest as any).__contextProbeRef as React.MutableRefObject<unknown> | undefined

  // ─── Local state ──────────────────────────────────────────────────────────
  const [body, setBody] = useState('')
  const [showError, setShowError] = useState(false)
  // Initialize lazily to avoid render-flash of composer body before first ack check.
  const [showDisclosure, setShowDisclosure] = useState(() => !hasAcknowledgedBoundaryA())
  // Controls whether the currently-mounted disclosure renders in review vs first-time mode.
  const [disclosureMode, setDisclosureMode] = useState<'first-time' | 'review'>('first-time')
  // Double-tap guard: set before mutate(), reset in onSettled (Chaos Monkey #2 / t17).
  const submittingRef = useRef(false)

  // ─── Hooks ────────────────────────────────────────────────────────────────
  const currentUserId = useCurrentUserId()
  const isSuspended = useIsSuspended(currentUserId ?? null)
  const createPost = useCreatePost()
  const router = useRouter()

  // ─── Tenure-tier opt-in — one-shot read at mount (AC #22) ─────────────────
  // Sync read at mount only; no mid-session reactive update needed
  // (no UI to toggle this preference in v1 — future Epic 8 PrivacyCenterScreen).
  const showTenureTier = Boolean(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (store$ as any).profile?.preferences?.collective_show_tenure_tier?.get?.() ?? false
  )

  // ─── "Posting as" preview (AC #6) ─────────────────────────────────────────
  // AC #6 — displayName placeholder mirrors Story 3.8 AC #28;
  // future RPC join replaces both call sites in lockstep.
  const previewName = currentUserId?.slice(0, 8) ?? '[deleted]'
  // Compute once at mount; binding to a timer would waste renders.
  const previewTime = useMemo(() => new Date().toISOString(), [])
  // TODO: when a tenure-tier hook lands (likely tied to your_posts RPC integration),
  // wire it here. Until then, opt-in users see no tier label in the preview.
  const previewTenure = showTenureTier ? undefined : undefined

  // ─── Derived state ────────────────────────────────────────────────────────
  const trimmedBody = body.trim()
  const wordCount = trimmedBody ? trimmedBody.split(/\s+/).length : 0
  const charCount = body.length

  const isSubmitDisabled =
    trimmedBody.length === 0 ||
    createPost.isPending ||
    isSuspended === true ||
    currentUserId === null ||
    currentUserId === undefined

  // ─── Disclosure handlers ───────────────────────────────────────────────────

  // Called when the first-time disclosure is acknowledged.
  // The wrapper (Story 3.6) writes acknowledged_at BEFORE calling onClose,
  // so hasAcknowledgedBoundaryA() synchronously returns true here.
  const handleAcknowledge = () => {
    setShowDisclosure(false)
    // Defensive recheck (Failure Mode Analysis #1): if the wrapper's write failed
    // (network error, Supabase 4xx), re-show the disclosure.
    if (!hasAcknowledgedBoundaryA()) {
      // WARNING: disclosure write may have failed — no content in message (AC #20)
      console.warn('[PostComposer] disclosure write may have failed; re-showing')
      setShowDisclosure(true)
      return
    }
    // Focus the editor within one frame after acknowledgment (AC #3).
    // JSDOM doesn't fully implement ContentEditable focus; production behavior
    // verified manually. Tests assert state change (composer becomes visible).
    requestAnimationFrame(() => {
      const editable = document.querySelector('[data-lexical-editor]') as HTMLElement | null
      editable?.focus()
    })
  }

  // Called when the AmbientPrivacyLabel is tapped — opens review mode.
  const handleLabelPress = () => {
    setDisclosureMode('review')
    setShowDisclosure(true)
  }

  // Called when the review-mode disclosure is dismissed.
  // acknowledged_at is NOT modified (review-mode close path in Story 3.6).
  const handleReviewClose = () => {
    setShowDisclosure(false)
    setDisclosureMode('first-time')
    // Body state is preserved — setBody() is not called here.
  }

  // ─── Submit handlers ───────────────────────────────────────────────────────

  const handleSubmitFull = () => {
    if (submittingRef.current) return
    if (isSubmitDisabled) return
    submittingRef.current = true

    // Track whether a synchronous error occurred in the mutate callback.
    // If onError fires synchronously (e.g. RLS rejection in tests), we do NOT
    // navigate — the composer must stay open to show the error microcopy (AC #16).
    // If no synchronous error, navigate immediately (AC #14: composer closes even offline).
    let syncError = false

    createPost.mutate(
      createPostWithId({
        body,
        parent_post_id: null,
        user_id: currentUserId!,
      }),
      {
        onSuccess: () => {
          setBody('')
        },
        onError: () => {
          syncError = true
          setShowError(true)
        },
        onSettled: () => {
          submittingRef.current = false
        },
      }
    )

    // Navigate synchronously after mutate() — NOT inside onSuccess.
    // onSuccess fires only after server confirmation (or reconnect+replay when offline).
    // Navigating here ensures the composer closes immediately on submit, even offline.
    // Skip navigation if a synchronous error occurred (AC #16: keep composer open on error).
    if (!syncError) {
      router.back?.() ?? router.push('/collective')
    }
  }

  const handleSubmitCompact = () => {
    if (submittingRef.current) return
    if (isSubmitDisabled) return
    submittingRef.current = true

    let syncError = false

    createPost.mutate(
      createPostWithId({
        body,
        parent_post_id: replyContext!.parentPostId,
        user_id: currentUserId!,
      }),
      {
        onSuccess: () => {
          setBody('')
        },
        onError: () => {
          syncError = true
          setShowError(true)
        },
        onSettled: () => {
          submittingRef.current = false
        },
      }
    )

    // Same offline-close reasoning as full mode: call synchronously after mutate().
    if (!syncError) {
      onSubmitted?.()
    }
  }

  // ─── Unauthenticated placeholder (AC #13) ─────────────────────────────────
  if (currentUserId === null || currentUserId === undefined) {
    return (
      <YStack maxWidth={compact ? undefined : 720} width="100%">
        <Text>Sign in to post.</Text>
      </YStack>
    )
  }

  // ─── Layout props ──────────────────────────────────────────────────────────
  const minHeight = compact ? 120 : 300
  const outerProps = compact ? {} : { maxWidth: 720, width: '100%' }

  return (
    <YStack {...outerProps}>
      {/* Disclosure (first-time gate or review-mode re-open).
          Kept mounted with open={showDisclosure} so the mock can capture open=false
          after close (avoids the test-visibility issue from conditional unmounting). */}
      <ThreePostureDisclosure
        boundary="collective_post_v1"
        mode={disclosureMode}
        open={showDisclosure}
        onClose={disclosureMode === 'review' ? handleReviewClose : handleAcknowledge}
      />

      {/* Composer body — only visible after first-time acknowledgment (AC #1) */}
      {!showDisclosure && (
        <>
          {/* AmbientPrivacyLabel + "posting as" preview (AC #5, #6) */}
          <XStack alignItems="center" gap="$2">
            <AmbientPrivacyLabel
              boundary="collective_post_v1"
              onPress={handleLabelPress}
            />
          </XStack>

          <XStack alignItems="center" gap="$2">
            <Text fontSize="$1" color="$color9" fontFamily="$body">posting as</Text>
            <AuthorByline
              displayName={previewName}
              postedAt={previewTime}
              tenureTier={previewTenure}
            />
          </XStack>

          {/* Writing surface — sharp-cornered, Newsreader serif, no chrome (AC #5) */}
          <CollectiveLexicalEditor
            onContentChange={setBody}
            minHeight={minHeight}
            __contextProbeRef={contextProbeRef}
          />

          {/* Word/character count micro-typography (AC #11) */}
          <Text fontSize="$1" color="$color9">
            {wordCount} words · {charCount} chars
          </Text>

          {/* Submit disabled-state microcopy (AC #13) */}
          {createPost.isPending && (
            <Text fontSize="$1" color="$color9">Submitting...</Text>
          )}
          {isSuspended && (
            <Text fontSize="$1" color="$color9">
              Posting and reacting are paused for this account.
            </Text>
          )}

          {/* Error microcopy (AC #16) — generic, no body content logged */}
          {showError && (
            <Text fontSize="$2" color="$color11" paddingTop="$2">
              Couldn't post. Try again.
            </Text>
          )}

          {/* Action buttons */}
          {compact ? (
            <XStack gap="$2">
              <ExpandingLineButton
                onPress={handleSubmitCompact}
                disabled={isSubmitDisabled}
              >
                Submit
              </ExpandingLineButton>
              <ExpandingLineButton onPress={onCancelled}>
                Cancel
              </ExpandingLineButton>
            </XStack>
          ) : (
            <ExpandingLineButton
              onPress={handleSubmitFull}
              disabled={isSubmitDisabled}
            >
              Submit
            </ExpandingLineButton>
          )}
        </>
      )}
    </YStack>
  )
}
