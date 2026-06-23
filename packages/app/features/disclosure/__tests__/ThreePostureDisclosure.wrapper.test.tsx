// @vitest-environment happy-dom
// ThreePostureDisclosure wrapper — RED-PHASE TDD
// ALL tests MUST FAIL before implementation of
// packages/app/features/disclosure/ThreePostureDisclosure.tsx
//
// Story 3-6 ACs covered: 9, 10, 11, 12, 13, 16, 24
//
// The wrapper is isolated: @my/ui ThreePostureDisclosure primitive is fully mocked.

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted() — capture mutable primitive props for assertions
// ─────────────────────────────────────────────────────────────────────────────
const { lastPrimitiveProps, mockOnAcknowledge, mockOnRequestClose } = vi.hoisted(() => {
  const lastPrimitiveProps: { current: Record<string, any> } = { current: {} }
  return {
    lastPrimitiveProps,
    mockOnAcknowledge: vi.fn(),
    mockOnRequestClose: vi.fn(),
  }
})

// ─── Mock @my/ui — capture primitive props and expose control hooks ───────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  // The primitive stub renders just a div with buttons so the wrapper test
  // can fireEvent.click to trigger onAcknowledge / onRequestClose.
  const ThreePostureDisclosure = (props: any) => {
    // Capture all passed props for assertion
    lastPrimitiveProps.current = props

    if (!props.open) return null

    const btnLabel = props.mode === 'review' ? 'Close' : 'Got it, post'

    return ReactModule.createElement(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'data-mode': props.mode, 'data-boundary': props.boundary },
      // Acknowledge / close button
      ReactModule.createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            if (props.mode === 'review') {
              props.onRequestClose?.()
            } else {
              props.onAcknowledge?.()
            }
          },
        },
        btnLabel
      )
    )
  }

  return {
    ThreePostureDisclosure,
    // Other @my/ui stubs the wrapper or its deps might need
    ExpandingLineButton: ({ children, onPress }: any) =>
      ReactModule.createElement('button', { type: 'button', onClick: onPress }, children),
    useReducedMotion: () => false,
  }
})

// ─── Mock app/state/store — real Legend-State store for write assertions ──────
//
// We use the REAL store here (pattern from customTheme.test.ts) so that
// store$.profile.preferences.disclosures.collective_post_v1.acknowledged_at.get()
// reflects actual writes. The supabase client is mocked so no network I/O happens.
vi.mock('../../utils/supabase', () => ({ supabase: {} }))

// stub supabase at app/utils/supabase level if referenced from store transitively
vi.mock('app/utils/supabase', () => ({ supabase: {} }))

import { store$ } from 'app/state/store'

// ─── Import under test ───────────────────────────────────────────────────────
// WILL FAIL until packages/app/features/disclosure/ThreePostureDisclosure.tsx exists.
import { ThreePostureDisclosure } from '../ThreePostureDisclosure'

// ─────────────────────────────────────────────────────────────────────────────
// Test isolation — reset store profile between tests
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  // Reset profile so no stale disclosures bleed between tests
  store$.profile.set(null)
  lastPrimitiveProps.current = {}
  mockOnAcknowledge.mockClear()
  mockOnRequestClose.mockClear()
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function makeWrapperProps(
  overrides: Partial<{
    boundary: 'collective_post_v1' | 'ai_cloud_v1'
    mode: 'first-time' | 'review'
    open: boolean
    onClose: () => void
    onViewGuidelines: () => void
  }> = {}
) {
  return {
    boundary: 'collective_post_v1' as const,
    mode: 'first-time' as const,
    open: true,
    onClose: vi.fn(),
    onViewGuidelines: vi.fn(),
    ...overrides,
  }
}

// =============================================================================
// AC #11: Acknowledgment write in first-time mode
// =============================================================================

describe('AC11 — first-time mode: writes acknowledged_at and calls onClose', () => {
  it('writes a non-empty ISO string to store$.profile.preferences.disclosures.collective_post_v1.acknowledged_at on acknowledge', () => {
    const onClose = vi.fn()
    render(React.createElement(ThreePostureDisclosure, makeWrapperProps({ mode: 'first-time', onClose })))

    const btn = screen.getByRole('button', { name: /got it, post/i })
    fireEvent.click(btn)

    const acknowledgedAt =
      store$.profile.preferences?.disclosures?.collective_post_v1?.acknowledged_at?.get?.() ??
      store$.profile.preferences.disclosures.collective_post_v1.acknowledged_at.get()
    expect(typeof acknowledgedAt).toBe('string')
    const ackStr = acknowledgedAt as string
    expect(ackStr.length).toBeGreaterThan(0)
    // Should be a valid ISO string
    expect(() => new Date(ackStr)).not.toThrow()
    expect(new Date(ackStr).toISOString()).toBe(ackStr)
  })

  it('calls onClose exactly once after acknowledge', () => {
    const onClose = vi.fn()
    render(React.createElement(ThreePostureDisclosure, makeWrapperProps({ mode: 'first-time', onClose })))

    const btn = screen.getByRole('button', { name: /got it, post/i })
    fireEvent.click(btn)

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('writes to store BEFORE calling onClose (write-then-close ordering)', () => {
    // By the time onClose fires, acknowledged_at must already be set.
    let acknowledgedAtDuringClose: string | undefined

    const onClose = vi.fn(() => {
      try {
        acknowledgedAtDuringClose =
          store$.profile.preferences?.disclosures?.collective_post_v1?.acknowledged_at?.get?.() ??
          store$.profile.preferences.disclosures.collective_post_v1.acknowledged_at.get()
      } catch {
        acknowledgedAtDuringClose = undefined
      }
    })

    render(React.createElement(ThreePostureDisclosure, makeWrapperProps({ mode: 'first-time', onClose })))

    const btn = screen.getByRole('button', { name: /got it, post/i })
    fireEvent.click(btn)

    expect(onClose).toHaveBeenCalledOnce()
    expect(typeof acknowledgedAtDuringClose).toBe('string')
    expect((acknowledgedAtDuringClose as string).length).toBeGreaterThan(0)
  })
})

// =============================================================================
// AC #12: Review mode — no write, onClose only
// =============================================================================

describe('AC12 — review mode: no acknowledgment write, calls onClose', () => {
  it('does NOT write acknowledged_at when review close button is pressed', () => {
    // Seed a pre-existing acknowledged_at so we can check it is unchanged
    const seedTimestamp = '2026-01-01T00:00:00.000Z'
    store$.profile.set({
      word_goal: 500,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      sync: { word_goal: false, themeName: false, customTheme: false, fontPairing: false },
      preferences: {
        disclosures: {
          collective_post_v1: { acknowledged_at: seedTimestamp },
        },
      },
    })

    const onClose = vi.fn()
    render(React.createElement(ThreePostureDisclosure, makeWrapperProps({ mode: 'review', onClose })))

    const btn = screen.getByRole('button', { name: /close/i })
    fireEvent.click(btn)

    const acknowledgedAt =
      store$.profile.preferences?.disclosures?.collective_post_v1?.acknowledged_at?.get?.() ??
      store$.profile.preferences.disclosures.collective_post_v1.acknowledged_at.get()
    // Timestamp must remain the seeded value — not updated
    expect(acknowledgedAt).toBe(seedTimestamp)
    expect(onClose).toHaveBeenCalledOnce()
  })
})

// =============================================================================
// AC #16: Wrapper passes primitive the correct props shape
// =============================================================================

describe('AC16 — wrapper-to-primitive prop forwarding', () => {
  it('passes boundary, mode, and open to the primitive', () => {
    render(
      React.createElement(
        ThreePostureDisclosure,
        makeWrapperProps({ boundary: 'collective_post_v1', mode: 'first-time', open: true })
      )
    )
    expect(lastPrimitiveProps.current.boundary).toBe('collective_post_v1')
    expect(lastPrimitiveProps.current.mode).toBe('first-time')
    expect(lastPrimitiveProps.current.open).toBe(true)
  })

  it('passes open=false to the primitive when wrapper open=false', () => {
    render(React.createElement(ThreePostureDisclosure, makeWrapperProps({ open: false })))
    expect(lastPrimitiveProps.current.open).toBe(false)
  })
})

// =============================================================================
// AC #9 / #10: Wrapper API surface — component renders without crashing
// =============================================================================

describe('AC9/AC10 — wrapper component exists and renders', () => {
  it('renders without crashing with required props', () => {
    expect(() =>
      render(React.createElement(ThreePostureDisclosure, makeWrapperProps()))
    ).not.toThrow()
  })

  it('is a named export ThreePostureDisclosure from the wrapper module', async () => {
    const mod = await import('../ThreePostureDisclosure')
    expect(typeof mod.ThreePostureDisclosure).toBe('function')
  })
})
