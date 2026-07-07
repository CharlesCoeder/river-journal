/**
 * state/today.ts
 *
 * Midnight-rollover tick. Holds the current "Journal Day" (YYYY-MM-DD) as an
 * observable that advances at the next LOCAL midnight (re-armed each day) and is
 * re-checked whenever the app returns to the foreground. Streak/day surfaces read
 * `today$` (via the streak computed) or `useToday()` (in React) instead of calling
 * getTodayJournalDayString() inline, so a display rendered at 11:59pm updates
 * itself at 12:00am without waiting for a remount or the next journal write.
 *
 * Deliberately narrow (see the tradeoff note in state/streak.ts): this is NOT a
 * general time-handling refactor — only the single day-key that streak math and
 * the date hero depend on. All journal-day math still flows through
 * getTodayJournalDayString(); this module just keeps that key fresh over time.
 */
import { observable } from '@legendapp/state'
import { use$ } from '@legendapp/state/react'
import { AppState, type AppStateStatus } from 'react-native'
import { getTodayJournalDayString } from './date-utils'

/** Current Journal Day 'YYYY-MM-DD'. Seeded at module load; advanced by the tick. */
export const today$ = observable<string>(getTodayJournalDayString())

/** Recompute the day-key and write ONLY on an actual change (avoids churn). */
const syncToday = (): void => {
  const current = getTodayJournalDayString()
  if (today$.peek() !== current) {
    today$.set(current)
  }
}

/** ms from now until just after the next local midnight (+1s cushion). */
const msUntilNextMidnight = (): number => {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0)
  return Math.max(1000, next.getTime() - now.getTime())
}

let midnightTimer: ReturnType<typeof setTimeout> | null = null
let appStateSub: { remove: () => void } | null = null

const armMidnightTimer = (): void => {
  if (midnightTimer !== null) clearTimeout(midnightTimer)
  midnightTimer = setTimeout(() => {
    syncToday()
    armMidnightTimer() // re-arm for the following midnight
  }, msUntilNextMidnight())
}

/**
 * Idempotent. Call once from app init. Arms the midnight timer plus an AppState
 * foreground listener — belt-and-braces for a device that slept THROUGH midnight
 * (where the setTimeout may not fire on time): on foreground we re-check the day
 * and re-arm the timer.
 *
 * NOTE: intentionally NOT wired to the TanStack focusManager in
 * state/queryClient.native.ts — that AppState bridge exists for query refetching
 * and must stay independent of this day-key tick.
 */
export const startTodayTracking = (): (() => void) => {
  syncToday()
  armMidnightTimer()

  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') {
        syncToday()
        armMidnightTimer()
      }
    })
  }

  return stopTodayTracking
}

/** Tear down the timer + listener. Exposed for symmetry and test cleanup. */
export const stopTodayTracking = (): void => {
  if (midnightTimer !== null) {
    clearTimeout(midnightTimer)
    midnightTimer = null
  }
  if (appStateSub) {
    appStateSub.remove()
    appStateSub = null
  }
}

/** React hook: current Journal Day 'YYYY-MM-DD', re-rendering at local midnight. */
export const useToday = (): string => use$(today$)
