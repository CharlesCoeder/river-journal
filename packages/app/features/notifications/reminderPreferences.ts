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
 * Whole-object write of the `reminders` preference blob, guarded against a null
 * profile. This is the shared write seam for every reminders writer below.
 *
 * The guard is load-bearing, not defensive decoration: Legend-State `.set()` on
 * a null `store$.profile` does NOT throw — it MATERIALIZES the intermediate
 * `profile` / `preferences` objects, writing a PARTIAL profile (e.g.
 * `{ preferences: { reminders: {…} } }`) that drops every sibling profile key
 * and can race IndexedDB hydration / server sync. So a `try/catch` alone is not
 * genuinely null-safe (its `catch` is dead code). A legitimately authenticated
 * caller always has a hydrated profile; when it is not yet present, skip the
 * write entirely rather than materialize a corrupt partial profile.
 */
function writeReminders(next: RemindersPref): void {
  if (store$.profile.peek() == null) return
  try {
    store$.profile.preferences.reminders.set(next)
  } catch {
    // Observable path unavailable — nothing to persist.
  }
}

/**
 * Whole-object read-merge-write of `reminders`, patching only the streak
 * sub-object with `patch` while preserving any sibling `replies` / `moderation`
 * shape and existing streak fields. Guards a null profile / unavailable path.
 */
function mergeStreak(patch: Partial<StreakReminderPref>): void {
  const current = readReminders() ?? {}
  writeReminders({ ...current, streak: { ...current.streak, ...patch } })
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

// ───────────────────────────────────────────────────────────────────────────
// Reminder-settings preferences surface — category / time / offset writers.
// ───────────────────────────────────────────────────────────────────────────

type ReminderCategory = 'streak' | 'replies' | 'moderation'

/**
 * Pure, store-free helper: the current local UTC offset in **minutes east of
 * UTC**. `Date#getTimezoneOffset()` reports minutes WEST of UTC (UTC−5 → 300),
 * so we negate it (UTC−5 → −300, UTC+1 → +60). No observable reads — safe to
 * call anywhere, including with a null profile.
 */
export function computeLocalOffsetMinutes(date: Date = new Date()): number {
  // `0 - x` (not `-x`) so a zero offset returns +0, never -0.
  return 0 - date.getTimezoneOffset()
}

/**
 * Sets the `enabled` flag for one reminder category (streak / replies /
 * moderation) via a whole-object read-merge-write. Patches only the named
 * sub-object's `enabled`, preserving sibling categories and — for `streak` —
 * the existing permission timestamps / time / offset. Null-safe (no throw on a
 * null profile). Not write-once: every call applies the given value.
 */
export function setReminderCategoryEnabled(category: ReminderCategory, enabled: boolean): void {
  const current = readReminders() ?? {}
  writeReminders({
    ...current,
    [category]: { ...current[category], enabled },
  } as RemindersPref)
}

/**
 * Writes the streak reminder send-time and refreshes the stored local offset in
 * a SINGLE merge: `streak.local_time = localTime` (a timezone-agnostic 24-hour
 * `'HH:mm'` string) plus `streak.last_local_offset_minutes` recomputed for the
 * current zone. Preserves sibling categories and other streak fields. Null-safe.
 *
 * Offset consumption contract for the streak cron: to convert the stored local
 * send-time to a UTC minute-of-day it computes
 *   (localMinutes - last_local_offset_minutes) mod 1440
 * where `localMinutes = HH * 60 + mm`. Keeping the offset current here (and on
 * app open) keeps that conversion correct across travel / DST changes.
 */
export function setStreakReminderTime(localTime: string): void {
  const current = readReminders() ?? {}
  writeReminders({
    ...current,
    streak: {
      ...current.streak,
      local_time: localTime,
      last_local_offset_minutes: computeLocalOffsetMinutes(),
    },
  })
}

/**
 * Turns streak reminders ON as part of the first-streak permission grant,
 * closing the opt-in gap where a granted permission registered a token but
 * never set `streak.enabled = true` — so the cron's strict `enabled` gate would
 * otherwise never select the user. Via the whole-object read-merge-write
 * (`mergeStreak`):
 *   - `streak.enabled = true` (every call);
 *   - `streak.local_time = '20:00'` ONLY when unset — an existing time (e.g.
 *     from the settings time picker) is never clobbered;
 *   - `streak.last_local_offset_minutes = computeLocalOffsetMinutes()` (a fresh
 *     offset on every call) so the candidate RPC's offset-primary path has a
 *     current value immediately, not only the timezone fallback.
 * Preserves sibling `replies` / `moderation` categories and the existing
 * permission timestamps. Null-safe (no throw on a null profile). Idempotent in
 * the sense that repeated calls converge on the same enabled state.
 */
export function enableStreakRemindersDefault(): void {
  const currentLocalTime = readReminders()?.streak?.local_time
  const patch: Partial<StreakReminderPref> = {
    enabled: true,
    last_local_offset_minutes: computeLocalOffsetMinutes(),
  }
  if (!currentLocalTime) {
    patch.local_time = '20:00'
  }
  mergeStreak(patch)
}

/**
 * Reads the current `repliesLastSeenAt` bound, null-safe. Synchronous — safe to
 * call at the in-app reminder card's mount to seed its NON-reactive `since`
 * capture (peek semantics, NOT a reactive `use$` read, so a later
 * `markRepliesSeen` write does not re-key the in-flight unread-replies query).
 * Returns undefined when the profile / reminders path is absent.
 */
export function getRepliesLastSeenAt(): string | undefined {
  return readReminders()?.repliesLastSeenAt
}

/**
 * Advances the `repliesLastSeenAt` bound to `now` (the next app open counts only
 * replies newer than this). NOT write-once (unlike `markStreakPromptSeen`) —
 * every call moves the bound forward. Whole-object read-merge-write, preserving
 * sibling `streak` / `replies` / `moderation` categories. Null-safe.
 */
export function markRepliesSeen(now: string = new Date().toISOString()): void {
  const current = readReminders() ?? {}
  writeReminders({ ...current, repliesLastSeenAt: now })
}

/**
 * Keeps `streak.last_local_offset_minutes` current on app open. Writes a fresh
 * offset ONLY when streak reminders are enabled AND the freshly-computed offset
 * differs from the stored one — otherwise a no-op, so an unchanged zone causes
 * no sync churn. Preserves `streak.local_time` and sibling categories. Null-safe.
 */
export function refreshReminderOffsetOnAppOpen(): void {
  try {
    const current = readReminders()
    const streak = current?.streak
    if (!streak || streak.enabled !== true) return
    const fresh = computeLocalOffsetMinutes()
    if (streak.last_local_offset_minutes === fresh) return
    writeReminders({
      ...current,
      streak: { ...streak, last_local_offset_minutes: fresh },
    })
  } catch {
    // Profile is null / observable path unavailable — nothing to persist.
  }
}
