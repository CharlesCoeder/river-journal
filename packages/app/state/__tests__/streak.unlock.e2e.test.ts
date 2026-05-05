/**
 * streak.unlock.e2e.test.ts — user-chosen unlock token (Model B) E2E tests.
 *
 * Covers:
 *   - chosenUnlocks wiring through streak$
 *   - spendUnlockToken action
 *   - ensureProfile backfill (legacy profiles without unlockedThemes)
 *
 * Standalone file (not extending streak-view.test.ts) to isolate profile state
 * without risking the existing computed-streak observable tests.
 *
 * Verified semantic summary:
 *   chosenUnlocks: undefined  → passive-map branch → ['forest-morning', 'leather'] for longestStreak≥30
 *   chosenUnlocks: []         → chosen-slice branch → []
 *   chosenUnlocks: ['fireside'] → chosen-slice branch → ['fireside']
 * The wiring always passes an array (never undefined) once profile is loaded.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { batch } from '@legendapp/state'

vi.mock('../../utils/supabase', () => ({
  supabase: {},
}))

import { store$ } from '../store'
import { spendUnlockToken } from '../store'
import { setTheme } from '../store'
import { entries$ } from '../entries'
import { flows$ } from '../flows'
import { graceDays$ } from '../grace_days'
// Import streak to trigger store$.assign({ views: { streak: ... } }) wiring
import '../streak'

// Helper to create a qualifying entry + flow (500+ words) for a given date
let entryIdCounter = 0
function makeQualifyingDay(date: string) {
  const entryId = `entry-${date}-${++entryIdCounter}`
  const flowId = `flow-${date}-${entryIdCounter}`
  return {
    entry: {
      id: entryId,
      entryDate: date,
      lastModified: `${date}T12:00:00Z`,
      local_session_id: 'test-session',
    },
    flow: {
      id: flowId,
      dailyEntryId: entryId,
      timestamp: `${date}T12:00:00Z`,
      content: 'x'.repeat(500),
      wordCount: 500,
      local_session_id: 'test-session',
    },
  }
}

function addDays(base: string, n: number): string {
  const [y, m, d] = base.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d) + n * 86_400_000
  const dt = new Date(ms)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

// Seed entries + flows so that longestStreak >= 30 (unlockTokensEarned === 2 for milestones [7,30])
function seedStreakData(days: number, baseDate: string) {
  const entriesObj: Record<string, any> = {}
  const flowsObj: Record<string, any> = {}
  for (let i = 0; i < days; i++) {
    const date = addDays(baseDate, i - days + 1)
    const { entry, flow } = makeQualifyingDay(date)
    entriesObj[entry.id] = entry
    flowsObj[flow.id] = flow
  }
  entries$.set(entriesObj as any)
  flows$.set(flowsObj as any)
  graceDays$.set({} as any)
}

beforeEach(() => {
  store$.profile.set(null)
  entries$.set({} as any)
  flows$.set({} as any)
  graceDays$.set({} as any)
  entryIdCounter = 0
})

// ==========================================================================
// chosenUnlocks wiring
// ==========================================================================

describe('chosenUnlocks wiring', () => {
  it('returns [] (not passive-map) when unlockedThemes: []', () => {
    // Seed 30 qualifying days so unlockTokensEarned === 2 (milestones at 7 and 30)
    seedStreakData(30, '2026-04-05')

    // Profile with unlockedThemes: [] (loaded profile, no tokens spent yet)
    store$.profile.set({
      word_goal: 750,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      editor: { focusMode: false },
      unlockedThemes: [],
      sync: { word_goal: true, themeName: true, customTheme: true, fontPairing: true },
    } as any)

    const streakState = store$.views.streak.get()

    // CRITICAL SEMANTIC: chosenUnlocks = [] → chosen-slice branch → []
    // NOT the passive-map output ['forest-morning', 'leather']
    expect(streakState.unlockedThemes).toEqual([])
    expect(streakState.unlockTokensEarned).toBe(2)
  })

  it('reflects chosen theme after profile mutation', () => {
    seedStreakData(30, '2026-04-05')

    store$.profile.set({
      word_goal: 750,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      editor: { focusMode: false },
      unlockedThemes: [],
      sync: { word_goal: true, themeName: true, customTheme: true, fontPairing: true },
    } as any)

    // Initially []
    expect(store$.views.streak.get().unlockedThemes).toEqual([])

    // Mutate profile to add 'fireside'
    batch(() => {
      store$.profile.unlockedThemes.set(['fireside'])
    })

    // After mutation: chosen-slice(['fireside']).slice(0, 2) → ['fireside']
    const updated = store$.views.streak.get()
    expect(updated.unlockedThemes).toEqual(['fireside'])
  })

  it('passes unknown strings verbatim without crashing (JSONB tolerance)', () => {
    // Seed enough for unlockTokensEarned >= 2
    seedStreakData(30, '2026-04-05')

    store$.profile.set({
      word_goal: 750,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      editor: { focusMode: false },
      unlockedThemes: ['not-a-theme' as any, 'forest-morning'],
      sync: { word_goal: true, themeName: true, customTheme: true, fontPairing: true },
    } as any)

    // computeStreakState does NOT validate chosenUnlocks — passes through verbatim
    // sliced to unlockTokensEarned (2). No throw expected.
    let state: any
    expect(() => {
      state = store$.views.streak.get()
    }).not.toThrow()

    expect(state.unlockedThemes).toEqual(['not-a-theme', 'forest-morning'])
  })
})

// ==========================================================================
// A1–A4: spendUnlockToken action
// ==========================================================================

describe('spendUnlockToken action', () => {
  it('adds theme to array', () => {
    store$.profile.set({
      word_goal: 750,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      editor: { focusMode: false },
      unlockedThemes: [],
      sync: { word_goal: true, themeName: true, customTheme: true, fontPairing: true },
    } as any)

    spendUnlockToken('forest-morning')

    expect(store$.profile.unlockedThemes.get()).toEqual(['forest-morning'])
  })

  it('is idempotent — no duplicate on second call', () => {
    store$.profile.set({
      word_goal: 750,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      editor: { focusMode: false },
      unlockedThemes: [],
      sync: { word_goal: true, themeName: true, customTheme: true, fontPairing: true },
    } as any)

    spendUnlockToken('forest-morning')
    spendUnlockToken('forest-morning') // second call — no-op

    expect(store$.profile.unlockedThemes.get()).toEqual(['forest-morning'])
  })

  it('appends without overwriting existing entry', () => {
    store$.profile.set({
      word_goal: 750,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      editor: { focusMode: false },
      unlockedThemes: ['fireside'],
      sync: { word_goal: true, themeName: true, customTheme: true, fontPairing: true },
    } as any)

    spendUnlockToken('forest-morning')

    expect(store$.profile.unlockedThemes.get()).toEqual(['fireside', 'forest-morning'])
  })

  it('calls ensureProfile for null profile', () => {
    expect(store$.profile.get()).toBeNull()

    spendUnlockToken('forest-morning')

    expect(store$.profile.get()).not.toBeNull()
    expect(store$.profile.unlockedThemes.get()).toEqual(['forest-morning'])
  })
})

// ==========================================================================
// B1–B2: ensureProfile backfill
// ==========================================================================

describe('ensureProfile backfill', () => {
  it('backfills [] on legacy profile with editor but no unlockedThemes', () => {
    // Simulate a persisted profile from before unlockedThemes was added — has editor but no unlockedThemes
    store$.profile.set({
      word_goal: 750,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      editor: { focusMode: false },
      // unlockedThemes deliberately absent
      sync: { word_goal: true, themeName: true, customTheme: true, fontPairing: true },
    } as any)

    // Trigger any action that calls ensureProfile
    setTheme('ink')

    expect(store$.profile.unlockedThemes.get()).toEqual([])
  })

  it('includes unlockedThemes: [] on fresh profile', () => {
    expect(store$.profile.get()).toBeNull()

    // Trigger ensureProfile via any action
    setTheme('night')

    expect(store$.profile.get()).not.toBeNull()
    expect(store$.profile.unlockedThemes.get()).toEqual([])
  })
})
