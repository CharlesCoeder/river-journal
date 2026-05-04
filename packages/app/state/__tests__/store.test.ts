// @vitest-environment happy-dom
// Story 2-4: store threshold-crossing logic — unit tests (AC12 T1-T8)
// RED-PHASE TDD: all tests fail before implementation (thresholdCrossing field + helpers do not yet exist)

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mock Supabase client to prevent network requests during tests ────────────
// Required because store.ts → syncConfig.ts → supabase.ts creates a client eagerly.
vi.mock('../../utils/supabase', () => {
  return {
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      })),
    },
  }
})

// ─── Mock persistence to avoid IDB/MMKV issues in Node ───────────────────────
// Required because store.ts → persistConfig.ts → observablePersistIndexedDB
// which is a browser-only module and crashes in Vitest's Node environment.
vi.mock('../persistConfig', () => ({
  persistPlugin: {
    getTable: vi.fn(() => ({})),
    setTable: vi.fn(),
    deleteTable: vi.fn(),
    getMetadata: vi.fn(),
    setMetadata: vi.fn(),
    deleteMetadata: vi.fn(),
    loadTable: vi.fn(),
    saveTable: vi.fn(),
    set: vi.fn(),
  },
  configurePersistence: vi.fn(),
}))

import { batch } from '@legendapp/state'
import {
  ephemeral$,
  setInstantWordCountFromText,
  clearActiveFlow,
  discardActiveFlowSession,
} from '../store'

// ─────────────────────────────────────────────────────────────────────────────
// Test isolation: reset ephemeral state before each test and after all tests.
// Pattern mirrors Story 2.3 AC 31 placement (module-scope afterAll).
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  batch(() => {
    ephemeral$.instantWordCount.set(0)
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    ephemeral$.thresholdCrossing.set(null)
  })
})

afterAll(() => {
  batch(() => {
    ephemeral$.instantWordCount.set(0)
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    ephemeral$.thresholdCrossing.set(null)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a string that word-splits into exactly `n` words. */
function wordsText(n: number): string {
  if (n === 0) return ''
  return Array.from({ length: n }, (_, i) => `word${i + 1}`).join(' ')
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 — ephemeral$.thresholdCrossing initial value is null (AC12 T1)
// ─────────────────────────────────────────────────────────────────────────────
describe('T1: ephemeral$.thresholdCrossing initial value (AC12 T1)', () => {
  it('is null on a fresh state load', () => {
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    expect(ephemeral$.thresholdCrossing.peek()).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T2 — setInstantWordCountFromText does NOT set thresholdCrossing for sub-500 counts (AC12 T2)
// ─────────────────────────────────────────────────────────────────────────────
describe('T2: thresholdCrossing stays null for sub-500 word counts (AC12 T2)', () => {
  it('remains null after setting 0 words', () => {
    setInstantWordCountFromText('')
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    expect(ephemeral$.thresholdCrossing.peek()).toBeNull()
  })

  it('remains null after setting 1 word', () => {
    setInstantWordCountFromText(wordsText(1))
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    expect(ephemeral$.thresholdCrossing.peek()).toBeNull()
  })

  it('remains null after setting 100 words', () => {
    setInstantWordCountFromText(wordsText(100))
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    expect(ephemeral$.thresholdCrossing.peek()).toBeNull()
  })

  it('remains null after setting 499 words — boundary: one below 500', () => {
    setInstantWordCountFromText(wordsText(499))
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    expect(ephemeral$.thresholdCrossing.peek()).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T3 — setInstantWordCountFromText sets thresholdCrossing at first 500-crossing (AC12 T3)
// ─────────────────────────────────────────────────────────────────────────────
describe('T3: thresholdCrossing is set on the first crossing of 500 words (AC12 T3)', () => {
  it('is null before crossing 500', () => {
    setInstantWordCountFromText(wordsText(100))
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    expect(ephemeral$.thresholdCrossing.peek()).toBeNull()
  })

  it('is non-null after first crossing 500', () => {
    setInstantWordCountFromText(wordsText(500))
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    expect(ephemeral$.thresholdCrossing.peek()).not.toBeNull()
  })

  it('records wordCountAtCrossing === 500 when count is exactly 500', () => {
    setInstantWordCountFromText(wordsText(500))
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    const crossing = ephemeral$.thresholdCrossing.peek()
    expect(crossing).not.toBeNull()
    expect(crossing!.wordCountAtCrossing).toBe(500)
  })

  it('records a valid ISO string in crossedAt', () => {
    const before = new Date().toISOString()
    setInstantWordCountFromText(wordsText(500))
    const after = new Date().toISOString()
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    const crossing = ephemeral$.thresholdCrossing.peek()
    expect(crossing).not.toBeNull()
    // crossedAt must be a valid ISO date string between before and after
    expect(new Date(crossing!.crossedAt).toISOString()).toBe(crossing!.crossedAt)
    expect(crossing!.crossedAt >= before).toBe(true)
    expect(crossing!.crossedAt <= after).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T4 — Idempotency: subsequent calls past 500 do NOT overwrite thresholdCrossing (AC12 T4)
// ─────────────────────────────────────────────────────────────────────────────
describe('T4: thresholdCrossing is set only once — idempotency (AC12 T4)', () => {
  it('does not overwrite crossedAt on a second crossing at a higher count', async () => {
    setInstantWordCountFromText(wordsText(500))
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    const firstCrossing = ephemeral$.thresholdCrossing.peek()
    expect(firstCrossing).not.toBeNull()
    const firstCrossedAt = firstCrossing!.crossedAt

    // Wait a tiny bit to ensure Date.now() would differ if a re-set happened
    await new Promise((r) => setTimeout(r, 5))

    setInstantWordCountFromText(wordsText(600))
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    const secondCrossing = ephemeral$.thresholdCrossing.peek()
    expect(secondCrossing).not.toBeNull()
    expect(secondCrossing!.crossedAt).toBe(firstCrossedAt)
  })

  it('does not overwrite wordCountAtCrossing on repeated calls above 500', async () => {
    setInstantWordCountFromText(wordsText(500))
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    const firstCount = ephemeral$.thresholdCrossing.peek()!.wordCountAtCrossing

    await new Promise((r) => setTimeout(r, 5))

    setInstantWordCountFromText(wordsText(700))
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    expect(ephemeral$.thresholdCrossing.peek()!.wordCountAtCrossing).toBe(firstCount)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T5 — Paste-in past 500 in one go records wordCountAtCrossing at actual count (AC12 T5)
// ─────────────────────────────────────────────────────────────────────────────
describe('T5: paste-in past 500 in a single event records actual word count (AC12 T5)', () => {
  it('records wordCountAtCrossing === 750 when pasting in 750 words from 0', () => {
    // Initial state: count 0, threshold null (enforced by beforeEach)
    setInstantWordCountFromText(wordsText(750))
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    const crossing = ephemeral$.thresholdCrossing.peek()
    expect(crossing).not.toBeNull()
    expect(crossing!.wordCountAtCrossing).toBe(750)
  })

  it('records wordCountAtCrossing === 501 when count jumps from 499 to 501', () => {
    setInstantWordCountFromText(wordsText(499))
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    expect(ephemeral$.thresholdCrossing.peek()).toBeNull()

    setInstantWordCountFromText(wordsText(501))
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    const crossing = ephemeral$.thresholdCrossing.peek()
    expect(crossing).not.toBeNull()
    expect(crossing!.wordCountAtCrossing).toBe(501)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T6 — clearActiveFlow resets thresholdCrossing to null (AC12 T6)
// ─────────────────────────────────────────────────────────────────────────────
describe('T6: clearActiveFlow resets thresholdCrossing to null (AC12 T6)', () => {
  it('resets thresholdCrossing to null after clearActiveFlow', () => {
    setInstantWordCountFromText(wordsText(600))
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    expect(ephemeral$.thresholdCrossing.peek()).not.toBeNull()

    clearActiveFlow()

    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    expect(ephemeral$.thresholdCrossing.peek()).toBeNull()
  })

  it('also resets instantWordCount to 0 after clearActiveFlow (regression guard)', () => {
    setInstantWordCountFromText(wordsText(600))
    expect(ephemeral$.instantWordCount.peek()).toBe(600)

    clearActiveFlow()

    expect(ephemeral$.instantWordCount.peek()).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T7 — discardActiveFlowSession resets thresholdCrossing to null (AC12 T7)
// ─────────────────────────────────────────────────────────────────────────────
describe('T7: discardActiveFlowSession resets thresholdCrossing to null (AC12 T7)', () => {
  it('resets thresholdCrossing to null after discardActiveFlowSession', () => {
    setInstantWordCountFromText(wordsText(600))
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    expect(ephemeral$.thresholdCrossing.peek()).not.toBeNull()

    discardActiveFlowSession()

    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    expect(ephemeral$.thresholdCrossing.peek()).toBeNull()
  })

  it('also resets instantWordCount to 0 after discardActiveFlowSession (regression guard)', () => {
    setInstantWordCountFromText(wordsText(600))
    expect(ephemeral$.instantWordCount.peek()).toBe(600)

    discardActiveFlowSession()

    expect(ephemeral$.instantWordCount.peek()).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T8 — Threshold-crossing happens within the same synchronous tick as count update (AC12 T8)
// Documents the no-async-gap invariant (NFR3).
// If a future contributor introduces a setTimeout/microtask between count-set
// and threshold-record, this test fails.
// ─────────────────────────────────────────────────────────────────────────────
describe('T8: threshold-crossing and count update happen in the same synchronous tick (AC12 T8 / NFR3)', () => {
  it('instantWordCount and thresholdCrossing are both updated synchronously after setInstantWordCountFromText', () => {
    setInstantWordCountFromText(wordsText(500))

    // No await — synchronous reads immediately after the call
    const count = ephemeral$.instantWordCount.peek()
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    const crossing = ephemeral$.thresholdCrossing.peek()

    expect(count).toBe(500)
    expect(crossing).not.toBeNull()
    expect(crossing!.wordCountAtCrossing).toBe(500)
  })

  it('both values are set in a single synchronous frame — no intermediate null state', () => {
    // Call the function
    setInstantWordCountFromText(wordsText(500))

    // Capture immediately without any async gap
    const snapshotCount = ephemeral$.instantWordCount.peek()
    // @ts-expect-error — thresholdCrossing does not exist yet; will pass after implementation
    const snapshotCrossing = ephemeral$.thresholdCrossing.peek()

    // If the threshold were recorded asynchronously, snapshotCrossing would be null here
    expect(snapshotCount).toBe(500)
    expect(snapshotCrossing).not.toBeNull()
  })
})
