/**
 * preferencesSync.ts
 *
 * Cross-device sync of the account-level preferences (`SyncedPreferencesDoc`)
 * between `store$.profile` and `users.preferences`.
 *
 * Independent of journal sync on purpose: preferences are not journal content,
 * and the server-side notification fan-out reads them, so they sync whenever a
 * user is signed in — with Cloud Sync on or off.
 *
 * What syncs, and what stays on this device:
 *   - account:    word goal, unlocked themes, disclosure acks, moderation
 *                 receipts, hidden posts, reminder settings, tenure-tier toggle;
 *   - appearance: theme, custom theme, font pairing, focus mode — follows the
 *                 account unless `profile.appearanceScope === 'device'`;
 *   - device:     hotkeys, `appearanceScope` itself, and the push-permission
 *                 prompt timestamps (OS permission is granted per device).
 *   `feature_flags` is server-seeded: pulled, never pushed.
 *
 * How a sync round works:
 *   1. Project the profile into a `SyncedPreferencesDoc`.
 *   2. Diff it against `profile.preferencesSyncBase` (the document the server
 *      last confirmed) to find the leaves changed on this device.
 *   3. Send only those leaves to `merge_my_preferences`, which deep-merges them
 *      into the row atomically (see the migration for merge semantics) and
 *      returns the merged document.
 *   4. Apply the returned document locally — server wins, except for leaves
 *      the user edited while the request was in flight, which are kept and
 *      pushed in a follow-up round — and store it as the new base.
 *
 * First sync for an account on this device (no base for this user):
 *   - if this device has only ever been this user's (or nobody's), it SEEDS:
 *     the account's values win where it has them; this device fills the gaps.
 *     That covers both the first rollout (empty server document) and a new
 *     device (account's look arrives on sign-in);
 *   - if the device last belonged to a different account, it ADOPTS: the
 *     account's document replaces the local account-level values, so one
 *     person's acknowledgments and hidden posts never leak into another's.
 *
 * Triggers: sign-in / boot with a session (pull), local edits (debounced
 * push), and app foreground (throttled pull). Failures retry with backoff.
 */

import { AppState, type AppStateStatus } from 'react-native'
import { batch, observe } from '@legendapp/state'
import { store$ } from './store'
import { deviceState$ } from './syncConfig'
import { supabase } from '../utils/supabase'
import type { Json } from '../types/database'
import {
  FONT_PAIRING_IDS,
  THEME_NAMES,
  type AppearanceScope,
  type CustomThemeDef,
  type SyncedPreferencesDoc,
  type ThemeName,
  type UserProfile,
} from './types'

type PlainObject = Record<string, unknown>

const DEFAULT_WORD_GOAL = 750
const PUSH_DEBOUNCE_MS = 1000
const FOREGROUND_PULL_INTERVAL_MS = 60_000
const RETRY_BASE_MS = 15_000
const RETRY_MAX_MS = 5 * 60_000

/** Leaves replaced as a unit instead of merged key by key. */
const ATOMIC_PATHS = new Set(['appearance.customTheme'])

/**
 * Grow-only sets the server unions (see the migration). A seed always sends
 * them whole so this device's additions join the account's.
 */
const UNION_PATHS = new Set(['unlockedThemes', 'locallyHiddenPosts'])

// =================================================================
// Pure document helpers (exported for tests)
// =================================================================

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const childPath = (path: string, key: string) => (path ? `${path}.${key}` : key)

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    return aKeys.length === bKeys.length && aKeys.every((k) => k in b && deepEqual(a[k], b[k]))
  }
  return false
}

/** Detaches from observables and drops `undefined` keys. */
const toPlain = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? {}))

/**
 * The account-level view of a profile — exactly what syncs. Appearance is
 * omitted when this device keeps its own look; device-local fields never appear.
 */
export function projectProfile(profile: UserProfile | null | undefined): SyncedPreferencesDoc {
  if (!profile) return {}
  const prefs = profile.preferences ?? {}
  const doc: SyncedPreferencesDoc = {
    word_goal: profile.word_goal,
    unlockedThemes: profile.unlockedThemes,
    disclosures: prefs.disclosures,
    collective_show_tenure_tier: prefs.collective_show_tenure_tier,
    locallyHiddenPosts: prefs.locallyHiddenPosts,
    moderationReceipts: prefs.moderationReceipts,
  }

  if (profile.appearanceScope !== 'device') {
    doc.appearance = {
      themeName: profile.themeName,
      customTheme: profile.customTheme ?? null,
      fontPairing: profile.fontPairing,
      focusMode: profile.editor?.focusMode,
      focusGranularity: profile.editor?.focusGranularity,
    }
  }

  if (prefs.reminders) {
    const { streak, ...rest } = prefs.reminders
    const reminders: NonNullable<SyncedPreferencesDoc['reminders']> = { ...rest }
    if (streak) {
      const { permissionPromptSeenAt: _seen, permissionLastDeniedAt: _denied, ...accountStreak } =
        streak
      if (Object.keys(accountStreak).length > 0) reminders.streak = accountStreak
    }
    doc.reminders = reminders
  }

  const plain = toPlain(doc)
  if (plain.reminders && Object.keys(plain.reminders).length === 0) delete plain.reminders
  return plain
}

/** The leaves of `next` that differ from `base`, as a nested patch; null when none. */
export function diffDoc(base: unknown, next: unknown, path = ''): PlainObject | null {
  if (!isPlainObject(next)) return null
  const baseObj = isPlainObject(base) ? base : {}
  let out: PlainObject | null = null
  for (const [key, value] of Object.entries(next)) {
    const p = childPath(path, key)
    const baseValue = baseObj[key]
    if (isPlainObject(value) && isPlainObject(baseValue) && !ATOMIC_PATHS.has(p)) {
      const sub = diffDoc(baseValue, value, p)
      if (sub) (out ??= {})[key] = sub
    } else if (!deepEqual(value, baseValue)) {
      ;(out ??= {})[key] = value
    }
  }
  return out
}

/**
 * The leaves of `local` the server does not have yet (plus the union sets,
 * whole). Used to seed an account without overriding values it already holds.
 */
export function fillMissing(local: unknown, server: unknown, path = ''): PlainObject | null {
  if (!isPlainObject(local)) return null
  const serverObj = isPlainObject(server) ? server : {}
  let out: PlainObject | null = null
  for (const [key, value] of Object.entries(local)) {
    const p = childPath(path, key)
    const serverValue = serverObj[key]
    if (serverValue === undefined || UNION_PATHS.has(p)) {
      ;(out ??= {})[key] = value
    } else if (isPlainObject(value) && isPlainObject(serverValue) && !ATOMIC_PATHS.has(p)) {
      const sub = fillMissing(value, serverValue, p)
      if (sub) (out ??= {})[key] = sub
    }
  }
  return out
}

/** `target` with every leaf of `source` written over it. */
export function overlay<T>(target: T, source: unknown, path = ''): T {
  if (!isPlainObject(source)) return target
  const out: PlainObject = isPlainObject(target) ? { ...target } : {}
  for (const [key, value] of Object.entries(source)) {
    const p = childPath(path, key)
    out[key] =
      isPlainObject(value) && isPlainObject(out[key]) && !ATOMIC_PATHS.has(p)
        ? overlay(out[key], value, p)
        : value
  }
  return out as T
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isThemeName = (v: unknown): v is ThemeName =>
  typeof v === 'string' && (THEME_NAMES as readonly string[]).includes(v)
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/

function sanitizeAck(v: unknown): { acknowledged_at: string } | undefined {
  return isPlainObject(v) && isNonEmptyString(v.acknowledged_at)
    ? { acknowledged_at: v.acknowledged_at }
    : undefined
}

function sanitizeCustomTheme(v: unknown): CustomThemeDef | null | undefined {
  if (v === null) return null
  if (!isPlainObject(v)) return undefined
  const { bg, text, stone } = v
  if ([bg, text, stone].every((c) => typeof c === 'string' && HEX_COLOR.test(c))) {
    return { bg: bg as string, text: text as string, stone: stone as string }
  }
  return undefined
}

/**
 * Keeps only well-formed, known fields from the server document. The row is the
 * user's own, but any client version can write it, so nothing is trusted to
 * already be in the shape this build expects.
 */
export function sanitizeServerDoc(raw: unknown): SyncedPreferencesDoc {
  if (!isPlainObject(raw)) return {}
  const doc: SyncedPreferencesDoc = {}

  if (Number.isInteger(raw.word_goal) && (raw.word_goal as number) > 0) {
    doc.word_goal = raw.word_goal as number
  }
  if (Array.isArray(raw.unlockedThemes)) {
    doc.unlockedThemes = [...new Set(raw.unlockedThemes.filter(isThemeName))]
  }

  if (isPlainObject(raw.appearance)) {
    const a = raw.appearance
    const appearance: NonNullable<SyncedPreferencesDoc['appearance']> = {}
    const customTheme = sanitizeCustomTheme(a.customTheme)
    if (customTheme !== undefined) appearance.customTheme = customTheme
    if (isThemeName(a.themeName)) appearance.themeName = a.themeName
    else if (a.themeName === 'custom' && customTheme) appearance.themeName = 'custom'
    if (
      typeof a.fontPairing === 'string' &&
      (FONT_PAIRING_IDS as readonly string[]).includes(a.fontPairing)
    ) {
      appearance.fontPairing = a.fontPairing as NonNullable<typeof appearance.fontPairing>
    }
    if (typeof a.focusMode === 'boolean') appearance.focusMode = a.focusMode
    if (a.focusGranularity === 'paragraph' || a.focusGranularity === 'sentence') {
      appearance.focusGranularity = a.focusGranularity
    }
    doc.appearance = appearance
  }

  if (isPlainObject(raw.disclosures)) {
    const disclosures: NonNullable<SyncedPreferencesDoc['disclosures']> = {}
    const post = sanitizeAck(raw.disclosures.collective_post_v1)
    const ai = sanitizeAck(raw.disclosures.ai_cloud_v1)
    if (post) disclosures.collective_post_v1 = post
    if (ai) disclosures.ai_cloud_v1 = ai
    doc.disclosures = disclosures
  }

  if (typeof raw.collective_show_tenure_tier === 'boolean') {
    doc.collective_show_tenure_tier = raw.collective_show_tenure_tier
  }
  if (Array.isArray(raw.locallyHiddenPosts)) {
    doc.locallyHiddenPosts = [...new Set(raw.locallyHiddenPosts.filter(isNonEmptyString))]
  }
  if (isPlainObject(raw.moderationReceipts)) {
    const receipts: Record<string, { acknowledged_at: string }> = {}
    for (const [id, ack] of Object.entries(raw.moderationReceipts)) {
      const clean = sanitizeAck(ack)
      if (clean) receipts[id] = clean
    }
    doc.moderationReceipts = receipts
  }

  if (isPlainObject(raw.reminders)) {
    const r = raw.reminders
    const reminders: NonNullable<SyncedPreferencesDoc['reminders']> = {}
    if (isPlainObject(r.streak)) {
      const streak: NonNullable<typeof reminders.streak> = {}
      if (typeof r.streak.enabled === 'boolean') streak.enabled = r.streak.enabled
      if (typeof r.streak.local_time === 'string' && HH_MM.test(r.streak.local_time)) {
        streak.local_time = r.streak.local_time
      }
      if (Number.isInteger(r.streak.last_local_offset_minutes)) {
        streak.last_local_offset_minutes = r.streak.last_local_offset_minutes as number
      }
      reminders.streak = streak
    }
    for (const category of ['replies', 'moderation'] as const) {
      const value = r[category]
      if (isPlainObject(value) && typeof value.enabled === 'boolean') {
        reminders[category] = { enabled: value.enabled }
      }
    }
    if (isNonEmptyString(r.repliesLastSeenAt)) reminders.repliesLastSeenAt = r.repliesLastSeenAt
    doc.reminders = reminders
  }

  if (isPlainObject(raw.feature_flags)) {
    const flag = raw.feature_flags.external_billing_link_enabled
    doc.feature_flags = typeof flag === 'boolean' ? { external_billing_link_enabled: flag } : {}
  }

  return doc
}

// =================================================================
// Applying a document to the profile
// =================================================================

function setIfChanged<T>(obs: { peek(): T; set(value: T): void }, value: T) {
  if (!deepEqual(obs.peek(), value)) obs.set(value)
}

function applyAppearance(appearance: NonNullable<SyncedPreferencesDoc['appearance']>) {
  const profile$ = store$.profile
  if (appearance.customTheme !== undefined) setIfChanged(profile$.customTheme, appearance.customTheme)
  if (appearance.themeName !== undefined) {
    // Never select 'custom' without a custom theme to show.
    if (appearance.themeName !== 'custom' || profile$.customTheme.peek()) {
      setIfChanged(profile$.themeName, appearance.themeName)
    }
  }
  if (appearance.fontPairing !== undefined) setIfChanged(profile$.fontPairing, appearance.fontPairing)
  if (appearance.focusMode !== undefined || appearance.focusGranularity !== undefined) {
    const editor = profile$.editor.peek() ?? { focusMode: false, focusGranularity: 'paragraph' }
    setIfChanged(profile$.editor, {
      ...editor,
      ...(appearance.focusMode !== undefined ? { focusMode: appearance.focusMode } : {}),
      ...(appearance.focusGranularity !== undefined
        ? { focusGranularity: appearance.focusGranularity }
        : {}),
    })
  }
}

/**
 * Writes `doc` onto the profile. With `clearMissing`, account-level values the
 * document lacks are reset (adopting another account's document); otherwise
 * they are left as they are. Appearance is never cleared, and is skipped
 * entirely when this device keeps its own look. Device-local fields are never
 * touched.
 */
export function applyDocToProfile(doc: SyncedPreferencesDoc, options: { clearMissing: boolean }) {
  const profile = store$.profile.peek()
  if (!profile) return
  const { clearMissing } = options
  const profile$ = store$.profile

  batch(() => {
    if (doc.word_goal !== undefined || clearMissing) {
      setIfChanged(profile$.word_goal, doc.word_goal ?? DEFAULT_WORD_GOAL)
    }
    if (doc.unlockedThemes !== undefined || clearMissing) {
      setIfChanged(profile$.unlockedThemes, doc.unlockedThemes ?? [])
    }
    if (doc.appearance && profile.appearanceScope !== 'device') {
      applyAppearance(doc.appearance)
    }

    const prefs = profile.preferences ?? {}
    const next: NonNullable<UserProfile['preferences']> = { ...prefs }
    const assign = <K extends keyof typeof next>(key: K, value: (typeof next)[K] | undefined) => {
      if (value !== undefined) next[key] = value
      else if (clearMissing) delete next[key]
    }
    assign('disclosures', doc.disclosures)
    assign('collective_show_tenure_tier', doc.collective_show_tenure_tier)
    assign('locallyHiddenPosts', doc.locallyHiddenPosts)
    assign('moderationReceipts', doc.moderationReceipts)
    assign('feature_flags', doc.feature_flags)

    if (doc.reminders !== undefined || clearMissing) {
      // Carry this device's push-prompt timestamps across; they are not in the doc.
      const { permissionPromptSeenAt, permissionLastDeniedAt } = prefs.reminders?.streak ?? {}
      const deviceStreak = toPlain({ permissionPromptSeenAt, permissionLastDeniedAt })
      const reminders = { ...(doc.reminders ?? {}) }
      const streak = { ...(reminders.streak ?? {}), ...deviceStreak }
      if (Object.keys(streak).length > 0) reminders.streak = streak
      if (Object.keys(reminders).length > 0) next.reminders = reminders
      else delete next.reminders
    }

    setIfChanged(profile$.preferences, next)
  })
}

// =================================================================
// Sync rounds
// =================================================================

type SyncMode = 'incremental' | 'seed' | 'adopt'

async function callMerge(patch: PlainObject): Promise<SyncedPreferencesDoc> {
  const { data, error } = await supabase.rpc('merge_my_preferences', { patch: patch as Json })
  if (error) throw new Error(error.message)
  return sanitizeServerDoc(data)
}

let lastPullAt = 0

async function runSyncRound(pull: boolean): Promise<{ again: boolean }> {
  const userId = store$.session.userId.peek()
  if (!store$.session.isAuthenticated.peek() || !userId) return { again: false }
  const profile = store$.profile.peek()
  if (!profile) return { again: false }

  const sentFrom = projectProfile(profile)
  const base = profile.preferencesSyncBase
  let mode: SyncMode
  let server: SyncedPreferencesDoc

  if (base && base.userId === userId) {
    mode = 'incremental'
    const patch = diffDoc(base.doc, sentFrom)
    if (!patch && !pull) return { again: false }
    server = await callMerge(patch ?? {})
  } else {
    const lastAuthedUserId = deviceState$.lastAuthedUserId.peek()
    const deviceIsThisUsers =
      !base && (lastAuthedUserId === null || lastAuthedUserId === userId)
    if (deviceIsThisUsers) {
      mode = 'seed'
      const current = await callMerge({})
      const patch = fillMissing(sentFrom, current)
      server = patch ? await callMerge(patch) : current
    } else {
      mode = 'adopt'
      server = await callMerge({})
    }
  }

  // Signed out or switched accounts while the request was in flight.
  if (store$.session.userId.peek() !== userId || !store$.profile.peek()) return { again: false }

  const inFlightEdits = diffDoc(sentFrom, projectProfile(store$.profile.peek()))
  let next: SyncedPreferencesDoc = mode === 'adopt' ? server : overlay(sentFrom, server)
  if (inFlightEdits) next = overlay(next, inFlightEdits)

  batch(() => {
    applyDocToProfile(next, { clearMissing: mode === 'adopt' })
    store$.profile.preferencesSyncBase.set({ userId, doc: server })
  })
  lastPullAt = Date.now()

  // An adopt leaves this device's look (and any in-flight edit) unpushed; a
  // follow-up incremental round sends them.
  return { again: inFlightEdits !== null || mode === 'adopt' }
}

let running: Promise<void> | null = null
let pendingRound = false
let pendingPull = false
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelayMs = 0

function scheduleRetry() {
  if (retryTimer) return
  retryDelayMs = Math.min(retryDelayMs ? retryDelayMs * 2 : RETRY_BASE_MS, RETRY_MAX_MS)
  retryTimer = setTimeout(() => {
    retryTimer = null
    void syncPreferencesNow({ pull: true })
  }, retryDelayMs)
}

/**
 * Runs sync rounds until nothing is left to send. Concurrent calls coalesce
 * into the running loop. Never rejects — a failed round schedules a retry.
 */
export function syncPreferencesNow(options: { pull?: boolean } = {}): Promise<void> {
  pendingRound = true
  pendingPull = pendingPull || options.pull === true
  if (running) return running

  running = (async () => {
    try {
      while (pendingRound) {
        const pull = pendingPull
        pendingRound = false
        pendingPull = false
        try {
          const { again } = await runSyncRound(pull)
          retryDelayMs = 0
          if (again) pendingRound = true
        } catch (e) {
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.warn('⚙️ [preferencesSync] round failed; will retry', e)
          }
          scheduleRetry()
          return
        }
      }
    } finally {
      running = null
    }
  })()
  return running
}

// =================================================================
// Appearance scope
// =================================================================

/**
 * Switches this device between following the account's look and keeping its
 * own. Returning to 'account' adopts the account's current look rather than
 * pushing this device's look over it.
 */
export function setAppearanceScope(scope: AppearanceScope): void {
  const profile = store$.profile.peek()
  if (!profile || (profile.appearanceScope ?? 'account') === scope) return

  if (scope === 'device') {
    store$.profile.appearanceScope.set('device')
    return
  }

  const base = profile.preferencesSyncBase
  const userId = store$.session.userId.peek()
  batch(() => {
    if (base && base.userId === userId && base.doc.appearance) {
      applyAppearance(base.doc.appearance)
    }
    store$.profile.appearanceScope.set('account')
  })
  void syncPreferencesNow({ pull: true })
}

// =================================================================
// Wiring
// =================================================================

let disposers: Array<() => void> = []
let pushTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Idempotent. Call once from app init, after persistence has loaded (so the
 * first round sees the persisted profile and base). Returns a teardown.
 */
export function startPreferencesSync(): () => void {
  if (disposers.length > 0) return stopPreferencesSync

  // Sign-in, or boot with a persisted session: pull the account's document.
  disposers.push(
    observe(() => {
      const isAuthenticated = store$.session.isAuthenticated.get()
      const userId = store$.session.userId.get()
      if (isAuthenticated && userId) void syncPreferencesNow({ pull: true })
    })
  )

  // Local edits: push once they settle.
  let lastProjection: SyncedPreferencesDoc | undefined
  disposers.push(
    observe(() => {
      const projection = projectProfile(store$.profile.get())
      if (lastProjection === undefined) {
        lastProjection = projection
        return
      }
      if (deepEqual(projection, lastProjection)) return
      lastProjection = projection
      if (pushTimer) clearTimeout(pushTimer)
      pushTimer = setTimeout(() => {
        pushTimer = null
        void syncPreferencesNow()
      }, PUSH_DEBOUNCE_MS)
    })
  )

  // Foreground: pick up changes made on other devices.
  const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status !== 'active') return
    if (Date.now() - lastPullAt < FOREGROUND_PULL_INTERVAL_MS) return
    void syncPreferencesNow({ pull: true })
  })
  disposers.push(() => sub.remove())

  return stopPreferencesSync
}

/** Teardown for startPreferencesSync. Exposed for symmetry and test cleanup. */
export function stopPreferencesSync(): void {
  for (const dispose of disposers) dispose()
  disposers = []
  if (pushTimer) clearTimeout(pushTimer)
  if (retryTimer) clearTimeout(retryTimer)
  pushTimer = null
  retryTimer = null
  retryDelayMs = 0
  lastPullAt = 0
}
