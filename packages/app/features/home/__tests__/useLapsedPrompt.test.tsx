// @vitest-environment happy-dom
// useLapsedPrompt() hook — pure 3-clause boolean logic
// Uses deterministic `now` arg. Mocks @legendapp/state/react to control observable reads.

import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { lapsed$, recordSessionOpen, LAPSED_THRESHOLD_MS } from 'app/state/lapsed'

// ─── Mock @legendapp/state/react so use$() reads from the real lapsed$ ────────
// We use the real observable and drive it via lapsed$.set() in each test.
vi.mock('@legendapp/state/react', () => ({
  use$: (obs: any) => obs.get(),
}))

import { useLapsedPrompt } from '../useLapsedPrompt'

const DAY_MS = 24 * 60 * 60 * 1000
const T0 = 1_700_000_000_000

beforeEach(() => {
  lapsed$.set({
    lastSessionAt: null,
    previousSessionAt: null,
    dismissedAt: null,
    hasOpenedBefore: false,
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. First-time user — shouldShow is false (AC2, AC6)
// ─────────────────────────────────────────────────────────────────────────────
describe('useLapsedPrompt — first-time user gate (AC2, AC6)', () => {
  it('returns shouldShow: false when hasOpenedBefore is false, even with a very old previousSessionAt', () => {
    lapsed$.set({
      lastSessionAt: T0,
      previousSessionAt: T0 - 30 * DAY_MS,
      dismissedAt: null,
      hasOpenedBefore: false,
    })
    const { result } = renderHook(() =>
      useLapsedPrompt(T0) // now is far beyond the previous session
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
    // Previous session was 5 days ago; the current session (this boot) is T0.
    lapsed$.set({
      lastSessionAt: T0,
      previousSessionAt: T0 - 5 * DAY_MS,
      dismissedAt: null,
      hasOpenedBefore: true,
    })
    const { result } = renderHook(() => useLapsedPrompt(T0))
    expect(result.current.shouldShow).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. > 7 days, not dismissed — shouldShow is true (AC2)
// ─────────────────────────────────────────────────────────────────────────────
describe('useLapsedPrompt — lapsed and not dismissed (AC2)', () => {
  it('returns shouldShow: true when gap is 8 days and dismissedAt is null', () => {
    // Realistic boot: recordSessionOpen advanced lastSessionAt to now (T0) and
    // snapshotted the 8-days-ago prior session into previousSessionAt.
    lapsed$.set({
      lastSessionAt: T0,
      previousSessionAt: T0 - 8 * DAY_MS,
      dismissedAt: null,
      hasOpenedBefore: true,
    })
    const { result } = renderHook(() => useLapsedPrompt(T0))
    expect(result.current.shouldShow).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. > 7 days, dismissed in current window — shouldShow is false (AC2, AC6)
// ─────────────────────────────────────────────────────────────────────────────
describe('useLapsedPrompt — lapsed but dismissed in current window (AC2, AC6)', () => {
  it('returns shouldShow: false when dismissedAt >= lastSessionAt (dismissed in this window)', () => {
    const lastSessionAt = T0 - 1000 // current session opened ~1s ago (this boot)
    const previousSessionAt = T0 - 9 * DAY_MS // prior session 9 days ago → lapsed
    const dismissedAt = lastSessionAt + 100 // dismissed after this session opened
    const now = T0
    lapsed$.set({ lastSessionAt, previousSessionAt, dismissedAt, hasOpenedBefore: true })
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
    const oldDismissal = T0 - 20 * DAY_MS // dismissal from an older lapsed window
    const previousSessionAt = T0 - 9 * DAY_MS // prior session → now - 9d > threshold → lapsed
    const lastSessionAt = T0 - 1000 // current session opened this boot
    // oldDismissal < lastSessionAt → dismissal belongs to a prior window, not this one
    lapsed$.set({ lastSessionAt, previousSessionAt, dismissedAt: oldDismissal, hasOpenedBefore: true })
    const { result } = renderHook(() => useLapsedPrompt(T0))
    expect(result.current.shouldShow).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Boundary: exactly LAPSED_THRESHOLD_MS — shouldShow is false (strict >) (AC2)
// ─────────────────────────────────────────────────────────────────────────────
describe('useLapsedPrompt — boundary: exactly threshold (AC2)', () => {
  it('returns shouldShow: false when now - previousSessionAt === LAPSED_THRESHOLD_MS exactly', () => {
    lapsed$.set({
      lastSessionAt: T0,
      previousSessionAt: T0 - LAPSED_THRESHOLD_MS, // prior session exactly 7 days ago
      dismissedAt: null,
      hasOpenedBefore: true,
    })
    const { result } = renderHook(() => useLapsedPrompt(T0))
    expect(result.current.shouldShow).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. dismiss() calls dismissLapsedPrompt and sets dismissedAt (AC2)
// ─────────────────────────────────────────────────────────────────────────────
describe('useLapsedPrompt — dismiss action (AC2)', () => {
  it('calling dismiss() results in lapsed$.dismissedAt being non-null', () => {
    lapsed$.set({
      lastSessionAt: T0,
      previousSessionAt: T0 - 8 * DAY_MS,
      dismissedAt: null,
      hasOpenedBefore: true,
    })
    const { result } = renderHook(() => useLapsedPrompt(T0))
    expect(result.current.shouldShow).toBe(true)

    act(() => {
      result.current.dismiss()
    })

    expect(lapsed$.dismissedAt.get()).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. Boot-flow regression: recordSessionOpen must NOT suppress the prompt
// This is the dead-feature bug — recording the current session used to overwrite
// lastSessionAt with ≈now, so the gap the prompt measured was always ≈0.
// ─────────────────────────────────────────────────────────────────────────────
describe('useLapsedPrompt — boot flow (recordSessionOpen preserves the lapse)', () => {
  it('shows the prompt on the boot that recorded a session after a > 7 day absence', () => {
    // Persistence hydrates a last session from 8 days ago.
    const priorSession = T0 - 8 * DAY_MS
    lapsed$.set({
      lastSessionAt: priorSession,
      previousSessionAt: null,
      dismissedAt: null,
      hasOpenedBefore: true,
    })

    // Boot records the current session (as initializeApp does before the UI mounts).
    recordSessionOpen(T0)

    // The prompt must still fire on THIS boot — the gap is measured against the
    // prior session, which recordSessionOpen snapshotted into previousSessionAt.
    const { result } = renderHook(() => useLapsedPrompt(T0))
    expect(result.current.shouldShow).toBe(true)
  })

  it('does NOT show the prompt on a boot that recorded a session within 7 days', () => {
    const priorSession = T0 - 3 * DAY_MS
    lapsed$.set({
      lastSessionAt: priorSession,
      previousSessionAt: null,
      dismissedAt: null,
      hasOpenedBefore: true,
    })

    recordSessionOpen(T0)

    const { result } = renderHook(() => useLapsedPrompt(T0))
    expect(result.current.shouldShow).toBe(false)
  })
})
