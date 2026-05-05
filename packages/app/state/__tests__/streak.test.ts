// computeStreakState pure function — table-driven tests
// Red-phase TDD: all tests fail against the not-implemented stub.

import { describe, expect, it } from 'vitest'
import { computeStreakState, MILESTONES, STREAK_THEME_UNLOCKS, type StreakState } from '../streak'
import { THEME_NAMES, type Entry, type Flow, type GraceDay, type ThemeName } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures & helpers
// ─────────────────────────────────────────────────────────────────────────────

const T0_DATE = '2026-05-04'

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

/** Add `delta` calendar days to a 'YYYY-MM-DD' string using UTC arithmetic. Test-local helper. */
function shiftDay(yyyymmdd: string, delta: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d) + delta * 86_400_000
  const dt = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** Invariants that must hold across every result. */
function assertInvariants(state: StreakState): void {
  expect(state.longestStreak).toBeGreaterThanOrEqual(state.currentStreak)
  expect(state.unlockTokensEarned).toBe(MILESTONES.filter((m) => m <= state.longestStreak).length)
  expect(state.currentStreak).toBeGreaterThanOrEqual(0)
  expect(state.longestStreak).toBeGreaterThanOrEqual(0)
}

/** Build N consecutive qualifying days ending at `endDate`. */
function buildConsecutiveQualifyingDays(
  endDate: string,
  n: number,
  wordsPerDay = 500
): { entries: Entry[]; flows: Flow[] } {
  const entries: Entry[] = []
  const flows: Flow[] = []
  for (let i = 0; i < n; i++) {
    const date = shiftDay(endDate, -(n - 1 - i))
    const entryId = `e-${date}`
    entries.push(mkEntry(entryId, date))
    flows.push(mkFlow(`f-${date}`, entryId, wordsPerDay))
  }
  return { entries, flows }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group A: Epic AC table-driven cases (AC 18 — 11 cases)
// ─────────────────────────────────────────────────────────────────────────────

describe('computeStreakState — epic AC table', () => {
  it('case 1: single-day write crossing 500 → currentStreak === 1', () => {
    const entry = mkEntry('e1', T0_DATE)
    const flow = mkFlow('f1', 'e1', 500)
    const state = computeStreakState([entry], [flow], [], T0_DATE, 'free')
    expect(state.currentStreak).toBe(1)
    expect(state.longestStreak).toBe(1)
    expect(state.lastQualifyingDate).toBe(T0_DATE)
    assertInvariants(state)
  })

  for (const N of [2, 7, 30] as const) {
    it(`case 2: ${N} consecutive days each crossing 500 → currentStreak === ${N}`, () => {
      const { entries, flows } = buildConsecutiveQualifyingDays(T0_DATE, N)
      const state = computeStreakState(entries, flows, [], T0_DATE, 'free')
      expect(state.currentStreak).toBe(N)
      expect(state.longestStreak).toBe(N)
      const expectedTokens = MILESTONES.filter((m) => m <= N).length
      expect(state.unlockTokensEarned).toBe(expectedTokens)
      assertInvariants(state)
    })
  }

  it('case 3: missed day with grace day applied → streak preserved', () => {
    const dMinus2 = shiftDay(T0_DATE, -2)
    const dMinus1 = shiftDay(T0_DATE, -1)
    const entries = [mkEntry('e-2', dMinus2), mkEntry('e-0', T0_DATE)]
    const flows = [mkFlow('f-2', 'e-2', 600), mkFlow('f-0', 'e-0', 600)]
    const grace = [mkGrace('g1', dMinus1)]
    const state = computeStreakState(entries, flows, grace, T0_DATE, 'free')
    expect(state.currentStreak).toBe(3)
    expect(state.longestStreak).toBe(3)
    assertInvariants(state)
  })

  it('case 4: missed day with no grace → streak broken; longest preserved', () => {
    // 5 prior consecutive qualifying days, then 2-day gap, then today qualifies.
    const today = T0_DATE
    const priorEnd = shiftDay(today, -3) // last of the 5-run
    const { entries: priorEntries, flows: priorFlows } = buildConsecutiveQualifyingDays(priorEnd, 5)
    const todayEntry = mkEntry('e-today', today)
    const todayFlow = mkFlow('f-today', 'e-today', 500)
    const state = computeStreakState(
      [...priorEntries, todayEntry],
      [...priorFlows, todayFlow],
      [],
      today,
      'free'
    )
    expect(state.currentStreak).toBe(1)
    expect(state.longestStreak).toBe(5)
    assertInvariants(state)
  })

  it('case 4 variant: today does not qualify either → currentStreak === 0, longestStreak preserved', () => {
    const today = T0_DATE
    const priorEnd = shiftDay(today, -3)
    const { entries: priorEntries, flows: priorFlows } = buildConsecutiveQualifyingDays(priorEnd, 5)
    const state = computeStreakState(priorEntries, priorFlows, [], today, 'free')
    expect(state.currentStreak).toBe(0)
    expect(state.longestStreak).toBe(5)
    assertInvariants(state)
  })

  it('case 5: timezone shift mid-streak — consecutive day-strings work regardless of tz origin', () => {
    const entries = [
      mkEntry('a', '2026-05-02'),
      mkEntry('b', '2026-05-03'),
      mkEntry('c', '2026-05-04'),
    ]
    const flows = [mkFlow('fa', 'a', 500), mkFlow('fb', 'b', 500), mkFlow('fc', 'c', 500)]
    const state = computeStreakState(entries, flows, [], '2026-05-04', 'free')
    expect(state.currentStreak).toBe(3)
    assertInvariants(state)
  })

  it('case 5b: user travels east, day rolls forward without writing → streak NOT broken', () => {
    const entries = [
      mkEntry('a', '2026-05-02'),
      mkEntry('b', '2026-05-03'),
      mkEntry('c', '2026-05-04'),
    ]
    const flows = [mkFlow('fa', 'a', 500), mkFlow('fb', 'b', 500), mkFlow('fc', 'c', 500)]
    const state = computeStreakState(entries, flows, [], '2026-05-05', 'free')
    expect(state.currentStreak).toBe(3)
    assertInvariants(state)
  })

  it('case 6: offline-then-sync — input ordering does not affect output', () => {
    const { entries, flows } = buildConsecutiveQualifyingDays(T0_DATE, 4)
    const inOrder = computeStreakState(entries, flows, [], T0_DATE, 'free')
    const reversed = computeStreakState(
      [...entries].reverse(),
      [...flows].reverse(),
      [],
      T0_DATE,
      'free'
    )
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(inOrder))
    assertInvariants(reversed)
  })

  it('case 7: multi-device same-day — two entries on same date sum to one qualifying day', () => {
    const entries = [mkEntry('e-A', T0_DATE), mkEntry('e-B', T0_DATE)]
    const flows = [mkFlow('fA', 'e-A', 300), mkFlow('fB', 'e-B', 300)]
    const state = computeStreakState(entries, flows, [], T0_DATE, 'free')
    expect(state.currentStreak).toBe(1)
    expect(state.longestStreak).toBe(1)
    assertInvariants(state)
  })

  it('case 8a: today sub-500 with otherwise-active streak → today is grace; yesterday qualifies → currentStreak === 2', () => {
    const dMinus2 = shiftDay(T0_DATE, -2)
    const dMinus1 = shiftDay(T0_DATE, -1)
    const entries = [mkEntry('e-2', dMinus2), mkEntry('e-1', dMinus1), mkEntry('e-0', T0_DATE)]
    const flows = [mkFlow('f-2', 'e-2', 600), mkFlow('f-1', 'e-1', 600), mkFlow('f-0', 'e-0', 400)]
    const state = computeStreakState(entries, flows, [], T0_DATE, 'free')
    expect(state.currentStreak).toBe(2)
    assertInvariants(state)
  })

  it('case 8b: today 0 words, yesterday sub-500 → currentStreak === 0', () => {
    const dMinus1 = shiftDay(T0_DATE, -1)
    const entries = [mkEntry('e-1', dMinus1)]
    const flows = [mkFlow('f-1', 'e-1', 400)]
    const state = computeStreakState(entries, flows, [], T0_DATE, 'free')
    expect(state.currentStreak).toBe(0)
    assertInvariants(state)
  })

  for (const tier of ['paid_monthly', 'paid_yearly'] as const) {
    it(`case 9: tier === '${tier}' → unlockedThemes is all THEME_NAMES regardless of streak`, () => {
      // currentStreak === 0
      const empty = computeStreakState([], [], [], T0_DATE, tier)
      expect([...empty.unlockedThemes].sort()).toEqual([...THEME_NAMES].sort())
      assertInvariants(empty)

      // currentStreak === 30
      const { entries, flows } = buildConsecutiveQualifyingDays(T0_DATE, 30)
      const big = computeStreakState(entries, flows, [], T0_DATE, tier)
      expect([...big.unlockedThemes].sort()).toEqual([...THEME_NAMES].sort())
      assertInvariants(big)
    })
  }

  it('case 10: free tier, no chosenUnlocks, longestStreak === 35 → passive map filtered ascending', () => {
    const { entries, flows } = buildConsecutiveQualifyingDays(T0_DATE, 35)
    const state = computeStreakState(entries, flows, [], T0_DATE, 'free')
    const expected = MILESTONES.filter((m) => state.longestStreak >= m).map(
      (m) => STREAK_THEME_UNLOCKS[m]
    )
    expect(state.unlockedThemes).toEqual(expected)
    assertInvariants(state)
  })

  it('case 11a: free tier, chosenUnlocks within tokens → returns chosen order', () => {
    const { entries, flows } = buildConsecutiveQualifyingDays(T0_DATE, 35)
    const chosen: ThemeName[] = ['fireside', 'leather']
    const state = computeStreakState(entries, flows, [], T0_DATE, 'free', chosen)
    expect(state.unlockedThemes).toEqual(['fireside', 'leather'])
    assertInvariants(state)
  })

  it('case 11b: free tier, chosenUnlocks exceeds tokens → silent cap (no throw), capped slice returned', () => {
    const { entries, flows } = buildConsecutiveQualifyingDays(T0_DATE, 35) // tokens = 2
    const chosen: ThemeName[] = ['fireside', 'leather', 'forest-morning']
    const state = computeStreakState(entries, flows, [], T0_DATE, 'free', chosen)
    expect(state.unlockedThemes).toHaveLength(2)
    expect(state.unlockedThemes).toEqual(['fireside', 'leather'])
    assertInvariants(state)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Group B: Defensive cases (AC 19)
// ─────────────────────────────────────────────────────────────────────────────

describe('computeStreakState — defensive cases', () => {
  it('empty inputs (array shape) → zeroed state', () => {
    const state = computeStreakState([], [], [], T0_DATE, 'free')
    expect(state).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      unlockTokensEarned: 0,
      unlockedThemes: [],
      nextUnlockMilestone: MILESTONES[0] ?? null,
      lastQualifyingDate: null,
    })
    assertInvariants(state)
  })

  it('empty inputs (Record shape) → zeroed state', () => {
    const state = computeStreakState({}, {}, {}, T0_DATE, 'free')
    expect(state.currentStreak).toBe(0)
    expect(state.longestStreak).toBe(0)
    expect(state.unlockedThemes).toEqual([])
    expect(state.lastQualifyingDate).toBeNull()
    assertInvariants(state)
  })

  it('tombstoned entry is ignored', () => {
    const tombstoned = mkEntry('e-dead', T0_DATE, { is_deleted: true } as Partial<Entry>)
    const flow = mkFlow('f1', 'e-dead', 999)
    const state = computeStreakState([tombstoned], [flow], [], T0_DATE, 'free')
    expect(state.currentStreak).toBe(0)
    expect(state.lastQualifyingDate).toBeNull()
    assertInvariants(state)
  })

  it('tombstoned flow is ignored', () => {
    const entry = mkEntry('e1', T0_DATE)
    const aliveFlow = mkFlow('f1', 'e1', 200)
    const deadFlow = mkFlow('f-dead', 'e1', 9999, { is_deleted: true } as Partial<Flow>)
    const state = computeStreakState([entry], [aliveFlow, deadFlow], [], T0_DATE, 'free')
    expect(state.currentStreak).toBe(0) // 200 < 500 after tombstone filter
    assertInvariants(state)
  })

  it('tombstoned grace day does not protect a missed day', () => {
    const dMinus2 = shiftDay(T0_DATE, -2)
    const dMinus1 = shiftDay(T0_DATE, -1)
    const entries = [mkEntry('e-2', dMinus2), mkEntry('e-0', T0_DATE)]
    const flows = [mkFlow('f-2', 'e-2', 600), mkFlow('f-0', 'e-0', 600)]
    const grace = [mkGrace('g-dead', dMinus1, { is_deleted: true } as Partial<GraceDay>)]
    const state = computeStreakState(entries, flows, grace, T0_DATE, 'free')
    expect(state.currentStreak).toBe(1)
    assertInvariants(state)
  })

  it('grace day with usedForDate === null does not protect any day', () => {
    const dMinus2 = shiftDay(T0_DATE, -2)
    const entries = [mkEntry('e-2', dMinus2), mkEntry('e-0', T0_DATE)]
    const flows = [mkFlow('f-2', 'e-2', 600), mkFlow('f-0', 'e-0', 600)]
    const grace = [mkGrace('g-unspent', null)]
    const state = computeStreakState(entries, flows, grace, T0_DATE, 'free')
    expect(state.currentStreak).toBe(1)
    assertInvariants(state)
  })

  it('Record-shape input produces identical output to array-shape input', () => {
    const { entries, flows } = buildConsecutiveQualifyingDays(T0_DATE, 5)
    const arrState = computeStreakState(entries, flows, [], T0_DATE, 'free')
    const entriesRec: Record<string, Entry> = Object.fromEntries(entries.map((e) => [e.id, e]))
    const flowsRec: Record<string, Flow> = Object.fromEntries(flows.map((f) => [f.id, f]))
    const recState = computeStreakState(entriesRec, flowsRec, {}, T0_DATE, 'free')
    expect(JSON.stringify(recState)).toBe(JSON.stringify(arrState))
    assertInvariants(recState)
  })

  it('DST boundary day arithmetic: 5 consecutive days across US/Pacific DST start', () => {
    const today = '2026-03-09'
    const { entries, flows } = buildConsecutiveQualifyingDays(today, 5)
    // Sanity: confirm dates span the DST boundary night (Mar 8 → Mar 9 PST→PDT)
    expect(entries.map((e) => e.entryDate)).toEqual([
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ])
    const state = computeStreakState(entries, flows, [], today, 'free')
    expect(state.currentStreak).toBe(5)
    assertInvariants(state)
  })

  it('returned unlockedThemes is a fresh copy — caller mutation does not affect inputs', () => {
    const { entries, flows } = buildConsecutiveQualifyingDays(T0_DATE, 35)
    const chosen: ThemeName[] = ['fireside']
    const stateA = computeStreakState(entries, flows, [], T0_DATE, 'free', chosen)
    stateA.unlockedThemes.push('leather')
    expect(chosen).toEqual(['fireside']) // original input untouched
    const stateB = computeStreakState(entries, flows, [], T0_DATE, 'free', chosen)
    expect(stateB.unlockedThemes).toEqual(['fireside']) // result not contaminated
    assertInvariants(stateB)
  })

  // FMA defensive cases
  it('duplicate flow ids on the same day still sum word counts', () => {
    const entry = mkEntry('e1', T0_DATE)
    // Two flows with same id — malformed input class. Function must not crash; sums them.
    const f1 = mkFlow('dup', 'e1', 300)
    const f2 = mkFlow('dup', 'e1', 300)
    const state = computeStreakState([entry], [f1, f2], [], T0_DATE, 'free')
    expect(state.currentStreak).toBe(1)
    assertInvariants(state)
  })

  it('orphan flow (dailyEntryId points at non-existent entry) contributes zero', () => {
    const entry = mkEntry('e-real', T0_DATE)
    const realFlow = mkFlow('f-real', 'e-real', 500)
    const orphan = mkFlow('f-orphan', 'e-missing', 9999)
    const state = computeStreakState([entry], [realFlow, orphan], [], T0_DATE, 'free')
    expect(state.currentStreak).toBe(1)
    expect(state.longestStreak).toBe(1) // orphan does not inflate any day
    assertInvariants(state)
  })

  it('malformed entryDate is silently dropped', () => {
    const validEntry = mkEntry('e-valid', T0_DATE)
    const validFlow = mkFlow('f-valid', 'e-valid', 500)
    const bogus = mkEntry('e-bogus', '   ')
    const bogusFlow = mkFlow('f-bogus', 'e-bogus', 9999)
    const state = computeStreakState(
      [validEntry, bogus],
      [validFlow, bogusFlow],
      [],
      T0_DATE,
      'free'
    )
    expect(state.currentStreak).toBe(1)
    assertInvariants(state)
  })

  it('today lexically earlier than every entry → currentStreak 0; lastQualifyingDate is most-recent in input', () => {
    const future = '2026-06-01'
    const entry = mkEntry('e-future', future)
    const flow = mkFlow('f-future', 'e-future', 500)
    const state = computeStreakState([entry], [flow], [], T0_DATE, 'free')
    expect(state.currentStreak).toBe(0)
    expect(state.longestStreak).toBe(1)
    expect(state.lastQualifyingDate).toBe(future)
    assertInvariants(state)
  })

  it('grace day usedForDate points at a day with no entry — still protects the streak', () => {
    const dMinus2 = shiftDay(T0_DATE, -2)
    const dMinus1 = shiftDay(T0_DATE, -1)
    const entries = [mkEntry('e-2', dMinus2), mkEntry('e-0', T0_DATE)]
    const flows = [mkFlow('f-2', 'e-2', 600), mkFlow('f-0', 'e-0', 600)]
    const grace = [mkGrace('g1', dMinus1)] // no entry exists for dMinus1
    const state = computeStreakState(entries, flows, grace, T0_DATE, 'free')
    expect(state.currentStreak).toBe(3)
    assertInvariants(state)
  })

  it('two grace days pointing at the same usedForDate are idempotent', () => {
    const dMinus2 = shiftDay(T0_DATE, -2)
    const dMinus1 = shiftDay(T0_DATE, -1)
    const entries = [mkEntry('e-2', dMinus2), mkEntry('e-0', T0_DATE)]
    const flows = [mkFlow('f-2', 'e-2', 600), mkFlow('f-0', 'e-0', 600)]
    const grace = [mkGrace('g1', dMinus1), mkGrace('g2', dMinus1)]
    const state = computeStreakState(entries, flows, grace, T0_DATE, 'free')
    expect(state.currentStreak).toBe(3)
    expect(state.longestStreak).toBe(3) // not 4 — protected day counted once
    assertInvariants(state)
  })

  it('wordCount === 500 exactly qualifies; 499 does not', () => {
    const entry500 = mkEntry('e-500', T0_DATE)
    const flow500 = mkFlow('f-500', 'e-500', 500)
    const state500 = computeStreakState([entry500], [flow500], [], T0_DATE, 'free')
    expect(state500.currentStreak).toBe(1)
    assertInvariants(state500)

    const entry499 = mkEntry('e-499', T0_DATE)
    const flow499 = mkFlow('f-499', 'e-499', 499)
    const state499 = computeStreakState([entry499], [flow499], [], T0_DATE, 'free')
    expect(state499.currentStreak).toBe(0)
    assertInvariants(state499)
  })

  it('negative or NaN wordCount is clamped to 0', () => {
    const entry = mkEntry('e1', T0_DATE)
    const negFlow = mkFlow('fneg', 'e1', -5)
    const nanFlow = mkFlow('fnan', 'e1', Number.NaN as unknown as number)
    const state = computeStreakState([entry], [negFlow, nanFlow], [], T0_DATE, 'free')
    expect(state.currentStreak).toBe(0)
    assertInvariants(state)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Group C: Contracts — determinism, scale, output shape (AC 26, 27, 28)
// ─────────────────────────────────────────────────────────────────────────────

describe('computeStreakState — contracts (determinism, scale, shape)', () => {
  it('determinism: same inputs twice → deeply-equal output (AC 26)', () => {
    const { entries, flows } = buildConsecutiveQualifyingDays(T0_DATE, 12)
    const grace = [mkGrace('g1', shiftDay(T0_DATE, -50))]
    const a = computeStreakState(entries, flows, grace, T0_DATE, 'free')
    const b = computeStreakState(entries, flows, grace, T0_DATE, 'free')
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('scale smoke: 1000 consecutive qualifying days < 2s (AC 27)', () => {
    const { entries, flows } = buildConsecutiveQualifyingDays(T0_DATE, 1000)
    const t0 = performance.now()
    const state = computeStreakState(entries, flows, [], T0_DATE, 'free')
    const elapsed = performance.now() - t0
    expect(state.currentStreak).toBe(1000)
    expect(state.longestStreak).toBe(1000)
    expect(elapsed).toBeLessThan(2000)
    assertInvariants(state)
  })

  it('output shape exhaustiveness: exactly the six declared fields (AC 28)', () => {
    const state = computeStreakState([], [], [], T0_DATE, 'free')
    expect(Object.keys(state).sort()).toEqual(
      [
        'currentStreak',
        'lastQualifyingDate',
        'longestStreak',
        'nextUnlockMilestone',
        'unlockTokensEarned',
        'unlockedThemes',
      ].sort()
    )
  })

  it('MILESTONES is sorted ascending and matches STREAK_THEME_UNLOCKS keys', () => {
    const keysFromMap = Object.keys(STREAK_THEME_UNLOCKS)
      .map(Number)
      .sort((a, b) => a - b)
    expect([...MILESTONES]).toEqual(keysFromMap)
  })
})
