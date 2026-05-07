/**
 * AmbientPrivacyLabel
 *
 * Persistent ambient label shown above the composer after Boundary A acknowledgment.
 * Tapping re-opens the corresponding disclosure in `mode: 'review'` so users can
 * re-read the privacy copy without resetting their acknowledgment timestamp.
 *
 * Consumers (PostComposer, Story 3.9) mount this component ONLY after acknowledgment —
 * the label itself does NOT gate on acknowledgment state (AC #21).
 *
 * Imports: tamagui + the wrapper ThreePostureDisclosure. NO @tanstack/react-query (AC #22).
 */

import React, { useState } from 'react'
import { Pressable, Text, YStack } from 'tamagui'
import type { DisclosureBoundary } from './ThreePostureDisclosure'
import { ThreePostureDisclosure } from './ThreePostureDisclosure'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AmbientPrivacyLabelProps {
  boundary: DisclosureBoundary
  /**
   * For Boundary B Growth-phase: the named provider (e.g. "Anthropic").
   * When set, renders "CLOUD · {provider}". When unset, renders "LOCAL".
   * Unused for Boundary A.
   */
  provider?: string
  /**
   * Optional: override the internal review-open handler. When provided (e.g. by
   * PostComposer managing its own disclosure state), the label calls this instead
   * of its internal setReviewOpen(true). The label's own internal review disclosure
   * is suppressed when this prop is set.
   */
  onPress?: () => void
}

// ─────────────────────────────────────────────────────────────────────────────

export function AmbientPrivacyLabel({ boundary, provider, onPress: onPressProp }: AmbientPrivacyLabelProps) {
  // Local state: controls review-mode disclosure open/close.
  // When onPressProp is provided (e.g. by PostComposer managing its own disclosure
  // state), the label delegates to it and suppresses its own internal review disclosure.
  const [reviewOpen, setReviewOpen] = useState(false)

  const labelText = getLabelText(boundary, provider)

  const handlePress = onPressProp ?? (() => setReviewOpen(true))

  return (
    <YStack>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Re-open privacy disclosure"
        onPress={handlePress}
      >
        <Text
          fontFamily="$body"
          fontSize="$2"
          letterSpacing={0.08}
          textTransform="uppercase"
          color="$stone"
        >
          {labelText}
        </Text>
      </Pressable>

      {/* Review-mode disclosure — mounted inline; self-contained.
          Suppressed when onPressProp is provided (parent manages disclosure state). */}
      {!onPressProp && reviewOpen && (
        <ThreePostureDisclosure
          boundary={boundary}
          mode="review"
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </YStack>
  )
}

// ─── Label text derivation ────────────────────────────────────────────────────

function getLabelText(boundary: DisclosureBoundary, provider?: string): string {
  switch (boundary) {
    case 'collective_post_v1':
      return 'VISIBLE TO THE COLLECTIVE'
    case 'ai_cloud_v1':
      // Boundary B Growth-phase: structurally implemented, not exercised in this story.
      // The Growth-phase consumer will mount this with a real provider name.
      return provider ? `CLOUD · ${provider}` : 'LOCAL'
    default:
      return ''
  }
}
