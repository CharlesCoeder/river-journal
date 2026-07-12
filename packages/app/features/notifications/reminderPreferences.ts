/**
 * reminderPreferences.ts — Legend-State side effects for the streak-reminder
 * permission-prompt preference slice.
 *
 * Lives in the FEATURE layer (not state/**) because it touches
 * `store$.profile.preferences` (Legend-State) — mirrors
 * `features/moderation-receipts/acknowledgment.ts`.
 *
 * Writes are stored under
 * `store$.profile.preferences.reminders.streak.{permissionPromptSeenAt,permissionLastDeniedAt}`
 * — server-synced, so a prompt answered on one device never re-surfaces on
 * another. Both writers are idempotent (write-once, never clobber an existing
 * timestamp) and null-safe (no throw when `store$.profile` is null). The write
 * uses the whole-object read-merge-write pattern (mirrors `acknowledgeReceipt`
 * / `addLocallyHiddenPost`) through the known optional `reminders` property —
 * NOT a dynamic-index observable write.
 *
 * This module only WRITES `streak.permissionPromptSeenAt` and
 * `streak.permissionLastDeniedAt`; the rest of the `reminders` shape is declared
 * (state/types.ts) for the reminder-settings surface but not populated here.
 */

import { store$ } from 'app/state/store'
import type { UserProfile } from 'app/state/types'

type RemindersPref = NonNullable<NonNullable<UserProfile['preferences']>['reminders']>
type StreakReminderPref = NonNullable<RemindersPref['streak']>

/**
 * Reads the current `reminders` preference object, null-safe. Returns undefined
 * when the profile / preferences / reminders path is not yet present.
 */
function readReminders(): RemindersPref | undefined {
  try {
    return store$.profile.preferences?.reminders?.get?.() as RemindersPref | undefined
  } catch {
    return undefined
  }
}

/**
 * Whole-object read-merge-write of `reminders`, patching only the streak
 * sub-object with `patch` while preserving any sibling `replies` / `moderation`
 * shape and existing streak fields. Guards a null profile / unavailable path.
 */
function mergeStreak(patch: Partial<StreakReminderPref>): void {
  try {
    const current = readReminders() ?? {}
    store$.profile.preferences.reminders.set({
      ...current,
      streak: { ...current.streak, ...patch },
    })
  } catch {
    // Profile is null / observable path unavailable — nothing to persist.
    // The gate's session-local state still suppresses the prompt for this
    // mount; a legitimately authenticated caller always has a profile.
  }
}

/**
 * Synchronous, null-safe read of whether the one-time streak prompt has been
 * answered. Safe to call during render (the gate calls it to decide whether to
 * evaluate the trigger). Returns false when the profile / path is absent.
 */
export function hasSeenStreakPrompt(): boolean {
  return Boolean(readReminders()?.streak?.permissionPromptSeenAt)
}

/**
 * Records that the one-time in-app streak-reminder ask was answered.
 * Idempotent — a no-op if `permissionPromptSeenAt` is already set, so a
 * repeated call never overwrites the first timestamp. Null-safe.
 */
export function markStreakPromptSeen(now: string = new Date().toISOString()): void {
  if (hasSeenStreakPrompt()) return
  mergeStreak({ permissionPromptSeenAt: now })
}

/**
 * Records the OS-permission deny cooldown timestamp (backs the
 * re-enable-from-preferences cooldown). Idempotent — a no-op if `permissionLastDeniedAt` is
 * already set, so a later deny never overwrites the first cooldown. Null-safe.
 */
export function setPushPermissionDenied(now: string = new Date().toISOString()): void {
  if (readReminders()?.streak?.permissionLastDeniedAt) return
  mergeStreak({ permissionLastDeniedAt: now })
}
