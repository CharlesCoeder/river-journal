/**
 * state/streak.ts
 *
 * Pure-function client-side streak math + reactive wiring layer.
 * Architecture refs: D3 (client-authoritative streak math), D7 (boundary rule),
 * NFR20 (zero streak miscount — table-driven test surface is the contract).
 *
 * Pure function section: NO observable reads, NO I/O, NO side effects.
 * Wiring section (below computeStreakState): attaches streak$ computed view to store$.
 */

import { use$ } from '@legendapp/state/react'
import type { Entry, Flow, GraceDay, ThemeName } from './types'
import { THEME_NAMES } from './types'
import { store$ } from './store'
import { entries$ } from './entries'
import { flows$ } from './flows'
import { graceDays$ } from './grace_days'
import { getTodayJournalDayString } from './date-utils'

// Milestone numbers — placeholder pending Charlie's lock-in. Single source of truth: change here, test outputs follow.
export const STREAK_THEME_UNLOCKS: Readonly<Record<number, ThemeName>> = {
  7: 'forest-morning',
  30: 'leather',
  90: 'forest-night',
  180: 'fireside',
} as const

export const MILESTONES: readonly number[] = Object.keys(STREAK_THEME_UNLOCKS)
  .map(Number)
  .sort((a, b) => a - b)

// Module-level shared reference — paid-tier callers all get the same array
// (referential stability for memo'd consumers). Built once at module load.
// We intentionally do NOT call Object.freeze here: freezing would change the
// inferred type to `readonly ThemeName[]`, which conflicts with the hook's
// declared `ThemeName[]` return. Mutation is prevented by convention + the
// hook never exposing this constant directly. If runtime-mutation paranoia is
// warranted later, change the hook's return type to `readonly ThemeName[]`
// and freeze (a coordinated change across all consumers).
const PAID_TIER_THEMES: ThemeName[] = [...THEME_NAMES]

export interface StreakState {
  currentStreak: number
  longestStreak: number
  unlockTokensEarned: number
  unlockedThemes: ThemeName[]
  nextUnlockMilestone: number | null
  lastQualifyingDate: string | null
}

export type SubscriptionTier = 'free' | 'paid_monthly' | 'paid_yearly'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Add `delta` calendar days to a 'YYYY-MM-DD' string using UTC arithmetic.
 *
 * UTC arithmetic is intentional: the inputs are already user-local-derived
 * day keys (opaque calendar strings). Doing arithmetic with `new Date(y,m,d)`
 * (local) would re-introduce DST/timezone bugs we are explicitly avoiding.
 */
function addDays(yyyymmdd: string, delta: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d) + delta * 86_400_000
  const dt = new Date(ms)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

function toArray<T>(input: Record<string, T> | T[]): T[] {
  return Array.isArray(input) ? input : Object.values(input)
}

/**
 * Pure function — derives current streak state from journal data.
 *
 * @param entries Daily entries (array or keyed record).
 * @param flows Flow rows (array or keyed record).
 * @param graceDays Grace day rows (array or keyed record).
 * @param today 'YYYY-MM-DD' day key from `getTodayJournalDayString()` upstream.
 * @param tier - until Story 7.1 ships the subscription_tier enum, callers should pass 'free' literally
 * @param chosenUnlocks Optional Model B forward-compat: caller-chosen theme picks for free tier.
 *
 * @returns StreakState — a snapshot view; inputs are not mutated.
 *   - currentStreak: consecutive qualifying-or-grace-protected days ending at/just before today.
 *   - longestStreak: max consecutive run observed across all input.
 *   - unlockTokensEarned: count of milestones strictly ≤ longestStreak.
 *   - unlockedThemes: derived theme list (paid bypass / passive map / chosenUnlocks slice).
 *   - nextUnlockMilestone: smallest milestone strictly > currentStreak, or null.
 *   - lastQualifyingDate: most recent covered day in input (qualifying OR grace-protected).
 */
export function computeStreakState(
  entries: Record<string, Entry> | Entry[],
  flows: Record<string, Flow> | Flow[],
  graceDays: Record<string, GraceDay> | GraceDay[],
  today: string,
  tier: SubscriptionTier,
  chosenUnlocks?: ThemeName[]
): StreakState {
  // Normalize inputs to arrays + defensively drop tombstones (sync layer already
  // filters these for observable inputs; defensive for direct-array test inputs).
  const entriesArr = toArray(entries).filter((e) => !(e as { is_deleted?: boolean }).is_deleted)
  const flowsArr = toArray(flows).filter((f) => !(f as { is_deleted?: boolean }).is_deleted)
  const graceArr = toArray(graceDays).filter((g) => !(g as { is_deleted?: boolean }).is_deleted)

  // entry.id → entryDate (only for entries with valid 'YYYY-MM-DD' shape — guards malformed sync payloads)
  const entryIdToDate = new Map<string, string>()
  for (const e of entriesArr) {
    if (typeof e.entryDate === 'string' && DATE_RE.test(e.entryDate)) {
      entryIdToDate.set(e.id, e.entryDate)
    }
  }

  // Sum word counts per entryDate. Orphan flows (dailyEntryId not in entryIdToDate) contribute 0.
  const wordCountByDate = new Map<string, number>()
  for (const f of flowsArr) {
    const date = entryIdToDate.get(f.dailyEntryId)
    if (!date) continue
    const wc = Number.isFinite(f.wordCount) ? Math.max(0, f.wordCount as number) : 0
    wordCountByDate.set(date, (wordCountByDate.get(date) ?? 0) + wc)
  }

  // Qualifying days: summed wordCount ≥ 500.
  const qualifyingDays = new Set<string>()
  for (const [date, wc] of wordCountByDate) {
    if (wc >= 500) qualifyingDays.add(date)
  }

  // Grace-protected days: any non-null usedForDate (already tombstone-filtered above).
  const graceProtectedDays = new Set<string>()
  for (const g of graceArr) {
    if (g.usedForDate && DATE_RE.test(g.usedForDate)) {
      graceProtectedDays.add(g.usedForDate)
    }
  }

  // Covered days = qualifying ∪ grace-protected.
  const coveredDays = new Set<string>([...qualifyingDays, ...graceProtectedDays])

  // currentStreak: backwards walk from `today`. If today doesn't qualify, today is grace
  // period — start the walk at today-1. Streak only breaks on a fully-elapsed day that
  // failed to qualify AND lacks a grace day.
  let currentStreak = 0
  let cursor = today
  if (!coveredDays.has(today)) {
    cursor = addDays(today, -1)
  }
  while (coveredDays.has(cursor)) {
    currentStreak++
    cursor = addDays(cursor, -1)
  }

  // longestStreak via boundary-detection on sorted covered days.
  // Algorithm choice: sort covered-days array, single-pass run-length scan (O(D log D)).
  // Chosen over backwards-walk-with-memoization (harder to audit) and Set+addDays-probe
  // (repeated string allocs). Do not swap without re-running the test surface.
  const sorted = [...coveredDays].sort()
  let observedMax = 0
  let run = 0
  let prev: string | null = null
  for (const d of sorted) {
    if (prev !== null && addDays(prev, 1) === d) {
      run++
    } else {
      run = 1
    }
    if (run > observedMax) observedMax = run
    prev = d
  }
  const longestStreak = Math.max(observedMax, currentStreak)

  // unlockTokensEarned keys off longestStreak (durable rewards — D5).
  const unlockTokensEarned = MILESTONES.filter((m) => m <= longestStreak).length

  // nextUnlockMilestone keys off currentStreak (user-facing "next reward at Day N").
  let nextUnlockMilestone: number | null = null
  for (const m of MILESTONES) {
    if (m > currentStreak) {
      nextUnlockMilestone = m
      break
    }
  }

  // unlockedThemes: paid bypass / Model B chosen / Model A passive map.
  let unlockedThemes: ThemeName[]
  if (tier === 'paid_monthly' || tier === 'paid_yearly') {
    unlockedThemes = [...THEME_NAMES]
  } else if (chosenUnlocks !== undefined) {
    // Model B: silent cap at unlockTokensEarned; preserve caller order.
    unlockedThemes = chosenUnlocks.slice(0, unlockTokensEarned)
  } else {
    // Model A passive map: milestone-ascending order, filtered by longestStreak.
    unlockedThemes = MILESTONES.filter((m) => longestStreak >= m).map(
      (m) => STREAK_THEME_UNLOCKS[m]
    )
  }

  // lastQualifyingDate: most recent covered day in input (includes grace-protected).
  const lastQualifyingDate = sorted.length > 0 ? sorted[sorted.length - 1] : null

  return {
    currentStreak,
    longestStreak,
    unlockTokensEarned,
    unlockedThemes,
    nextUnlockMilestone,
    lastQualifyingDate,
  }
}

/**
 * Reactively returns the unlocked-themes list for the current streak state and the
 * given subscription tier. Re-renders the calling component when underlying state
 * (entries, flows, grace days, today, tier-passed-in, chosenUnlocks) changes.
 *
 * Note on subscription granularity: this hook calls `use$(store$.views.streak)`
 * which subscribes the calling component to the WHOLE StreakState object. If a
 * consumer needs only `currentStreak` (e.g., StreakChip in Story 2.7), they
 * should call `use$(store$.views.streak.currentStreak)` directly rather than
 * destructuring from this hook's output.
 *
 * The 'free' branch returns the user-chosen `unlockedThemes` (sourced from
 * `users.preferences.unlockedThemes` via `chosenUnlocks`). The hook signature
 * is unchanged; its returned values come from `streak.unlockedThemes`, which
 * is driven by `chosenUnlocks` in the wiring block below.
 *
 * @param tier 'free' | 'paid_monthly' | 'paid_yearly' — until subscription_tier
 *             ships, callers pass 'free' literally.
 * @returns ThemeName[] — paid: all six (referentially stable across calls);
 *          free: user-chosen unlocks via chosenUnlocks.
 */
/**
 * Returns the subscription tier for the ThemePicker.
 * Returns 'free' today. Exported as a seam for test injection.
 */
export function getThemePickerTier(): SubscriptionTier {
  return 'free'
}

export function useUnlockedThemes(tier: SubscriptionTier): ThemeName[] {
  // PAID-TIER EARLY RETURN — must run BEFORE use$() so that:
  //   (a) paid-tier callers do NOT subscribe to streak$ at all (perf: no re-render
  //       when streak changes for paid users who don't care), AND
  //   (b) referential-stability tests can call this hook outside a React render
  //       context for paid tiers without tripping use$'s component guard.
  if (tier === 'paid_monthly' || tier === 'paid_yearly') {
    return PAID_TIER_THEMES
  }
  // use$(store$.views.streak) subscribes the calling component to the whole
  // StreakState object via Legend-State's useSyncExternalStore wrapper.
  // store$.views.streak is always defined after module load (attached just below).
  const streak = use$(store$.views.streak!) as unknown as StreakState
  return streak.unlockedThemes
  // Once streak$ baked-in tier becomes dynamic, the paid-tier branch above
  // becomes redundant — remove it then.
}

// Midnight-rollover behavior: this computed reads getTodayJournalDayString()
// inline. It does NOT auto-recompute when the wall clock crosses midnight —
// it recomputes only when entries$/flows$/graceDays$ change. The next write
// (or app foreground that triggers a sync read) will pick up the new day.
// If a future surface needs midnight-precise reactivity (e.g., a clock-driven
// "your streak is in danger today" surface), inject `today` as an observable
// and write to it on a daily timer at the app shell level.

// Side-effect: attaches streak$ computed view on module import. Imported transitively via app/state/store re-exports + initializeApp.
// Type cast: store$.assign takes Partial<AppState>; here we deep-merge only the views.streak key.
// Legend-State's assign() merges deeply, so passing a partial views object is safe at runtime.
store$.assign({
  views: {
    streak: () =>
      computeStreakState(
        entries$.get(),
        flows$.get(),
        graceDays$.get(),
        getTodayJournalDayString(),
        'free',
        // chosenUnlocks: user-spent token destinations (Model B). When store$.profile is null
        // (cold-start window before rehydration), unlockedThemes.get() returns undefined → ?? undefined
        // → computeStreakState falls back to passive-map branch. Once profile loads, streak$
        // re-evaluates with the user's actual chosen array.
        store$.profile.unlockedThemes.get() ?? undefined
      ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
})
