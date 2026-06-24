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

import type React from 'react'
import { useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { AuthorByline, ExpandingLineButton, Text, TextArea, XStack, YStack } from '@my/ui'
import {
  ThreePostureDisclosure,
  hasAcknowledgedBoundaryA,
} from 'app/features/disclosure/ThreePostureDisclosure'
import { AmbientPrivacyLabel } from 'app/features/disclosure/AmbientPrivacyLabel'
import { useCreatePost, createPostWithId } from 'app/state/collective/mutations'
import { useCurrentUserId } from 'app/state/collective/currentUser'
import { store$ } from 'app/state/store'
import { useRouter } from 'solito/navigation'
import CollectiveLexicalEditor from './CollectiveLexicalEditor'

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
  const contextProbeRef = (_rest as any).__contextProbeRef as
    | React.MutableRefObject<unknown>
    | undefined

  // ─── Top-level vs reply ────────────────────────────────────────────────────
  // Title-led redesign (Story 3-16): top-level letters carry a required title;
  // replies carry none (the server CHECK collective_posts_title_chk enforces
  // both — required on top-level, must be NULL on replies — we mirror it here).
  const isTopLevel = !compact && !replyContext

  // ─── Local state ──────────────────────────────────────────────────────────
  const [title, setTitle] = useState('')
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
  const trimmedTitle = title.trim()
  const wordCount = trimmedBody ? trimmedBody.split(/\s+/).length : 0
  const charCount = body.length
  // Soft 200-char guide (architecture): the server CHECK is the hard backstop;
  // the composer just nudges. We never block submit on length alone.
  const TITLE_SOFT_LIMIT = 200
  const titleOverLimit = isTopLevel && trimmedTitle.length > TITLE_SOFT_LIMIT

  // Eligibility gating (auth / suspension / sync / 500-word) is now owned by
  // CollectiveEligibilityGate — when the gate decides we're ineligible the
  // editor never mounts, so we don't repeat those checks in `isSubmitDisabled`.
  // Top-level letters additionally require a non-blank title.
  const isSubmitDisabled =
    trimmedBody.length === 0 || (isTopLevel && trimmedTitle.length === 0) || createPost.isPending

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
    if (typeof document !== 'undefined') {
      requestAnimationFrame(() => {
        const editable = document.querySelector('[data-lexical-editor]') as HTMLElement | null
        editable?.focus()
      })
    }
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
        // Top-level letters are title-led; the title is required above.
        title: trimmedTitle,
        parent_post_id: null,
        user_id: currentUserId!,
      }),
      {
        onSuccess: () => {
          setTitle('')
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
      router.push('/collective')
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

  // ─── Layout props ──────────────────────────────────────────────────────────
  const minHeight = compact ? 120 : 300
  // Compact mode defers width/centering to the parent (ThreadView); standalone
  // mounts self-center.
  const outerProps = compact
    ? {}
    : {
        maxWidth: 720,
        width: '100%',
        marginHorizontal: 'auto',
        padding: '$4',
        gap: '$3',
      }

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
          {/* Eyebrow — title-led composer header (top-level letters only) */}
          {isTopLevel ? (
            <Text
              fontFamily="$body"
              fontSize="$1"
              color="$color9"
              textTransform="uppercase"
              letterSpacing={2}
            >
              A letter to the room
            </Text>
          ) : null}

          {/* AmbientPrivacyLabel + "posting as" preview (AC #5, #6) */}
          <XStack
            alignItems="center"
            gap="$2"
          >
            <AmbientPrivacyLabel
              boundary="collective_post_v1"
              onPress={handleLabelPress}
            />
          </XStack>

          <XStack
            alignItems="center"
            gap="$2"
          >
            <Text
              fontSize="$1"
              color="$color9"
              fontFamily="$body"
            >
              posting as
            </Text>
            <AuthorByline
              displayName={previewName}
              postedAt={previewTime}
              tenureTier={previewTenure}
            />
          </XStack>

          {/* Title field — required, title-led. Top-level letters only; replies
              carry no title (server CHECK forbids it), so the field is hidden in
              compact/reply mode. */}
          {isTopLevel ? (
            <YStack gap="$2">
              <TextArea
                aria-label="Letter title"
                placeholder="A title…"
                value={title}
                onChangeText={setTitle}
                fontFamily="$journal"
                fontSize="$8"
                lineHeight="$8"
                color="$color12"
                borderWidth={0}
                backgroundColor="transparent"
                paddingHorizontal={0}
                rows={1}
              />
              <View style={{ height: 1, width: '100%', backgroundColor: 'rgba(0,0,0,0.10)' }} />
              {titleOverLimit ? (
                <Text
                  fontSize="$1"
                  color="$color11"
                >
                  {trimmedTitle.length}/200 — long titles read best under 200 characters.
                </Text>
              ) : null}
            </YStack>
          ) : null}

          {/* Writing surface — sharp-cornered, Newsreader serif, no chrome (AC #5) */}
          {/*
            Wrapping View gives the editor explicit dimensions. On native the
            `'use dom'` WebView fills its parent View — without an explicit
            height the WebView collapses to a default tiny height and becomes
            untappable. Mirrors the editorWrapper pattern in
            features/journal/components/PersistentEditor.native.tsx:122.
          */}
          <View style={{ width: '100%', height: minHeight }}>
            <CollectiveLexicalEditor
              onContentChange={setBody}
              minHeight={minHeight}
              __contextProbeRef={contextProbeRef}
            />
          </View>

          {/* Word/character count micro-typography (AC #11) */}
          <Text
            fontSize="$1"
            color="$color9"
          >
            {wordCount} words · {charCount} chars
          </Text>

          {/* Submit disabled-state microcopy (AC #13) */}
          {createPost.isPending && (
            <Text
              fontSize="$1"
              color="$color9"
            >
              Submitting...
            </Text>
          )}

          {/* Error microcopy (AC #16) — generic, no body content logged */}
          {showError && (
            <Text
              fontSize="$2"
              color="$color11"
              paddingTop="$2"
            >
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
              <ExpandingLineButton onPress={onCancelled}>Cancel</ExpandingLineButton>
            </XStack>
          ) : (
            <ExpandingLineButton
              onPress={handleSubmitFull}
              disabled={isSubmitDisabled}
            >
              Leave it for the room
            </ExpandingLineButton>
          )}
        </>
      )}
    </YStack>
  )
}
