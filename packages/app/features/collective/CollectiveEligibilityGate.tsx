/**
 * CollectiveEligibilityGate
 *
 * Renders an explainer card whenever the current user is NOT eligible to
 * post to the Collective; otherwise renders `children` unchanged.
 *
 * STRUCTURAL invariant: this file MUST NOT import the Collective Lexical
 * editor. The editor is reached only through `children` in the eligible
 * branch (early-return on every non-eligible state) — that is the
 * structural guarantee that the editor doesn't mount for ineligible users.
 *
 * Precedence is owned by `useCollectiveEligibility`:
 *   loading → unauthenticated → suspended → sync-disabled → not-qualified → eligible
 *
 * `variant='compact'` is used inline inside ThreadView's reply slot. In that
 * variant every non-eligible branch renders a small Cancel button that calls
 * `onCancel` so the slot can be closed (PostComposer never mounts in those
 * branches, so its own `onCancelled` would never fire).
 */

import React, { type ReactNode } from 'react'
import { ExpandingLineButton, Text, XStack, YStack } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { useCollectiveEligibility } from './useCollectiveEligibility'

export interface CollectiveEligibilityGateProps {
  children: ReactNode
  variant?: 'full' | 'compact'
  onCancel?: () => void
}

export function CollectiveEligibilityGate({
  children,
  variant = 'full',
  onCancel,
}: CollectiveEligibilityGateProps) {
  const { status } = useCollectiveEligibility()
  const router = useRouter()

  const compact = variant === 'compact'

  // Cancel affordance — visible on EVERY non-eligible branch in compact
  // variant so the inline reply slot can be dismissed (the editor never
  // mounts here, so its own Cancel button never renders).
  const cancelButton =
    compact && onCancel ? (
      <ExpandingLineButton onPress={onCancel}>Cancel</ExpandingLineButton>
    ) : null

  // ─── loading ─────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <YStack
        gap="$2"
        padding={compact ? '$2' : '$4'}
        data-testid="eligibility-gate-loading"
      >
        <YStack
          height={compact ? 60 : 120}
          backgroundColor="$color3"
          opacity={0.6}
          borderRadius={0}
          data-testid="eligibility-gate-skeleton"
        />
        {cancelButton}
      </YStack>
    )
  }

  // ─── unauthenticated ─────────────────────────────────────────────────────
  if (status === 'unauthenticated') {
    return (
      <YStack
        gap="$2"
        padding={compact ? '$2' : '$4'}
        data-testid="eligibility-gate-unauthenticated"
      >
        <Text>Sign in to post.</Text>
        <XStack gap="$2">
          <ExpandingLineButton onPress={() => router.push('/auth')}>
            Sign in
          </ExpandingLineButton>
          {cancelButton}
        </XStack>
      </YStack>
    )
  }

  // ─── suspended ───────────────────────────────────────────────────────────
  if (status === 'suspended') {
    return (
      <YStack
        gap="$2"
        padding={compact ? '$2' : '$4'}
        data-testid="eligibility-gate-suspended"
      >
        <Text>Posting and reacting are paused for this account.</Text>
        {cancelButton}
      </YStack>
    )
  }

  // ─── sync-disabled ───────────────────────────────────────────────────────
  if (status === 'sync-disabled') {
    return (
      <YStack
        gap="$2"
        padding={compact ? '$2' : '$4'}
        data-testid="eligibility-gate-sync-disabled"
      >
        <Text fontSize="$5">Sync needs to be on to post.</Text>
        <Text fontSize="$2" color="$color11">
          The server checks your 500-word streak using only the word counts of your
          encrypted entries. Your journal content itself stays encrypted end-to-end —
          even we can't read it.
        </Text>
        <XStack gap="$2">
          <ExpandingLineButton onPress={() => router.push('/settings')}>
            Open Settings
          </ExpandingLineButton>
          {cancelButton}
        </XStack>
      </YStack>
    )
  }

  // ─── not-qualified ───────────────────────────────────────────────────────
  if (status === 'not-qualified') {
    return (
      <YStack
        gap="$2"
        padding={compact ? '$2' : '$4'}
        data-testid="eligibility-gate-not-qualified"
      >
        <Text fontSize="$5">Write 500 words today to post to the Collective.</Text>
        <Text fontSize="$2" color="$color11">
          Your streak in the Journal unlocks posting here.
        </Text>
        <XStack gap="$2">
          <ExpandingLineButton onPress={() => router.push('/journal')}>
            Open Journal
          </ExpandingLineButton>
          {cancelButton}
        </XStack>
      </YStack>
    )
  }

  // ─── eligible ────────────────────────────────────────────────────────────
  return <>{children}</>
}

export default CollectiveEligibilityGate
