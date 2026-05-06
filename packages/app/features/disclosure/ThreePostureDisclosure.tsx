/**
 * ThreePostureDisclosure — boundary-keyed wrapper
 *
 * Wires the presentational primitive to Legend-State acknowledgment persistence.
 * Only this file (and its consumers) should import from @my/ui's primitive — all
 * side effects (acknowledgment write, etc.) live here, not in the primitive.
 *
 * Version-key design: acknowledgment state is keyed per disclosure version
 * (e.g. `collective_post_v1`). A future `collective_post_v2` key would
 * re-prompt automatically because the consumer reads the v1 key directly.
 * No migration path is needed — versioned keys = independent acknowledgment state.
 */

import React from 'react'
import { ThreePostureDisclosure as ThreePostureDisclosurePrimitive } from '@my/ui'
import type { DisclosureBoundary, DisclosureMode } from '@my/ui'
import { store$ } from 'app/state/store'

// ─── Re-export types for consumers ───────────────────────────────────────────
export type { DisclosureBoundary, DisclosureMode }

// ─── Wrapper props ────────────────────────────────────────────────────────────

export interface ThreePostureDisclosureWrapperProps {
  boundary: DisclosureBoundary
  mode: DisclosureMode
  open: boolean
  /** Called after acknowledgment (first-time) OR after review-mode dismiss. */
  onClose: () => void
  onViewGuidelines?: () => void
}

// ─────────────────────────────────────────────────────────────────────────────

export function ThreePostureDisclosure({
  boundary,
  mode,
  open,
  onClose,
  onViewGuidelines,
}: ThreePostureDisclosureWrapperProps) {
  // Dev-mode safeguard: Boundary B ('ai_cloud_v1') acknowledgment write is not
  // implemented yet (Growth phase). Warn loudly in development so future integrators
  // know the boundary is structurally reserved — the primitive renders null for it,
  // making it a silent no-op in production without this guard.
  if (process.env.NODE_ENV !== 'production' && boundary === 'ai_cloud_v1') {
    console.warn(
      'Boundary B disclosure is structurally reserved; acknowledgment write is not implemented yet.'
    )
  }

  const handleAcknowledge = () => {
    if (mode === 'first-time' && boundary === 'collective_post_v1') {
      // Write BEFORE calling onClose so that a parent checking
      // hasAcknowledgedBoundaryA() synchronously inside onClose sees the
      // acknowledged state immediately.
      const now = new Date().toISOString()
      store$.profile.preferences.disclosures.collective_post_v1.set({ acknowledged_at: now })
    }
    onClose()
  }

  const handleRequestClose = () => {
    // review-mode dismiss: do NOT touch users.preferences — the acknowledgment
    // timestamp is preserved unchanged across review opens.
    onClose()
  }

  return (
    <ThreePostureDisclosurePrimitive
      boundary={boundary}
      mode={mode}
      open={open}
      onAcknowledge={handleAcknowledge}
      onRequestClose={handleRequestClose}
      onViewGuidelines={onViewGuidelines}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// hasAcknowledgedBoundaryA — synchronous helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the current user has acknowledged Boundary A
 * (`collective_post_v1` disclosure). Synchronous — safe to call during render.
 *
 * Story 3.9 (PostComposer) calls this during render to decide whether to mount
 * the disclosure. Async would cause a render-flash (un-guarded composer momentarily
 * visible) — sync is correct.
 *
 * A reactive `useHasAcknowledgedBoundaryA()` hook is out of scope; Story 3.9
 * will add it via Legend-State `use$()` if needed.
 */
export function hasAcknowledgedBoundaryA(): boolean {
  try {
    const acknowledgedAt =
      store$.profile.preferences?.disclosures?.collective_post_v1?.acknowledged_at?.get?.() ??
      store$.profile.preferences.disclosures.collective_post_v1.acknowledged_at.get()
    return Boolean(acknowledgedAt)
  } catch {
    // Path does not exist in the observable tree (null profile, missing path, etc.)
    return false
  }
}
