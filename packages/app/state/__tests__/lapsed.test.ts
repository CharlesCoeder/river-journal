// Story 1.8: lapsed$ observable + helpers — pure state unit tests (AC1, AC3, AC6)
// No persistence involved. Observable is reset to initial shape in beforeEach.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  lapsed$,
  recordSessionOpen,
  dismissLapsedPrompt,
  LAPSED_THRESHOLD_DAYS,
  LAPSED_THRESHOLD_MS,
} from '../lapsed'

const DAY_MS = 24 * 60 * 60 * 1000

// Fixed base timestamp for deterministic tests
const T0 = 1_700_000_000_000 // arbitrary epoch ms

beforeEach(() => {
  // Reset observable to initial shape before every test (no persistence involved)
  lapsed$.set({ lastSessionAt: null, dismissedAt: null, hasOpenedBefore: false })
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. Initial state (AC1)
// ─────────────────────────────────────────────────────────────────────────────
describe('lapsed$ initial state (AC1)', () => {
  it('lastSessionAt is null on a fresh observable', () => {
    expect(lapsed$.lastSessionAt.get()).toBeNull()
  })

  it('dismissedAt is null on a fresh observable', () => {
    expect(lapsed$.dismissedAt.get()).toBeNull()
  })

  it('hasOpenedBefore is false on a fresh observable', () => {
    expect(lapsed$.hasOpenedBefore.get()).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. recordSessionOpen — first call (AC1, AC3)
// ─────────────────────────────────────────────────────────────────────────────
describe('recordSessionOpen — first call on fresh observable (AC1, AC3)', () => {
  it('sets lastSessionAt to the provided timestamp', () => {
    recordSessionOpen(T0)
    expect(lapsed$.lastSessionAt.get()).toBe(T0)
  })

  it('sets hasOpenedBefore to true', () => {
    recordSessionOpen(T0)
    expect(lapsed$.hasOpenedBefore.get()).toBe(true)
  })

  it('leaves dismissedAt as null (no prior window to reset)', () => {
    recordSessionOpen(T0)
    expect(lapsed$.dismissedAt.get()).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Same-tick guard — idempotent on hot-reload (AC3)
// ─────────────────────────────────────────────────────────────────────────────
describe('recordSessionOpen — same-tick guard (AC3)', () => {
  it('second call within 60s is a no-op; lastSessionAt stays at first value', () => {
    recordSessionOpen(T0)
    recordSessionOpen(T0 + 30_000) // 30 seconds later — within same-tick window
    expect(lapsed$.lastSessionAt.get()).toBe(T0)
  })

  it('second call at exactly 60_000ms is treated as a new session (boundary — not a no-op)', () => {
    recordSessionOpen(T0)
    recordSessionOpen(T0 + 60_000) // exactly 60s — guard is strictly < 60_000, so this fires
    expect(lapsed$.lastSessionAt.get()).toBe(T0 + 60_000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. ≤ 7 days gap — dismissedAt NOT reset (AC3, AC6)
// ─────────────────────────────────────────────────────────────────────────────
describe('recordSessionOpen — gap ≤ 7 days does not reset dismissedAt (AC3, AC6)', () => {
  it('lastSessionAt advances to new timestamp', () => {
    recordSessionOpen(T0)
    const t1 = T0 + 5 * DAY_MS
    recordSessionOpen(t1)
    expect(lapsed$.lastSessionAt.get()).toBe(t1)
  })

  it('dismissedAt is unchanged when gap is 5 days (≤ threshold)', () => {
    recordSessionOpen(T0)
    // Simulate a previous dismissal
    lapsed$.dismissedAt.set(T0 + 1000)
    const t1 = T0 + 5 * DAY_MS
    recordSessionOpen(t1)
    // dismissedAt should NOT be reset
    expect(lapsed$.dismissedAt.get()).toBe(T0 + 1000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. > 7 days gap — dismissedAt reset to null (AC3, AC6)
// ─────────────────────────────────────────────────────────────────────────────
describe('recordSessionOpen — gap > 7 days resets dismissedAt (AC3, AC6)', () => {
  it('dismissedAt is set to null when gap is 8 days (> threshold)', () => {
    recordSessionOpen(T0)
    const t1 = T0 + DAY_MS // simulate dismissal after first open
    lapsed$.dismissedAt.set(t1)
    const t2 = T0 + 8 * DAY_MS // 8 days later
    recordSessionOpen(t2)
    expect(lapsed$.dismissedAt.get()).toBeNull()
  })

  it('lastSessionAt advances to the new timestamp on the fresh-window open', () => {
    recordSessionOpen(T0)
    const t2 = T0 + 8 * DAY_MS
    recordSessionOpen(t2)
    expect(lapsed$.lastSessionAt.get()).toBe(t2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. ≤ 7 days gap — same-window dismissal is preserved (AC6)
// ─────────────────────────────────────────────────────────────────────────────
describe('recordSessionOpen — ≤ 7 days gap preserves existing dismissedAt (AC6)', () => {
  it('dismissedAt remains set when gap is 5 days (same lapsed window)', () => {
    recordSessionOpen(T0)
    const tDismiss = T0 + 2 * DAY_MS
    lapsed$.dismissedAt.set(tDismiss) // user dismissed during this window
    const t5days = T0 + 5 * DAY_MS
    recordSessionOpen(t5days)
    // Still within 7-day window — dismissal must persist
    expect(lapsed$.dismissedAt.get()).toBe(tDismiss)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. Boundary: exactly 7 days — NOT lapsed (strict greater-than) (AC1, AC6)
// ─────────────────────────────────────────────────────────────────────────────
describe('recordSessionOpen — exactly LAPSED_THRESHOLD_MS boundary (AC1, AC6)', () => {
  it('LAPSED_THRESHOLD_DAYS equals 7', () => {
    expect(LAPSED_THRESHOLD_DAYS).toBe(7)
  })

  it('LAPSED_THRESHOLD_MS equals 7 * 24 * 60 * 60 * 1000', () => {
    expect(LAPSED_THRESHOLD_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('dismissedAt is NOT reset when gap equals exactly LAPSED_THRESHOLD_MS (strict >)', () => {
    recordSessionOpen(T0)
    const tDismiss = T0 + 1000
    lapsed$.dismissedAt.set(tDismiss)
    // Exactly at threshold — should NOT trigger reset
    recordSessionOpen(T0 + LAPSED_THRESHOLD_MS)
    expect(lapsed$.dismissedAt.get()).toBe(tDismiss)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. dismissLapsedPrompt — sets dismissedAt (AC1)
// ─────────────────────────────────────────────────────────────────────────────
describe('dismissLapsedPrompt — sets dismissedAt (AC1)', () => {
  it('sets dismissedAt to the provided timestamp', () => {
    const tDismiss = T0 + 500
    dismissLapsedPrompt(tDismiss)
    expect(lapsed$.dismissedAt.get()).toBe(tDismiss)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Elicitation extras
// ─────────────────────────────────────────────────────────────────────────────

describe('recordSessionOpen — negative gap (clock-skew) is a no-op for reset (elicitation)', () => {
  it('does not reset dismissedAt when now < lastSessionAt (clock skew backward)', () => {
    recordSessionOpen(T0)
    const tDismiss = T0 + 1000
    lapsed$.dismissedAt.set(tDismiss)
    // Simulate clock going backwards: now is BEFORE T0 by a large margin,
    // but the same-tick guard won't fire (gap would be negative, i.e., < 60_000 as signed integer).
    // The guard treats this as "within same tick" — still a no-op.
    const tBefore = T0 - 10 * DAY_MS
    recordSessionOpen(tBefore)
    // Because (tBefore - T0) is very negative, which is < 60_000, same-tick guard fires → no-op.
    // lastSessionAt must stay at T0.
    expect(lapsed$.lastSessionAt.get()).toBe(T0)
    // dismissedAt must be unchanged.
    expect(lapsed$.dismissedAt.get()).toBe(tDismiss)
  })
})

describe('recordSessionOpen — pre-persist-load no-op (elicitation)', () => {
  it('is safe to call when lastSessionAt is null (first launch / before persistence loads)', () => {
    // The observable is in initial state (null/null/false). This simulates the case
    // where persistence has NOT loaded yet. The function must not throw.
    expect(() => recordSessionOpen(T0)).not.toThrow()
    // It should still set lastSessionAt and hasOpenedBefore
    expect(lapsed$.lastSessionAt.get()).toBe(T0)
    expect(lapsed$.hasOpenedBefore.get()).toBe(true)
    // dismissedAt stays null
    expect(lapsed$.dismissedAt.get()).toBeNull()
  })
})
