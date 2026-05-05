// @vitest-environment happy-dom
// useLapsedPrompt() hook — pure 3-clause boolean logic
// Uses deterministic `now` arg. Mocks @legendapp/state/react to control observable reads.

import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { lapsed$, LAPSED_THRESHOLD_MS } from 'app/state/lapsed'

// ─── Mock @legendapp/state/react so use$() reads from the real lapsed$ ────────
// We use the real observable and drive it via lapsed$.set() in each test.
vi.mock('@legendapp/state/react', () => ({
  use$: (obs: any) => obs.get(),
}))

import { useLapsedPrompt } from '../useLapsedPrompt'

const DAY_MS = 24 * 60 * 60 * 1000
const T0 = 1_700_000_000_000

beforeEach(() => {
  lapsed$.set({ lastSessionAt: null, dismissedAt: null, hasOpenedBefore: false })
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. First-time user — shouldShow is false (AC2, AC6)
// ─────────────────────────────────────────────────────────────────────────────
describe('useLapsedPrompt — first-time user gate (AC2, AC6)', () => {
  it('returns shouldShow: false when hasOpenedBefore is false, even with a very old lastSessionAt', () => {
    lapsed$.set({ lastSessionAt: T0 - 30 * DAY_MS, dismissedAt: null, hasOpenedBefore: false })
    const { result } = renderHook(() =>
      useLapsedPrompt(T0) // now is far beyond the last session
    )
    expect(result.current.shouldShow).toBe(false)
  })

  it('returns shouldShow: false when hasOpenedBefore is false and lastSessionAt is null', () => {
    // Default initial state
    const { result } = renderHook(() => useLapsedPrompt(T0))
    expect(result.current.shouldShow).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Within 7 days — shouldShow is false (AC2, AC6)
// ─────────────────────────────────────────────────────────────────────────────
describe('useLapsedPrompt — within 7 days (AC2, AC6)', () => {
  it('returns shouldShow: false when gap is 5 days (< threshold)', () => {
    const lastSessionAt = T0 - 5 * DAY_MS
    lapsed$.set({ lastSessionAt, dismissedAt: null, hasOpenedBefore: true })
    const { result } = renderHook(() => useLapsedPrompt(T0))
    expect(result.current.shouldShow).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. > 7 days, not dismissed — shouldShow is true (AC2)
// ─────────────────────────────────────────────────────────────────────────────
describe('useLapsedPrompt — lapsed and not dismissed (AC2)', () => {
  it('returns shouldShow: true when gap is 8 days and dismissedAt is null', () => {
    const lastSessionAt = T0 - 8 * DAY_MS
    lapsed$.set({ lastSessionAt, dismissedAt: null, hasOpenedBefore: true })
    const { result } = renderHook(() => useLapsedPrompt(T0))
    expect(result.current.shouldShow).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. > 7 days, dismissed in current window — shouldShow is false (AC2, AC6)
// ─────────────────────────────────────────────────────────────────────────────
describe('useLapsedPrompt — lapsed but dismissed in current window (AC2, AC6)', () => {
  it('returns shouldShow: false when dismissedAt >= lastSessionAt (dismissed in this window)', () => {
    const lastSessionAt = T0 - 9 * DAY_MS
    const dismissedAt = lastSessionAt + 100 // dismissed after this session opened
    const now = T0 // 9 days after lastSessionAt — lapsed, but dismissed
    lapsed$.set({ lastSessionAt, dismissedAt, hasOpenedBefore: true })
    const { result } = renderHook(() => useLapsedPrompt(now))
    expect(result.current.shouldShow).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. > 7 days, dismissed in *prior* window — shouldShow is true (AC2, AC6)
// (dismissedAt < lastSessionAt means the dismissal was from an older window)
// ─────────────────────────────────────────────────────────────────────────────
describe('useLapsedPrompt — lapsed, dismissed in prior window (AC2, AC6)', () => {
  it('returns shouldShow: true when dismissedAt < lastSessionAt (prior-window dismissal)', () => {
    const T1 = T0 - 20 * DAY_MS // old dismissal timestamp
    const T2 = T0 - 9 * DAY_MS  // more recent lastSessionAt (user returned, lapsed again)
    // T1 < T2: dismissal is older than lastSessionAt → belongs to a prior window
    // now - T2 > threshold → currently lapsed
    lapsed$.set({ lastSessionAt: T2, dismissedAt: T1, hasOpenedBefore: true })
    const { result } = renderHook(() => useLapsedPrompt(T0))
    expect(result.current.shouldShow).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Boundary: exactly LAPSED_THRESHOLD_MS — shouldShow is false (strict >) (AC2)
// ─────────────────────────────────────────────────────────────────────────────
describe('useLapsedPrompt — boundary: exactly threshold (AC2)', () => {
  it('returns shouldShow: false when now - lastSessionAt === LAPSED_THRESHOLD_MS exactly', () => {
    const lastSessionAt = T0 - LAPSED_THRESHOLD_MS // exactly 7 days ago
    lapsed$.set({ lastSessionAt, dismissedAt: null, hasOpenedBefore: true })
    const { result } = renderHook(() => useLapsedPrompt(T0))
    expect(result.current.shouldShow).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. dismiss() calls dismissLapsedPrompt and sets dismissedAt (AC2)
// ─────────────────────────────────────────────────────────────────────────────
describe('useLapsedPrompt — dismiss action (AC2)', () => {
  it('calling dismiss() results in lapsed$.dismissedAt being non-null', () => {
    const lastSessionAt = T0 - 8 * DAY_MS
    lapsed$.set({ lastSessionAt, dismissedAt: null, hasOpenedBefore: true })
    const { result } = renderHook(() => useLapsedPrompt(T0))
    expect(result.current.shouldShow).toBe(true)

    act(() => {
      result.current.dismiss()
    })

    expect(lapsed$.dismissedAt.get()).not.toBeNull()
  })
})
