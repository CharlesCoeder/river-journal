// @vitest-environment happy-dom
/**
 * streak-view.test.ts
 *
 * Story 2.3 — TDD Red-Phase E2E tests for:
 *   1. store$.views.streak reactive computed view
 *   2. useUnlockedThemes(tier) hook
 *   3. Boundary purity + module-graph smoke
 *
 * "E2E" for this story means: full reactive cycle end-to-end —
 *   entries$/flows$/graceDays$ mutation → streak$ recompute → hook re-emits.
 *
 * This file MUST remain separate from streak.test.ts (Story 2.2 pure-function suite).
 * streak.test.ts has zero Legend-State imports. This file imports Legend-State observables.
 *
 * Red-phase: all tests fail until Story 2.3 implementation lands.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { batch } from '@legendapp/state'
import { store$, entries$, flows$, graceDays$ } from '../store'
import { THEME_NAMES } from '../types'
import { getTodayJournalDayString } from '../date-utils'

// Partial mock: preserve the real use$ (which wraps useSyncExternalStore and
// supports renderHook + act() subscription cycles in happy-dom) while keeping
// the door open for any other @legendapp/state/react exports this file may need.
vi.mock('@legendapp/state/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@legendapp/state/react')>()
  return { ...actual }
})

// Import hook and MILESTONES — these come from streak.ts wiring (Story 2.3 output).
// Red-phase: useUnlockedThemes does not yet exist in streak.ts; this import will
// resolve to undefined (named export missing) until implementation lands.
import { useUnlockedThemes, MILESTONES } from '../streak'

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers (mirrored from streak.test.ts for self-containment)
// ─────────────────────────────────────────────────────────────────────────────

import type { Entry, Flow, GraceDay } from '../types'

const mkEntry = (id: string, entryDate: string, overrides: Partial<Entry> = {}): Entry => ({
  id,
  entryDate,
  lastModified: '2026-01-01T00:00:00Z',
  local_session_id: 'test-session',
  ...overrides,
})

const mkFlow = (
  id: string,
  dailyEntryId: string,
  wordCount: number,
  overrides: Partial<Flow> = {}
): Flow => ({
  id,
  dailyEntryId,
  wordCount,
  content: '...',
  timestamp: '2026-01-01T00:00:00Z',
  local_session_id: 'test-session',
  ...overrides,
})

const mkGrace = (
  id: string,
  usedForDate: string | null,
  overrides: Partial<GraceDay> = {}
): GraceDay => ({
  id,
  userId: 'user-1',
  earnedAt: '2026-01-01T00:00:00Z',
  earnedForMilestone: 7,
  usedForDate,
  ...overrides,
})

/** Add `delta` calendar days to a 'YYYY-MM-DD' string using UTC arithmetic. */
function shiftDay(yyyymmdd: string, delta: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d) + delta * 86_400_000
  const dt = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

// ─────────────────────────────────────────────────────────────────────────────
// State isolation
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  batch(() => {
    entries$.set({})
    flows$.set({})
    graceDays$.set({})
  })
})

// afterAll at module scope (NOT inside any describe) — fires after every test
// in this file, preventing fixtures leaking into sibling test files.
// Mirrors the pattern in Story 2.1's grace_days test cleanup.
afterAll(() => {
  batch(() => {
    entries$.set({})
    flows$.set({})
    graceDays$.set({})
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Module graph + initialization-order smoke tests
// (AC 23, AC 30 — must pass as part of confirming wiring landed correctly)
// ─────────────────────────────────────────────────────────────────────────────

describe('module graph — initialization order and circular-import safety', () => {
  it('AC30: useUnlockedThemes is importable as a function (no TDZ error)', () => {
    // This test validates the module graph is sound:
    // importing useUnlockedThemes loads streak.ts which must not cause a
    // TDZ / circular-import error with types.ts.
    // Red-phase: fails because useUnlockedThemes is not yet exported from streak.ts.
    expect(typeof useUnlockedThemes).toBe('function')
  })

  it('AC30: store$.views.streak is defined and has a .get() method', () => {
    // Red-phase: fails because store$.assign({ views: { streak } }) has not yet
    // been appended to streak.ts, so store$.views.streak is undefined.
    expect(store$.views?.streak).toBeDefined()
    expect(typeof store$.views?.streak?.get).toBe('function')
  })

  it('AC23: both store$.views.entryByDate AND store$.views.streak are functions (initialization order)', () => {
    // Validates that store.ts views (entryByDate etc.) and streak.ts wiring (streak)
    // are BOTH attached — i.e., streak.ts was imported and its side-effect ran
    // AFTER store.ts's own views block. If import order is wrong, one or both will be undefined.
    // Red-phase: store$.views.streak is undefined until implementation.
    expect(typeof store$.views?.entryByDate).toBe('function')
    expect(typeof store$.views?.streak?.get).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// store$.views.streak — reactive computed view (R1–R8)
// (AC 13 — full reactive cycle: state change → computed re-evaluates → new value)
// ─────────────────────────────────────────────────────────────────────────────

describe('store$.views.streak — reactive computed view (AC13)', () => {
  it('R1: store$.views.streak.get() returns a StreakState object with all six fields', () => {
    // AC13 R1 — shape exhaustiveness
    // Red-phase: store$.views.streak is undefined.
    const s = store$.views?.streak?.get()
    expect(s).not.toBeNull()
    expect(s).not.toBeUndefined()

    const expectedKeys = [
      'currentStreak',
      'lastQualifyingDate',
      'longestStreak',
      'nextUnlockMilestone',
      'unlockTokensEarned',
      'unlockedThemes',
    ]
    expect(Object.keys(s as object).sort()).toEqual(expectedKeys)
  })

  it('R2: empty state baseline — all zeros, empty arrays, null dates', () => {
    // AC13 R2 — empty-state baseline
    // entries$/flows$/graceDays$ are {} (reset in beforeEach)
    // Red-phase: store$.views.streak undefined.
    const s = store$.views?.streak?.get()
    expect(s).toMatchObject({
      currentStreak: 0,
      longestStreak: 0,
      unlockTokensEarned: 0,
      unlockedThemes: [],
      nextUnlockMilestone: MILESTONES[0] ?? null,
      lastQualifyingDate: null,
    })
  })

  it('R3: E2E reactive cycle — flows$ write causes streak$ to update currentStreak', () => {
    // AC13 R3 — full reactive cycle: entries$ + flows$ → streak$ recomputes
    // Seed an entry on today, then add a qualifying flow → currentStreak goes 0→1
    const today = getTodayJournalDayString()
    const entryId = 'e-r3'

    // Step 1: entry exists, no qualifying flow yet
    batch(() => {
      entries$.set({ [entryId]: mkEntry(entryId, today) })
    })
    const before = store$.views?.streak?.get()
    expect(before?.currentStreak).toBe(0)

    // Step 2: add a qualifying flow (≥500 words) → streak must recompute
    const flowId = 'f-r3'
    batch(() => {
      flows$.set({ [flowId]: mkFlow(flowId, entryId, 500) })
    })
    const after = store$.views?.streak?.get()
    // Red-phase: entire block fails because store$.views.streak is undefined.
    expect(after?.currentStreak).toBe(1)
  })

  it('R4: E2E reactive cycle — entries$ write for orphan flow causes currentStreak to update', () => {
    // AC13 R4 — orphan flow becomes qualifying when its entry is added
    // An orphan flow (flow whose entry does not exist yet) contributes 0 to any date.
    // Adding the entry makes the flow non-orphan → streak recomputes.
    const today = getTodayJournalDayString()
    const entryId = 'e-r4'
    const flowId = 'f-r4'

    // Step 1: flow exists but entry does not → orphan flow → currentStreak 0
    batch(() => {
      flows$.set({ [flowId]: mkFlow(flowId, entryId, 500) })
    })
    expect(store$.views?.streak?.get()?.currentStreak).toBe(0)

    // Step 2: add the entry → flow becomes non-orphan → streak recomputes → currentStreak 1
    batch(() => {
      entries$.set({ [entryId]: mkEntry(entryId, today) })
    })
    // Red-phase: fails.
    expect(store$.views?.streak?.get()?.currentStreak).toBe(1)
  })

  it('R5: E2E reactive cycle — graceDays$ write bridges a gap and extends currentStreak', () => {
    // AC13 R5 — grace day added for a gap day → currentStreak expands
    // Setup: today qualifies, today-2 qualifies, today-1 is a gap → currentStreak 1
    const today = getTodayJournalDayString()
    const ydayMinus1 = shiftDay(today, -1)
    const ydayMinus2 = shiftDay(today, -2)

    const eToday = 'e-r5-today'
    const eTwo = 'e-r5-two'
    const fToday = 'f-r5-today'
    const fTwo = 'f-r5-two'

    batch(() => {
      entries$.set({
        [eToday]: mkEntry(eToday, today),
        [eTwo]: mkEntry(eTwo, ydayMinus2),
      })
      flows$.set({
        [fToday]: mkFlow(fToday, eToday, 500),
        [fTwo]: mkFlow(fTwo, eTwo, 500),
      })
    })

    // Gap at today-1 breaks the chain → currentStreak should be 1 (only today)
    expect(store$.views?.streak?.get()?.currentStreak).toBe(1)

    // Add grace day protecting today-1 gap
    const graceId = 'g-r5'
    batch(() => {
      graceDays$.set({ [graceId]: mkGrace(graceId, ydayMinus1) })
    })

    // Grace bridges the gap → streak is now 3 (today, today-1 grace, today-2)
    // Red-phase: fails.
    expect(store$.views?.streak?.get()?.currentStreak).toBe(3)
  })

  it('R6: lastQualifyingDate matches getTodayJournalDayString() when today qualifies', () => {
    // AC13 R6 — documents that today is sourced from getTodayJournalDayString() inline.
    // We just verify the read is consistent — no mocking required.
    const today = getTodayJournalDayString()
    const entryId = 'e-r6'
    const flowId = 'f-r6'

    batch(() => {
      entries$.set({ [entryId]: mkEntry(entryId, today) })
      flows$.set({ [flowId]: mkFlow(flowId, entryId, 500) })
    })

    // Red-phase: fails.
    expect(store$.views?.streak?.get()?.lastQualifyingDate).toBe(today)
  })

  it('R7: tier baked-in as "free" — longestStreak=35 yields 2 unlocked themes, not 6 (paid bypass is NOT active)', () => {
    // AC13 R7 — documents that computed view bakes in 'free' until Story 7.1.
    // MILESTONES [7, 30, 90, 180]: longestStreak 35 crosses 7 and 30 → 2 themes.
    // If a contributor flips the literal to a paid-tier value, this test fails loudly.
    const today = getTodayJournalDayString()

    // Build 35 consecutive qualifying days ending today
    const entryMap: Record<string, Entry> = {}
    const flowMap: Record<string, Flow> = {}
    for (let i = 0; i < 35; i++) {
      const date = shiftDay(today, -i)
      const eId = `e-r7-${i}`
      const fId = `f-r7-${i}`
      entryMap[eId] = mkEntry(eId, date)
      flowMap[fId] = mkFlow(fId, eId, 500)
    }

    batch(() => {
      entries$.set(entryMap)
      flows$.set(flowMap)
    })

    const s = store$.views?.streak?.get()
    // Red-phase: fails.
    expect(s?.longestStreak).toBe(35)
    expect(s?.unlockedThemes.length).toBe(2) // 'forest-morning' (7) + 'leather' (30)
    expect(s?.unlockedThemes).not.toHaveLength(6) // paid bypass is NOT active
  })

  it('R8: chosenUnlocks baked-in as undefined — passive map returns milestone-ordered themes', () => {
    // AC13 R8 — documents the Story 2.9 forward-compat seam.
    // With chosenUnlocks=undefined, Model A passive map applies:
    // longestStreak=35 → MILESTONES [7,30] crossed → ['forest-morning', 'leather']
    const today = getTodayJournalDayString()

    const entryMap: Record<string, Entry> = {}
    const flowMap: Record<string, Flow> = {}
    for (let i = 0; i < 35; i++) {
      const date = shiftDay(today, -i)
      const eId = `e-r8-${i}`
      const fId = `f-r8-${i}`
      entryMap[eId] = mkEntry(eId, date)
      flowMap[fId] = mkFlow(fId, eId, 500)
    }

    batch(() => {
      entries$.set(entryMap)
      flows$.set(flowMap)
    })

    const s = store$.views?.streak?.get()
    // Red-phase: fails.
    expect(s?.unlockedThemes).toEqual(['forest-morning', 'leather'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// useUnlockedThemes(tier) hook (H1–H3)
// (AC 14 — hook tests using renderHook)
// ─────────────────────────────────────────────────────────────────────'

describe('useUnlockedThemes(tier) hook (AC14)', () => {
  it('H1a: paid_monthly returns all THEME_NAMES (paid bypass — no streak$ subscription)', () => {
    // AC14 H1 — paid-tier early return fires BEFORE use$, so no React fiber needed.
    // renderHook used for consistency per AC14 note.
    // Red-phase: fails because useUnlockedThemes is not yet exported from streak.ts.
    const { result } = renderHook(() => useUnlockedThemes('paid_monthly'))
    expect(result.current).toEqual([...THEME_NAMES])
  })

  it('H1b: paid_yearly returns all THEME_NAMES (paid bypass)', () => {
    // AC14 H1 — same paid-tier early return for paid_yearly.
    // Red-phase: fails.
    const { result } = renderHook(() => useUnlockedThemes('paid_yearly'))
    expect(result.current).toEqual([...THEME_NAMES])
  })

  it('H2: free tier returns streak$.unlockedThemes (deeply equal to observable read)', () => {
    // AC14 H2 — free tier reads from store$.views.streak via use$().
    // With longestStreak=35: ['forest-morning', 'leather'].
    const today = getTodayJournalDayString()

    const entryMap: Record<string, Entry> = {}
    const flowMap: Record<string, Flow> = {}
    for (let i = 0; i < 35; i++) {
      const date = shiftDay(today, -i)
      const eId = `e-h2-${i}`
      const fId = `f-h2-${i}`
      entryMap[eId] = mkEntry(eId, date)
      flowMap[fId] = mkFlow(fId, eId, 500)
    }

    batch(() => {
      entries$.set(entryMap)
      flows$.set(flowMap)
    })

    const { result } = renderHook(() => useUnlockedThemes('free'))
    const fromObservable = store$.views?.streak?.get()?.unlockedThemes

    // Red-phase: fails because useUnlockedThemes and store$.views.streak don't exist.
    expect(result.current).toEqual(fromObservable)
    expect(result.current).toEqual(['forest-morning', 'leather'])
  })

  it('H3: E2E reactive cycle — hook re-renders when flows$ mutation crosses a milestone', () => {
    // AC14 H3 — the canonical renderHook + act() reactive-update test.
    // Start with longestStreak < 7 (no unlocks), then push past milestone 7
    // → hook should return 1 unlocked theme after the mutation.
    const today = getTodayJournalDayString()

    // Initial: 6 qualifying days — below milestone 7
    const entryMap: Record<string, Entry> = {}
    const flowMap: Record<string, Flow> = {}
    for (let i = 0; i < 6; i++) {
      const date = shiftDay(today, -i)
      const eId = `e-h3-init-${i}`
      const fId = `f-h3-init-${i}`
      entryMap[eId] = mkEntry(eId, date)
      flowMap[fId] = mkFlow(fId, eId, 500)
    }

    batch(() => {
      entries$.set(entryMap)
      flows$.set(flowMap)
    })

    const { result } = renderHook(() => useUnlockedThemes('free'))

    // Red-phase: fails because useUnlockedThemes doesn't exist yet.
    // Pre-mutation: longestStreak = 6, no milestones crossed → 0 unlocked themes
    expect(result.current.length).toBe(0)

    // Add a 7th qualifying day → crosses milestone 7 → 1 unlocked theme
    // We have days today through today-5 (6 days, i=0..5). Add today-6 for the 7th.
    act(() => {
      batch(() => {
        const extraEntryId = 'e-h3-extra'
        const extraFlowId = 'f-h3-extra'
        // today-6 extends the consecutive run to 7 days → longestStreak=7 → milestone crossed
        entries$.assign({ [extraEntryId]: mkEntry(extraEntryId, shiftDay(today, -6)) })
        flows$.assign({ [extraFlowId]: mkFlow(extraFlowId, extraEntryId, 500) })
      })
    })

    // After mutation crossing milestone 7 → ['forest-morning']
    expect(result.current.length).toBe(1)
    expect(result.current[0]).toBe('forest-morning')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Referential stability (AC 26 / AC 27)
// ─────────────────────────────────────────────────────────────────────────────

describe('useUnlockedThemes(tier) — paid-tier referential stability (AC26, AC27)', () => {
  it('AC27: paid_monthly returns the same array reference across calls (PAID_TIER_THEMES constant)', () => {
    // Calls outside a React component context; works because the paid-tier
    // branch returns BEFORE use$() per AC 5 ordering. If a contributor flips
    // the branch order, this test throws "use$ must be called inside a component".
    // Red-phase: fails because useUnlockedThemes is not yet exported.
    const a = useUnlockedThemes('paid_monthly')
    const b = useUnlockedThemes('paid_monthly')
    const c = useUnlockedThemes('paid_yearly')
    expect(a).toBe(b) // same reference across calls
    expect(a).toBe(c) // both paid tiers share the same constant
    expect(a).toEqual([...THEME_NAMES]) // value-equal to the source
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Boundary purity (P1 — AC 16 / AC 2)
// ─────────────────────────────────────────────────────────────────────────────

describe('state/streak.ts — boundary purity (AC16, AC2)', () => {
  it('P1: streak.ts contains no @tanstack/react-query import', async () => {
    // Reads streak.ts as text and asserts no forbidden imports are present.
    // This prevents a future contributor from adding useQuery() inside the hook.
    // Red-phase: this test PASSES even before implementation — the existing stub streak.ts
    // already has no forbidden imports. It serves as a regression guard post-implementation.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(__dirname, '../streak.ts')
    const content = fs.readFileSync(filePath, 'utf-8')

    expect(content).not.toMatch(/@tanstack\/react-query/)
    expect(content).not.toMatch(/@legendapp\/state\/sync-plugins\/supabase/)
    expect(content).not.toMatch(/axios/)
    expect(content).not.toMatch(/console\./)
    // Must not import any UI / feature layer
    expect(content).not.toMatch(/from ['"]app\/features/)
    expect(content).not.toMatch(/from ['"]\.\.\/features/)
  })

  it('P2: streak.ts exports useUnlockedThemes as a function (API surface guard)', () => {
    // Ensures the named export exists and is callable. Fails until implementation.
    // Red-phase: fails because useUnlockedThemes is not yet exported.
    expect(typeof useUnlockedThemes).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Full reactive pipeline integration (AC 6 — hook returns reactively)
// ─────────────────────────────────────────────────────────────────────────────

describe('Full reactive pipeline — entries$ → streak$ → useUnlockedThemes (AC6)', () => {
  it('writing a flow that qualifies today is immediately reflected in useUnlockedThemes("free") output', () => {
    // End-to-end pipeline test: single data write, full stack reactivity check.
    // entries$ update → computeStreakState recompute → streak$ updates → hook re-emits.
    //
    // This is the "canonical" E2E test for Story 2.3: the whole reactive cycle in one test.
    //
    // Setup: empty state → hook returns []
    const { result } = renderHook(() => useUnlockedThemes('free'))

    // Red-phase: fails because useUnlockedThemes is not yet exported.
    expect(result.current).toEqual([])

    // Mutation: add 7 qualifying days → crosses milestone 7
    act(() => {
      const today = getTodayJournalDayString()
      const entryMap: Record<string, Entry> = {}
      const flowMap: Record<string, Flow> = {}

      for (let i = 0; i < 7; i++) {
        const date = shiftDay(today, -i)
        const eId = `e-pipeline-${i}`
        const fId = `f-pipeline-${i}`
        entryMap[eId] = mkEntry(eId, date)
        flowMap[fId] = mkFlow(fId, eId, 500)
      }

      batch(() => {
        entries$.set(entryMap)
        flows$.set(flowMap)
      })
    })

    // After mutation: longestStreak=7 → milestone 7 crossed → ['forest-morning']
    expect(result.current).toEqual(['forest-morning'])
  })
})
