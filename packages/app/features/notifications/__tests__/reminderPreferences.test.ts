/**
 * Red-phase unit tests for `features/notifications/reminderPreferences.ts`.
 *
 * Red-phase contract: every test MUST fail until the target module exists —
 * the whole file fails at the top-level import with a module-resolution
 * error, per this repo's established red-phase convention.
 *
 * Contract locked in for the implementation,
 * mirroring `features/moderation-receipts/acknowledgment.ts`'s idempotent,
 * null-safe, read-merge-write-the-whole-map pattern:
 *
 *   markStreakPromptSeen(now?: string): void
 *     — writes users.preferences.reminders.streak.permissionPromptSeenAt.
 *     Write-once: does not clobber an existing timestamp. Null-safe against
 *     a null store$.profile (never throws).
 *
 *   setPushPermissionDenied(now?: string): void
 *     — writes users.preferences.reminders.streak.permissionLastDeniedAt.
 *     Write-once semantics mirrored the same way. Null-safe.
 *
 *   hasSeenStreakPrompt(): boolean
 *     — synchronous, null-safe read of permissionPromptSeenAt presence.
 *
 * Uses the REAL `store$` (not mocked) exactly like
 * `state/collective/__tests__/moderationReceipts.test.ts` does for
 * `acknowledgeReceipt` — the write path IS a real Legend-State observable
 * write and is only meaningfully testable against the real object.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const BASE_PROFILE = {
  word_goal: 500,
  themeName: 'ink',
  customTheme: null,
  fontPairing: 'outfit-newsreader',
  hotkeyOverrides: {},
  sync: { word_goal: false, themeName: false, customTheme: false, fontPairing: false },
} as const

describe('reminderPreferences — markStreakPromptSeen / setPushPermissionDenied / hasSeenStreakPrompt', () => {
  let store$: typeof import('app/state/store').store$

  beforeEach(async () => {
    const storeModule = await import('app/state/store')
    store$ = storeModule.store$
    store$.profile.set(null)
  })

  // ── Null-safety ──────────────────────────────────────────────────────────
  it('hasSeenStreakPrompt returns false when store$.profile is null', async () => {
    const { hasSeenStreakPrompt } = await import('../reminderPreferences')
    expect(hasSeenStreakPrompt()).toBe(false)
  })

  it('markStreakPromptSeen does not throw when store$.profile is null', async () => {
    const { markStreakPromptSeen } = await import('../reminderPreferences')
    expect(() => markStreakPromptSeen()).not.toThrow()
  })

  it('setPushPermissionDenied does not throw when store$.profile is null', async () => {
    const { setPushPermissionDenied } = await import('../reminderPreferences')
    expect(() => setPushPermissionDenied()).not.toThrow()
  })

  it('hasSeenStreakPrompt returns false when preferences.reminders is undefined (null-safe read)', async () => {
    store$.profile.set({ ...BASE_PROFILE, preferences: {} } as any)
    const { hasSeenStreakPrompt } = await import('../reminderPreferences')
    expect(hasSeenStreakPrompt()).toBe(false)
  })

  // ── markStreakPromptSeen ────────────────────────────────────────────────
  it('markStreakPromptSeen writes a non-empty ISO permissionPromptSeenAt under preferences.reminders.streak', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { markStreakPromptSeen } = await import('../reminderPreferences')
    markStreakPromptSeen()

    const seenAt = (
      store$.profile as any
    ).preferences?.reminders?.streak?.permissionPromptSeenAt?.get?.()
    expect(typeof seenAt).toBe('string')
    expect(new Date(seenAt).toISOString()).toBe(seenAt)
  })

  it('markStreakPromptSeen accepts an explicit `now` argument', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { markStreakPromptSeen } = await import('../reminderPreferences')
    const now = '2026-07-11T10:00:00.000Z'
    markStreakPromptSeen(now)

    const seenAt = (
      store$.profile as any
    ).preferences?.reminders?.streak?.permissionPromptSeenAt?.get?.()
    expect(seenAt).toBe(now)
  })

  it('hasSeenStreakPrompt returns true immediately after markStreakPromptSeen writes (synchronous read)', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { markStreakPromptSeen, hasSeenStreakPrompt } = await import('../reminderPreferences')
    expect(hasSeenStreakPrompt()).toBe(false)
    markStreakPromptSeen()
    expect(hasSeenStreakPrompt()).toBe(true)
  })

  it('a second markStreakPromptSeen call is idempotent — does not overwrite the first timestamp', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { markStreakPromptSeen } = await import('../reminderPreferences')
    const first = '2026-07-01T10:00:00.000Z'
    const second = '2026-07-05T10:00:00.000Z'

    markStreakPromptSeen(first)
    markStreakPromptSeen(second)

    const seenAt = (
      store$.profile as any
    ).preferences?.reminders?.streak?.permissionPromptSeenAt?.get?.()
    expect(seenAt).toBe(first)
    expect(seenAt).not.toBe(second)
  })

  // ── setPushPermissionDenied ─────────────────────────────────────────────
  it('setPushPermissionDenied writes a non-empty ISO permissionLastDeniedAt under preferences.reminders.streak', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { setPushPermissionDenied } = await import('../reminderPreferences')
    setPushPermissionDenied()

    const deniedAt = (
      store$.profile as any
    ).preferences?.reminders?.streak?.permissionLastDeniedAt?.get?.()
    expect(typeof deniedAt).toBe('string')
    expect(new Date(deniedAt).toISOString()).toBe(deniedAt)
  })

  it('a second setPushPermissionDenied call is idempotent — does not overwrite the first cooldown timestamp', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { setPushPermissionDenied } = await import('../reminderPreferences')
    const first = '2026-07-01T10:00:00.000Z'
    const second = '2026-07-05T10:00:00.000Z'

    setPushPermissionDenied(first)
    setPushPermissionDenied(second)

    const deniedAt = (
      store$.profile as any
    ).preferences?.reminders?.streak?.permissionLastDeniedAt?.get?.()
    expect(deniedAt).toBe(first)
    expect(deniedAt).not.toBe(second)
  })

  // ── Independence of the two fields ──────────────────────────────────────
  it('setPushPermissionDenied does not set permissionPromptSeenAt as a side effect (the gate sets both explicitly on the deny path)', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { setPushPermissionDenied } = await import('../reminderPreferences')
    setPushPermissionDenied()

    const seenAt = (
      store$.profile as any
    ).preferences?.reminders?.streak?.permissionPromptSeenAt?.get?.()
    expect(seenAt).toBeUndefined()
  })

  it('markStreakPromptSeen does not set permissionLastDeniedAt as a side effect', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { markStreakPromptSeen } = await import('../reminderPreferences')
    markStreakPromptSeen()

    const deniedAt = (
      store$.profile as any
    ).preferences?.reminders?.streak?.permissionLastDeniedAt?.get?.()
    expect(deniedAt).toBeUndefined()
  })

  it('writing permissionPromptSeenAt then permissionLastDeniedAt preserves both values (read-merge-write does not clobber sibling fields)', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { markStreakPromptSeen, setPushPermissionDenied } = await import('../reminderPreferences')
    const seenNow = '2026-07-01T10:00:00.000Z'
    const deniedNow = '2026-07-01T10:00:05.000Z'

    markStreakPromptSeen(seenNow)
    setPushPermissionDenied(deniedNow)

    const streakPrefs = (store$.profile as any).preferences?.reminders?.streak?.get?.()
    expect(streakPrefs?.permissionPromptSeenAt).toBe(seenNow)
    expect(streakPrefs?.permissionLastDeniedAt).toBe(deniedNow)
  })

  it('a pre-existing reminders.replies / reminders.moderation sibling shape is preserved across a streak write (whole-object read-merge-write, not a clobber)', async () => {
    store$.profile.set({
      ...BASE_PROFILE,
      preferences: {
        reminders: {
          replies: { enabled: true },
          moderation: { enabled: false },
        },
      },
    } as any)
    const { markStreakPromptSeen } = await import('../reminderPreferences')
    markStreakPromptSeen()

    const reminders = (store$.profile as any).preferences?.reminders?.get?.()
    expect(reminders?.replies).toEqual({ enabled: true })
    expect(reminders?.moderation).toEqual({ enabled: false })
    expect(typeof reminders?.streak?.permissionPromptSeenAt).toBe('string')
  })
})

/**
 * Red-phase unit tests for the reminder-settings preferences surface's write
 * helpers, added alongside `markStreakPromptSeen` / `setPushPermissionDenied`
 * in this same module: `computeLocalOffsetMinutes`, `setReminderCategoryEnabled`,
 * `setStreakReminderTime`, and `refreshReminderOffsetOnAppOpen`.
 *
 * Contract locked in for the implementation:
 *
 *   computeLocalOffsetMinutes(date = new Date()): number
 *     — pure, no store reads. Returns minutes EAST of UTC:
 *       -date.getTimezoneOffset(). A UTC-5 zone (getTimezoneOffset() === 300)
 *       yields -300; a UTC+1 zone (getTimezoneOffset() === -60) yields +60.
 *
 *   setReminderCategoryEnabled(category: 'streak'|'replies'|'moderation', enabled: boolean): void
 *     — whole-object read-merge-write; patches only the named category's
 *     `enabled` flag, preserving sibling categories and (for 'streak') the
 *     existing permission timestamps. Null-safe. Not write-once — every call
 *     applies the given value.
 *
 *   setStreakReminderTime(localTime: string): void
 *     — merges `streak.local_time = localTime` AND
 *     `streak.last_local_offset_minutes = computeLocalOffsetMinutes()` in the
 *     SAME write. Preserves sibling categories and `streak.enabled`. Null-safe.
 *     Not write-once.
 *
 *   refreshReminderOffsetOnAppOpen(): void
 *     — null-safe. Writes a fresh `last_local_offset_minutes` only when
 *     `streak.enabled === true` AND the freshly-computed offset differs from
 *     the stored one; otherwise a no-op (idempotent — no write when
 *     unchanged). Preserves sibling categories and `streak.local_time`.
 *
 * Mirrors the real-`store$` (not mocked), reset-per-test convention used by
 * the block above.
 */

describe('computeLocalOffsetMinutes — minutes east of UTC (pure, no store reads)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns +60 for a UTC+1 zone (getTimezoneOffset() === -60)', async () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60)
    const { computeLocalOffsetMinutes } = await import('../reminderPreferences')
    expect(computeLocalOffsetMinutes(new Date())).toBe(60)
  })

  it('returns -300 for a UTC-5 zone (getTimezoneOffset() === 300)', async () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(300)
    const { computeLocalOffsetMinutes } = await import('../reminderPreferences')
    expect(computeLocalOffsetMinutes(new Date())).toBe(-300)
  })

  it('returns 0 for UTC itself (getTimezoneOffset() === 0)', async () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0)
    const { computeLocalOffsetMinutes } = await import('../reminderPreferences')
    expect(computeLocalOffsetMinutes(new Date())).toBe(0)
  })

  it('defaults to `new Date()` when called with no argument', async () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330) // UTC+5:30
    const { computeLocalOffsetMinutes } = await import('../reminderPreferences')
    expect(computeLocalOffsetMinutes()).toBe(330)
  })

  it('never touches store$ — does not throw with store$.profile null', async () => {
    const storeModule = await import('app/state/store')
    storeModule.store$.profile.set(null)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60)
    const { computeLocalOffsetMinutes } = await import('../reminderPreferences')
    expect(() => computeLocalOffsetMinutes()).not.toThrow()
  })
})

describe('setReminderCategoryEnabled — category enable/disable writer', () => {
  let store$: typeof import('app/state/store').store$

  beforeEach(async () => {
    const storeModule = await import('app/state/store')
    store$ = storeModule.store$
    store$.profile.set(null)
  })

  it('does not throw when store$.profile is null', async () => {
    const { setReminderCategoryEnabled } = await import('../reminderPreferences')
    expect(() => setReminderCategoryEnabled('streak', true)).not.toThrow()
  })

  it('writes reminders.streak.enabled = true on an empty profile', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { setReminderCategoryEnabled } = await import('../reminderPreferences')
    setReminderCategoryEnabled('streak', true)
    const enabled = (store$.profile as any).preferences?.reminders?.streak?.enabled?.get?.()
    expect(enabled).toBe(true)
  })

  it('writes reminders.replies.enabled without touching sibling streak / moderation categories', async () => {
    store$.profile.set({
      ...BASE_PROFILE,
      preferences: {
        reminders: { streak: { enabled: true }, moderation: { enabled: false } },
      },
    } as any)
    const { setReminderCategoryEnabled } = await import('../reminderPreferences')
    setReminderCategoryEnabled('replies', true)

    const reminders = (store$.profile as any).preferences?.reminders?.get?.()
    expect(reminders?.replies).toEqual({ enabled: true })
    expect(reminders?.streak).toEqual({ enabled: true })
    expect(reminders?.moderation).toEqual({ enabled: false })
  })

  it('toggling moderation off preserves an unrelated streak permission timestamp', async () => {
    store$.profile.set({
      ...BASE_PROFILE,
      preferences: {
        reminders: {
          streak: { enabled: true, permissionPromptSeenAt: '2026-07-01T00:00:00.000Z' },
          moderation: { enabled: true },
        },
      },
    } as any)
    const { setReminderCategoryEnabled } = await import('../reminderPreferences')
    setReminderCategoryEnabled('moderation', false)

    const reminders = (store$.profile as any).preferences?.reminders?.get?.()
    expect(reminders?.moderation).toEqual({ enabled: false })
    expect(reminders?.streak?.permissionPromptSeenAt).toBe('2026-07-01T00:00:00.000Z')
    expect(reminders?.streak?.enabled).toBe(true)
  })

  it('toggling streak.enabled preserves existing permissionPromptSeenAt / permissionLastDeniedAt timestamps', async () => {
    store$.profile.set({
      ...BASE_PROFILE,
      preferences: {
        reminders: {
          streak: {
            enabled: false,
            permissionPromptSeenAt: '2026-07-01T00:00:00.000Z',
            permissionLastDeniedAt: '2026-07-02T00:00:00.000Z',
          },
        },
      },
    } as any)
    const { setReminderCategoryEnabled } = await import('../reminderPreferences')
    setReminderCategoryEnabled('streak', true)

    const streak = (store$.profile as any).preferences?.reminders?.streak?.get?.()
    expect(streak?.enabled).toBe(true)
    expect(streak?.permissionPromptSeenAt).toBe('2026-07-01T00:00:00.000Z')
    expect(streak?.permissionLastDeniedAt).toBe('2026-07-02T00:00:00.000Z')
  })

  it('a second call with the opposite value flips the flag (not write-once like markStreakPromptSeen)', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { setReminderCategoryEnabled } = await import('../reminderPreferences')
    setReminderCategoryEnabled('streak', true)
    setReminderCategoryEnabled('streak', false)
    const enabled = (store$.profile as any).preferences?.reminders?.streak?.enabled?.get?.()
    expect(enabled).toBe(false)
  })
})

describe('setStreakReminderTime — writes local_time + recomputed last_local_offset_minutes together', () => {
  let store$: typeof import('app/state/store').store$

  beforeEach(async () => {
    const storeModule = await import('app/state/store')
    store$ = storeModule.store$
    store$.profile.set(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not throw when store$.profile is null', async () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60)
    const { setStreakReminderTime } = await import('../reminderPreferences')
    expect(() => setStreakReminderTime('20:00')).not.toThrow()
  })

  it('writes streak.local_time to the given HH:mm string', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60)
    const { setStreakReminderTime } = await import('../reminderPreferences')
    setStreakReminderTime('07:30')
    const localTime = (store$.profile as any).preferences?.reminders?.streak?.local_time?.get?.()
    expect(localTime).toBe('07:30')
  })

  it('writes last_local_offset_minutes using the east-of-UTC convention in the SAME call', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(300) // UTC-5
    const { setStreakReminderTime } = await import('../reminderPreferences')
    setStreakReminderTime('20:00')
    const offset = (
      store$.profile as any
    ).preferences?.reminders?.streak?.last_local_offset_minutes?.get?.()
    expect(offset).toBe(-300)
  })

  it('preserves streak.enabled and sibling reminders.replies / reminders.moderation across the write', async () => {
    store$.profile.set({
      ...BASE_PROFILE,
      preferences: {
        reminders: {
          streak: { enabled: true },
          replies: { enabled: true },
          moderation: { enabled: false },
        },
      },
    } as any)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60)
    const { setStreakReminderTime } = await import('../reminderPreferences')
    setStreakReminderTime('18:45')

    const reminders = (store$.profile as any).preferences?.reminders?.get?.()
    expect(reminders?.streak?.enabled).toBe(true)
    expect(reminders?.streak?.local_time).toBe('18:45')
    expect(reminders?.replies).toEqual({ enabled: true })
    expect(reminders?.moderation).toEqual({ enabled: false })
  })

  it('a later call overwrites both fields (not write-once)', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60)
    const { setStreakReminderTime } = await import('../reminderPreferences')
    setStreakReminderTime('08:00')
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(300)
    setStreakReminderTime('21:15')

    const streak = (store$.profile as any).preferences?.reminders?.streak?.get?.()
    expect(streak?.local_time).toBe('21:15')
    expect(streak?.last_local_offset_minutes).toBe(-300)
  })
})

describe('refreshReminderOffsetOnAppOpen — idempotent app-open offset sync', () => {
  let store$: typeof import('app/state/store').store$

  beforeEach(async () => {
    const storeModule = await import('app/state/store')
    store$ = storeModule.store$
    store$.profile.set(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not throw when store$.profile is null', async () => {
    const { refreshReminderOffsetOnAppOpen } = await import('../reminderPreferences')
    expect(() => refreshReminderOffsetOnAppOpen()).not.toThrow()
  })

  it('does nothing when reminders.streak is entirely absent', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { refreshReminderOffsetOnAppOpen } = await import('../reminderPreferences')
    expect(() => refreshReminderOffsetOnAppOpen()).not.toThrow()
    const reminders = (store$.profile as any).preferences?.reminders?.get?.()
    expect(reminders?.streak).toBeUndefined()
  })

  it('does not write an offset when streak.enabled is false, even if the stored offset is stale', async () => {
    store$.profile.set({
      ...BASE_PROFILE,
      preferences: { reminders: { streak: { enabled: false, last_local_offset_minutes: 0 } } },
    } as any)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-300)
    const { refreshReminderOffsetOnAppOpen } = await import('../reminderPreferences')
    refreshReminderOffsetOnAppOpen()
    const offset = (
      store$.profile as any
    ).preferences?.reminders?.streak?.last_local_offset_minutes?.get?.()
    expect(offset).toBe(0)
  })

  it('updates last_local_offset_minutes when streak.enabled is true and the fresh offset differs from the stored one', async () => {
    store$.profile.set({
      ...BASE_PROFILE,
      preferences: {
        reminders: {
          streak: { enabled: true, local_time: '20:00', last_local_offset_minutes: -300 },
        },
      },
    } as any)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60) // now UTC+1 (traveled)
    const { refreshReminderOffsetOnAppOpen } = await import('../reminderPreferences')
    refreshReminderOffsetOnAppOpen()
    const offset = (
      store$.profile as any
    ).preferences?.reminders?.streak?.last_local_offset_minutes?.get?.()
    expect(offset).toBe(60)
  })

  it('is a no-op (value unchanged) when streak.enabled is true and the fresh offset already matches the stored one', async () => {
    store$.profile.set({
      ...BASE_PROFILE,
      preferences: {
        reminders: {
          streak: { enabled: true, local_time: '20:00', last_local_offset_minutes: 60 },
        },
      },
    } as any)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60)
    const { refreshReminderOffsetOnAppOpen } = await import('../reminderPreferences')
    refreshReminderOffsetOnAppOpen()
    const offset = (
      store$.profile as any
    ).preferences?.reminders?.streak?.last_local_offset_minutes?.get?.()
    expect(offset).toBe(60)
  })

  it('preserves streak.local_time and sibling reminders.replies / reminders.moderation across a refresh write', async () => {
    store$.profile.set({
      ...BASE_PROFILE,
      preferences: {
        reminders: {
          streak: { enabled: true, local_time: '20:00', last_local_offset_minutes: -300 },
          replies: { enabled: true },
          moderation: { enabled: false },
        },
      },
    } as any)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60)
    const { refreshReminderOffsetOnAppOpen } = await import('../reminderPreferences')
    refreshReminderOffsetOnAppOpen()

    const reminders = (store$.profile as any).preferences?.reminders?.get?.()
    expect(reminders?.streak?.local_time).toBe('20:00')
    expect(reminders?.streak?.last_local_offset_minutes).toBe(60)
    expect(reminders?.replies).toEqual({ enabled: true })
    expect(reminders?.moderation).toEqual({ enabled: false })
  })
})

/**
 * Red-phase unit tests for `enableStreakRemindersDefault()` — the reconciliation
 * helper that closes the 6.2 opt-in gap (Enable registered a token but never set
 * `streak.enabled = true`, so the primary opt-in path would otherwise produce no
 * reminders).
 *
 * Contract locked in for the implementation, via the same whole-object
 * read-merge-write (`mergeStreak`) pattern as `markStreakPromptSeen` /
 * `setPushPermissionDenied` above:
 *
 *   enableStreakRemindersDefault(): void
 *     — sets `streak.enabled = true` unconditionally (every call);
 *     — sets `streak.local_time = '20:00'` ONLY when unset — an existing
 *       local_time (e.g. from the 6.3 time picker) is never clobbered;
 *     — sets `streak.last_local_offset_minutes = computeLocalOffsetMinutes()`
 *       on every call (a fresh offset, not write-once — mirrors
 *       `setStreakReminderTime`'s "recompute every time" semantics, since the
 *       whole point is giving the candidate RPC's offset-primary path a
 *       current value immediately);
 *     — preserves sibling `replies` / `moderation` categories and the existing
 *       `permissionPromptSeenAt` / `permissionLastDeniedAt` timestamps;
 *     — is null-safe (no throw when `store$.profile` is null).
 *
 * Mirrors the real-`store$` (not mocked), reset-per-test convention used
 * throughout this file.
 */

describe('enableStreakRemindersDefault — reconciliation helper for the 6.2 opt-in gap', () => {
  let store$: typeof import('app/state/store').store$

  beforeEach(async () => {
    const storeModule = await import('app/state/store')
    store$ = storeModule.store$
    store$.profile.set(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not throw when store$.profile is null', async () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60)
    const { enableStreakRemindersDefault } = await import('../reminderPreferences')
    expect(() => enableStreakRemindersDefault()).not.toThrow()
  })

  it('sets streak.enabled = true on an empty profile with no prior reminders shape', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60)
    const { enableStreakRemindersDefault } = await import('../reminderPreferences')
    enableStreakRemindersDefault()
    const enabled = (store$.profile as any).preferences?.reminders?.streak?.enabled?.get?.()
    expect(enabled).toBe(true)
  })

  it('defaults local_time to 20:00 when unset', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60)
    const { enableStreakRemindersDefault } = await import('../reminderPreferences')
    enableStreakRemindersDefault()
    const localTime = (store$.profile as any).preferences?.reminders?.streak?.local_time?.get?.()
    expect(localTime).toBe('20:00')
  })

  it('does NOT clobber an existing local_time already set (e.g. via the 6.3 time picker)', async () => {
    store$.profile.set({
      ...BASE_PROFILE,
      preferences: { reminders: { streak: { enabled: false, local_time: '07:30' } } },
    } as any)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60)
    const { enableStreakRemindersDefault } = await import('../reminderPreferences')
    enableStreakRemindersDefault()
    const localTime = (store$.profile as any).preferences?.reminders?.streak?.local_time?.get?.()
    expect(localTime).toBe('07:30')
  })

  it('writes last_local_offset_minutes using the east-of-UTC convention', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(300) // UTC-5
    const { enableStreakRemindersDefault } = await import('../reminderPreferences')
    enableStreakRemindersDefault()
    const offset = (
      store$.profile as any
    ).preferences?.reminders?.streak?.last_local_offset_minutes?.get?.()
    expect(offset).toBe(-300)
  })

  it('a second call refreshes the offset to a newly computed value while still not clobbering local_time', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60) // UTC+1
    const { enableStreakRemindersDefault } = await import('../reminderPreferences')
    enableStreakRemindersDefault()
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(300) // traveled to UTC-5
    enableStreakRemindersDefault()

    const streak = (store$.profile as any).preferences?.reminders?.streak?.get?.()
    expect(streak?.local_time).toBe('20:00') // unchanged from the first call's default
    expect(streak?.last_local_offset_minutes).toBe(-300) // refreshed
  })

  it('preserves sibling reminders.replies / reminders.moderation across the write', async () => {
    store$.profile.set({
      ...BASE_PROFILE,
      preferences: {
        reminders: {
          replies: { enabled: true },
          moderation: { enabled: false },
        },
      },
    } as any)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60)
    const { enableStreakRemindersDefault } = await import('../reminderPreferences')
    enableStreakRemindersDefault()

    const reminders = (store$.profile as any).preferences?.reminders?.get?.()
    expect(reminders?.replies).toEqual({ enabled: true })
    expect(reminders?.moderation).toEqual({ enabled: false })
    expect(reminders?.streak?.enabled).toBe(true)
  })

  it('preserves existing permissionPromptSeenAt / permissionLastDeniedAt timestamps', async () => {
    store$.profile.set({
      ...BASE_PROFILE,
      preferences: {
        reminders: {
          streak: {
            enabled: false,
            permissionPromptSeenAt: '2026-07-01T00:00:00.000Z',
            permissionLastDeniedAt: '2026-07-02T00:00:00.000Z',
          },
        },
      },
    } as any)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60)
    const { enableStreakRemindersDefault } = await import('../reminderPreferences')
    enableStreakRemindersDefault()

    const streak = (store$.profile as any).preferences?.reminders?.streak?.get?.()
    expect(streak?.enabled).toBe(true)
    expect(streak?.permissionPromptSeenAt).toBe('2026-07-01T00:00:00.000Z')
    expect(streak?.permissionLastDeniedAt).toBe('2026-07-02T00:00:00.000Z')
  })
})

/**
 * Red-phase unit tests for `getRepliesLastSeenAt()` / `markRepliesSeen(now?)` —
 * the server-synced "since" bound the web/desktop in-app reminder card's
 * unread-replies signal is built on (the `repliesLastSeenAt` field on
 * `users.preferences.reminders`).
 *
 * Contract locked in for the implementation, via the SAME whole-object
 * read-merge-write pattern (`store$.profile.preferences.reminders.set(...)`)
 * as every other writer in this module:
 *
 *   getRepliesLastSeenAt(): string | undefined
 *     — synchronous, null-safe read of `reminders.repliesLastSeenAt`. Safe to
 *       call during render / at mount to seed the card's non-reactive `since`
 *       capture (peek semantics — NOT a reactive `use$` read, so a later
 *       write from `markRepliesSeen` does not re-key an in-flight query).
 *
 *   markRepliesSeen(now?: string = new Date().toISOString()): void
 *     — writes `reminders.repliesLastSeenAt = now`. NOT write-once (unlike
 *       `markStreakPromptSeen`) — every call advances the value, since the
 *       whole point is moving the bound forward on every app open. Preserves
 *       sibling `streak` / `replies` / `moderation` categories. Null-safe (no
 *       throw when `store$.profile` is null).
 *
 * Mirrors the real-`store$` (not mocked), reset-per-test convention used
 * throughout this file.
 */

describe('getRepliesLastSeenAt / markRepliesSeen — the repliesLastSeenAt server-synced bound', () => {
  let store$: typeof import('app/state/store').store$

  beforeEach(async () => {
    const storeModule = await import('app/state/store')
    store$ = storeModule.store$
    store$.profile.set(null)
  })

  // ── Null-safety ──────────────────────────────────────────────────────────
  it('getRepliesLastSeenAt returns undefined when store$.profile is null', async () => {
    const { getRepliesLastSeenAt } = await import('../reminderPreferences')
    expect(getRepliesLastSeenAt()).toBeUndefined()
  })

  it('markRepliesSeen does not throw when store$.profile is null', async () => {
    const { markRepliesSeen } = await import('../reminderPreferences')
    expect(() => markRepliesSeen()).not.toThrow()
  })

  it('markRepliesSeen is a genuine no-op on a null profile — it does NOT materialize a partial profile', async () => {
    // Legend-State `.set()` on a null profile MATERIALIZES intermediate objects
    // rather than throwing, which would write a partial `{ preferences: {…} }`
    // profile (dropping sibling keys) and race hydration/sync. The writer must
    // early-return on a null profile, leaving it null.
    const { markRepliesSeen } = await import('../reminderPreferences')
    markRepliesSeen('2026-07-11T10:00:00.000Z')
    expect(store$.profile.peek()).toBeNull()
  })

  it('getRepliesLastSeenAt returns undefined when preferences.reminders is undefined (null-safe read)', async () => {
    store$.profile.set({ ...BASE_PROFILE, preferences: {} } as any)
    const { getRepliesLastSeenAt } = await import('../reminderPreferences')
    expect(getRepliesLastSeenAt()).toBeUndefined()
  })

  // ── markRepliesSeen writes ──────────────────────────────────────────────
  it('markRepliesSeen writes a non-empty ISO repliesLastSeenAt under preferences.reminders', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { markRepliesSeen } = await import('../reminderPreferences')
    markRepliesSeen()

    const seenAt = (store$.profile as any).preferences?.reminders?.repliesLastSeenAt?.get?.()
    expect(typeof seenAt).toBe('string')
    expect(new Date(seenAt).toISOString()).toBe(seenAt)
  })

  it('markRepliesSeen accepts an explicit `now` argument', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { markRepliesSeen } = await import('../reminderPreferences')
    const now = '2026-07-11T10:00:00.000Z'
    markRepliesSeen(now)

    const seenAt = (store$.profile as any).preferences?.reminders?.repliesLastSeenAt?.get?.()
    expect(seenAt).toBe(now)
  })

  it('getRepliesLastSeenAt returns the written value immediately after markRepliesSeen (synchronous read)', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { markRepliesSeen, getRepliesLastSeenAt } = await import('../reminderPreferences')
    expect(getRepliesLastSeenAt()).toBeUndefined()
    const now = '2026-07-11T10:00:00.000Z'
    markRepliesSeen(now)
    expect(getRepliesLastSeenAt()).toBe(now)
  })

  it('a SECOND markRepliesSeen call OVERWRITES the first value (NOT write-once, unlike markStreakPromptSeen) -- the whole point is advancing it every open', async () => {
    store$.profile.set({ ...BASE_PROFILE } as any)
    const { markRepliesSeen } = await import('../reminderPreferences')
    const first = '2026-07-01T10:00:00.000Z'
    const second = '2026-07-05T10:00:00.000Z'

    markRepliesSeen(first)
    markRepliesSeen(second)

    const seenAt = (store$.profile as any).preferences?.reminders?.repliesLastSeenAt?.get?.()
    expect(seenAt).toBe(second)
  })

  it('preserves sibling reminders.streak / reminders.replies / reminders.moderation across the write (whole-object read-merge-write, not a clobber)', async () => {
    store$.profile.set({
      ...BASE_PROFILE,
      preferences: {
        reminders: {
          streak: { enabled: true, local_time: '20:00' },
          replies: { enabled: true },
          moderation: { enabled: false },
        },
      },
    } as any)
    const { markRepliesSeen } = await import('../reminderPreferences')
    markRepliesSeen('2026-07-11T10:00:00.000Z')

    const reminders = (store$.profile as any).preferences?.reminders?.get?.()
    expect(reminders?.streak).toEqual({ enabled: true, local_time: '20:00' })
    expect(reminders?.replies).toEqual({ enabled: true })
    expect(reminders?.moderation).toEqual({ enabled: false })
    expect(reminders?.repliesLastSeenAt).toBe('2026-07-11T10:00:00.000Z')
  })
})
