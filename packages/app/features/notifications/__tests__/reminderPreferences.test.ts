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

import { beforeEach, describe, expect, it } from 'vitest'

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
