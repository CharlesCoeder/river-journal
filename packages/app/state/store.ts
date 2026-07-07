/**
 * state/store.ts
 *
 * The single, unified state store for the entire application, powered by Legend State.
 * This file defines the central `store$` observable and includes all actions and
 * computed views that operate on the state.
 */

import { observable, batch, when } from '@legendapp/state'
import { syncState } from '@legendapp/state'
import type {
  AppState,
  Flow,
  Entry,
  DailyEntryView,
  DailyStatsView,
  ThemeName,
  CustomThemeDef,
  FontPairingId,
  HotkeyActionId,
} from './types'
import { THEME_NAMES, DEFAULT_THEME, DARK_THEMES, FONT_PAIRING_IDS, DEFAULT_FONT_PAIRING } from './types'
import { flows$ } from './flows'
import { entries$ } from './entries'
import { graceDays$ } from './grace_days'

import { getTodayJournalDayString } from './date-utils'
import {
  generateUUID,
  isSyncReady$,
  orphanFlowsPending$,
  deviceState$,
  type PreviousAccountBannerState,
} from './syncConfig'

// Re-export theme constants for convenience
export { THEME_NAMES, DEFAULT_THEME, DARK_THEMES }

// Theme validation helper
export const isValidTheme = (theme: string): theme is ThemeName => {
  return THEME_NAMES.includes(theme as ThemeName)
}

// Check if a hex color is dark based on luminance
export const isDarkColor = (hex: string): boolean => {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance < 0.5
}

// =================================================================
// 1. THE CENTRAL STORE DEFINITION
// =================================================================

export const store$ = observable<AppState>({
  session: {
    localSessionId: '', // Populated on app startup from device storage
    userId: null,
    email: null,
    isAuthenticated: false,
    syncEnabled: false,
    lastSyncedTimezone: null,
  },
  profile: null, // Populated on login
  activeFlow: null,
  lastSavedFlow: null,
  lastUpdated: null,
})

// Re-export granular observables for convenience
export { flows$, entries$, graceDays$ }

// =================================================================
// 1b. EPHEMERAL STATE (NOT PERSISTED)
// =================================================================
// UI state that should reset on app restart - separate from persisted store$

import type { PersistentEditorState } from './types'

export interface ThresholdCrossing {
  crossedAt: string
  wordCountAtCrossing: number
}

export const ephemeral$ = observable<{
  persistentEditor: PersistentEditorState
  /**
   * Word count updated on every keystroke with no debounce.
   * The canonical word count in store$.activeFlow.wordCount lags behind typing
   * because editor→store sync is debounced (300ms) to avoid thrashing Supabase.
   * The bottom bar reads this value instead so it appears/updates instantly.
   */
  instantWordCount: number
  /** Current keyboard height from screen bottom (native only, 0 when closed). */
  keyboardHeight: number
  /**
   * Records the FIRST time the active flow's word count crossed 500 in the
   * current writing day. Set when the count transitions from < 500 to ≥ 500
   * within an active flow. Cleared when the active flow is cleared
   * (clearActiveFlow / discardActiveFlowSession). Read by CelebrationModal
   * to choose handoff vs quieter variant, and by Collective lit-state.
   *
   * Shape: { crossedAt: ISO string, wordCountAtCrossing: number } | null
   * - null: not crossed during the current active flow
   * - non-null: crossed; downstream consumers can read the timestamp/count
   *
   * NOTE: this is a writing-DAY signal, not a single-flow signal. If the user
   * starts a second flow after celebrating the first, `thresholdCrossing` is
   * cleared by the active-flow lifecycle helpers; downstream day-level "first
   * 500-crossing today" gating is computed by the streak/flow data model
   * (derived from flows on today's entry, NOT from this field). This field's
   * job is per-active-flow signalling only.
   */
  thresholdCrossing: ThresholdCrossing | null
  /**
   * Set of unlock-token milestones the user has already seen surfaced in a
   * CelebrationScreen handoff variant. Prevents the same unlock from re-appearing
   * on subsequent flow exits within the same app session. Stored in ephemeral$
   * (per-session, NOT persisted). Persistent "spent" state lives in
   * `users.preferences.unlockedThemes` and is the long-term source of truth
   * for which themes the user has chosen to spend tokens on.
   *
   * SEMANTIC: a milestone number is added to this set when the
   * UnlockNotification is rendered for it. On app restart, the set
   * resets — meaning a user who earns a token, sees the notification, then
   * cold-restarts before spending it WILL see it again on their next flow.
   * That is the intended behavior: re-prompting an unspent token is more
   * correct than swallowing it.
   */
  surfacedUnlockMilestones: Set<number>
}>({
  persistentEditor: {
    isVisible: false,
    readOnly: false,
    initialContent: '',
    initialContentRevision: 0,
    headerHeight: 0,
    bottomBarHeight: 0,
  },
  instantWordCount: 0,
  keyboardHeight: 0,
  thresholdCrossing: null,
  surfacedUnlockMilestones: new Set<number>(),
})

// =================================================================
// 2. CORE HELPER FUNCTIONS
// =================================================================

/**
 * Helper function to wait for the store to be loaded from persistence.
 * Replaces the old `waitForJournalLoaded`.
 */
export const waitForStoreLoaded = async () => {
  // If we're on the server, return immediately
  if (typeof window === 'undefined') {
    return true
  }

  try {
    await when(syncState(store$).isPersistLoaded)
    return true
  } catch (error) {
    console.error('Error in waitForStoreLoaded:', error)
    return false
  }
}

// ID generation and word count utilities
export const generateFlowId = (): string => generateUUID()

export const generateEntryId = (_date: string): string => generateUUID()

export const calculateWordCount = (content: string): number =>
  content.trim() ? content.trim().split(/\s+/).length : 0

const isUndecidedOrphanEntry = (entry: Entry): boolean =>
  // "Undecided orphan" means local anonymous data that has not yet been
  // adopted into an authenticated account and has not been explicitly marked
  // local-only. The sync gate uses this to decide whether to show the
  // orphan-consent dialog before opening cloud sync.
  !entry.user_id && !entry.sync_excluded && !!entry.local_session_id

// Flow-level orphan check. Independent of parent-entry state: a flow can
// legitimately be orphan under an adopted parent entry — this happens when a
// user signs out and writes a new flow before signing back in. The parent
// entry kept its prior user_id (signOut deliberately doesn't clearUserData),
// but the new flow has user_id: null and must still be surfaced for adoption
// or local-only consent. The local_session_id truthiness check is the
// load-bearing defense against cloud-downloaded ghost flows: dbFlowToLocal
// sets local_session_id: '' for those.
const isUndecidedOrphanFlow = (flow: Flow): boolean =>
  !flow.user_id && !flow.sync_excluded && !!flow.local_session_id

/**
 * Resets the application's data state, preserving the session.
 * Flows and entries with sync_excluded: true are preserved (local-only data
 * that the user explicitly declined to sync). All cloud-synced data is cleared.
 *
 * Two-phase clear: first nullify user_id on synced items so that
 * transform.save returns undefined (preventing Legend-State from queuing
 * Supabase delete operations via retrySync), then replace the maps with
 * only the kept items.
 */
export const clearUserData = () => {
  const allFlows = flows$.get() ?? {}
  const allEntries = entries$.get() ?? {}
  const allGraceDays = graceDays$.get() ?? {}
  const currentUserId = store$.session.userId.get()

  // Phase 1: strip user_id from items we're about to remove.
  // transform.save returns undefined for !user_id, so any sync operations
  // Legend-State generates for these items will be skipped.
  batch(() => {
    // `flows$[id]` / `entries$[id]` / `graceDays$[id]` are Legend-State proxies:
    // indexing always returns a child observable (even for absent keys), and
    // here `id` is a live key of the snapshot, so the `!` is always valid.
    for (const [id, flow] of Object.entries(allFlows)) {
      if (flow.sync_excluded !== true && flow.user_id) {
        flows$[id]!.user_id.set(null)
      }
    }
    for (const [id, entry] of Object.entries(allEntries)) {
      if (entry.sync_excluded !== true && entry.user_id) {
        entries$[id]!.user_id.set(null)
      }
    }
    // Grace days have no sync_excluded — nullify userId so save transform skips them
    for (const [id, gd] of Object.entries(allGraceDays)) {
      if (gd.userId === currentUserId) {
        graceDays$[id]!.userId.set(null as unknown as string)
      }
    }
  })

  // Phase 2: replace the maps. Removed items already have user_id=null,
  // so Legend-State won't queue ghost deletes against Supabase.
  batch(() => {
    store$.profile.set(null)
    store$.activeFlow.set(null)
    store$.lastSavedFlow.set(null)

    const keptFlows: Record<string, Flow> = {}
    for (const [id, flow] of Object.entries(allFlows)) {
      if (flow.sync_excluded === true) {
        keptFlows[id] = flow
      }
    }
    flows$.set(keptFlows)

    const keptEntries: Record<string, Entry> = {}
    for (const [id, entry] of Object.entries(allEntries)) {
      if (entry.sync_excluded === true) {
        keptEntries[id] = entry
      }
    }
    entries$.set(keptEntries)

    // Grace days have no sync_excluded carve-out — no anonymous origin
    graceDays$.set({})

    store$.lastUpdated.set(new Date().toISOString())
  })
}

/**
 * Adopts orphan (anonymous) entries and flows by stamping them with the
 * authenticated user's ID. Skips items with sync_excluded: true (user explicitly
 * declined those). Must run BEFORE the sync gate opens to prevent RLS 403s.
 */
export const adoptOrphanFlows = (userId: string): void => {
  const allEntries = entries$.get() ?? {}
  const allFlows = flows$.get() ?? {}
  let adoptedEntries = 0
  let adoptedFlows = 0

  if (process.env.NODE_ENV === 'development') {
    const orphanEntryIds = Object.entries(allEntries)
      .filter(([_, e]) => !e.user_id && !e.sync_excluded)
      .map(([id]) => id.slice(0, 8))
    const orphanFlowIds = Object.entries(allFlows)
      .filter(([_, f]) => !f.user_id && !f.sync_excluded)
      .map(([id]) => id.slice(0, 8))
    // eslint-disable-next-line no-console
    console.log(
      `🏠 [adoptOrphanFlows] PRE-ADOPT: ${Object.keys(allEntries).length} entries (${orphanEntryIds.length} undecided orphans), ${Object.keys(allFlows).length} flows (${orphanFlowIds.length} undecided orphans)`,
      { orphanEntryIds, orphanFlowIds }
    )
  }

  let skippedForeignParent = 0

  batch(() => {
    for (const [entryId, entry] of Object.entries(allEntries)) {
      if (!entry.user_id && !entry.sync_excluded) {
        entries$[entryId]!.user_id.set(userId)
        adoptedEntries++
      }
    }

    for (const [flowId, flow] of Object.entries(allFlows)) {
      if (!flow.user_id && !flow.sync_excluded) {
        // Cross-user defense: if the flow's parent entry is owned by a
        // different (non-null) user, do NOT stamp this flow with the current
        // userId. The orphan-consent dialog operates on user_id === null
        // items, but the parent-entry ownership check guards against the
        // logout-window edge case where a flow was written under an entry
        // that already belongs to user A while user B is signing in.
        // Stamping would create an FK/RLS violation on sync.
        const parent = allEntries[flow.dailyEntryId]
        if (parent && parent.user_id && parent.user_id !== userId) {
          skippedForeignParent++
          continue
        }
        flows$[flowId]!.user_id.set(userId)
        adoptedFlows++
      }
    }
  })

  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.log(
      `🏠 [adoptOrphanFlows] POST-ADOPT: adopted ${adoptedEntries} entries, ${adoptedFlows} flows for user ${userId.slice(0, 8)}…${
        skippedForeignParent > 0 ? ` (skipped ${skippedForeignParent} flows under foreign-owned parent)` : ''
      }`
    )
  }
}

/**
 * Returns the count of undecided orphan flows and entries: anonymous local data
 * with no user_id, no sync_excluded decision yet, and a local_session_id proving
 * it originated on this device.
 *
 * Uses peek() to avoid creating reactive subscriptions when called from observe().
 * Parent entry ownership plus local_session_id determines whether a flow is still
 * orphaned, which skips downloaded cloud data while keeping the consent dialog
 * limited to true local-origin records.
 *
 * Uses for-in loops to avoid allocating intermediate arrays from
 * Object.values().filter(), which matters for users with large local stores
 * since this runs inside the observe() block on auth/sync changes.
 */
export const countUndecidedOrphans = (): { flowCount: number; entryCount: number } => {
  const allEntries = entries$.peek() ?? {}
  const allFlows = flows$.peek() ?? {}

  let entryCount = 0
  for (const id in allEntries) {
    const e = allEntries[id]
    if (e && isUndecidedOrphanEntry(e)) entryCount++
  }

  let flowCount = 0
  for (const id in allFlows) {
    const f = allFlows[id]
    if (f && isUndecidedOrphanFlow(f)) flowCount++
  }

  return { flowCount, entryCount }
}

/**
 * Marks all undecided orphan flows and entries as sync_excluded: true.
 * Parent entry ownership plus local_session_id prevents downloaded cloud data
 * from being excluded.
 */
export const excludeOrphanFlows = (): void => {
  const allEntries = entries$.get() ?? {}
  const allFlows = flows$.get() ?? {}

  batch(() => {
    for (const [entryId, entry] of Object.entries(allEntries)) {
      if (isUndecidedOrphanEntry(entry)) {
        entries$[entryId]!.sync_excluded.set(true)
      }
    }

    for (const [flowId, flow] of Object.entries(allFlows)) {
      if (isUndecidedOrphanFlow(flow)) {
        flows$[flowId]!.sync_excluded.set(true)
      }
    }
  })
}

/** Optional overrides for testing (e.g. to simulate adoption throwing). */
export type ResolveOrphanFlowsOverrides = {
  adoptFn?: (userId: string) => void
  excludeFn?: () => void
}

/**
 * Resolves the orphan flows consent dialog.
 * If adopt=true: stamps all undecided orphans with userId and opens sync gate.
 * If adopt=false: marks all undecided orphans as sync_excluded and opens sync gate.
 *
 * Always clears orphanFlowsPending$ and opens the sync gate, even on error,
 * to prevent the user from being stuck with an undismissable dialog.
 *
 * @param adopt - true to adopt orphans, false to exclude them
 * @param overrides - optional test overrides (adoptFn, excludeFn); production never passes this
 */
export const resolveOrphanFlows = (
  adopt: boolean,
  overrides?: ResolveOrphanFlowsOverrides
): void => {
  const pending = orphanFlowsPending$.get()
  if (!pending) return

  const doAdopt = overrides?.adoptFn ?? adoptOrphanFlows
  const doExclude = overrides?.excludeFn ?? excludeOrphanFlows

  try {
    if (adopt) {
      doAdopt(pending.userId)
    } else {
      doExclude()
    }
  } catch (error) {
    console.error('[resolveOrphanFlows] Failed to resolve orphans:', error)
  }

  orphanFlowsPending$.set(null)
  isSyncReady$.set(true)
}

// -----------------------------------------------------------------
// Local-only entries recovery
// -----------------------------------------------------------------

/**
 * A summary row for the Local-only Entries Settings screen.
 * `flowIds` lists the excluded flows belonging to the entry; `totalWordCount`
 * is the sum of those flows' word counts (used to communicate the privacy
 * trade-off — server gains visibility of word_count, not content).
 */
export interface LocallyExcludedEntrySummary {
  entryId: string
  entryDate: string
  totalWordCount: number
  flowIds: string[]
  /**
   * Owner of the parent entry. `null` means anonymous/orphan; non-null means
   * the entry was authored under a particular Supabase account. The
   * Local-only Entries UI compares this against the current session userId
   * to disable Restore for foreign-owned rows (the data still lists, the
   * action is gated). Added with the cross-user defense.
   */
  user_id: string | null
}

/**
 * Returns one summary row per entry that has at least one sync_excluded flow.
 * Sorted by entryDate descending (newest first). Defensive: skips flows whose
 * parent entry was deleted (unreachable in normal use).
 *
 * Uses peek() to avoid creating subscriptions; consumers subscribe via use$()
 * on flows$ / entries$ at the call site and re-derive on change.
 */
export const getLocallyExcludedEntries = (): LocallyExcludedEntrySummary[] => {
  const allFlows = flows$.peek() ?? {}
  const allEntries = entries$.peek() ?? {}
  const byEntry = new Map<string, LocallyExcludedEntrySummary>()

  for (const flowId in allFlows) {
    const flow = allFlows[flowId]
    if (!flow || flow.sync_excluded !== true) continue
    const entry = allEntries[flow.dailyEntryId]
    if (!entry) continue
    const existing = byEntry.get(entry.id)
    if (existing) {
      existing.flowIds.push(flow.id)
      existing.totalWordCount += flow.wordCount ?? 0
    } else {
      byEntry.set(entry.id, {
        entryId: entry.id,
        entryDate: entry.entryDate,
        totalWordCount: flow.wordCount ?? 0,
        flowIds: [flow.id],
        user_id: entry.user_id ?? null,
      })
    }
  }

  return Array.from(byEntry.values()).sort((a, b) =>
    a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : 0
  )
}

/** Count of entries with at least one sync_excluded flow. Drives Settings row visibility. */
export const countLocallyExcludedEntries = (): number => {
  return getLocallyExcludedEntries().length
}

/**
 * Reverse of excludeOrphanFlows for explicit user-driven recovery.
 * For each provided entryId: clear sync_excluded and stamp user_id on the entry,
 * then do the same for every flow whose dailyEntryId is in the set.
 * Wrapped in a single batch() so subscribers fire once and the syncedSupabase
 * flush is a single pass.
 *
 * No-op when entryIds is empty or userId is falsy (UI must gate, but defend in depth).
 */
export const restoreExcludedEntries = (entryIds: string[], userId: string): void => {
  if (entryIds.length === 0 || !userId) return
  const idSet = new Set(entryIds)
  const allFlows = flows$.peek() ?? {}
  const allEntries = entries$.peek() ?? {}

  let skippedForeignEntries = 0
  let skippedForeignFlows = 0
  let skippedFlowMissingParent = 0

  batch(() => {
    for (const entryId of idSet) {
      const entry = allEntries[entryId]
      if (!entry) continue
      // Cross-user defense: refuse to operate on entries owned by a different
      // (non-null) user. Restoring would stamp current userId onto another
      // account's row, leaking content to the wrong cloud account on sync.
      // user_id === null is the legitimate adoption path — keep it flowing.
      if (entry.user_id && entry.user_id !== userId) {
        skippedForeignEntries++
        continue
      }
      // entries$[entryId] proxy always resolves; entryId is a live key here.
      entries$[entryId]!.sync_excluded.set(false)
      entries$[entryId]!.user_id.set(userId)
    }
    for (const flowId in allFlows) {
      const flow = allFlows[flowId]
      if (flow && flow.sync_excluded === true && idSet.has(flow.dailyEntryId)) {
        // Same defense applied via the flow's parent entry (the flow itself
        // may have user_id === null even when the parent is owned).
        const parent = allEntries[flow.dailyEntryId]
        // Defensive: a flow whose parent entry is absent from the local pool
        // would FK-violate on sync upload. Refuse rather than fabricate.
        if (!parent) {
          skippedFlowMissingParent++
          continue
        }
        if (parent.user_id && parent.user_id !== userId) {
          skippedForeignFlows++
          continue
        }
        flows$[flowId]!.sync_excluded.set(false)
        flows$[flowId]!.user_id.set(userId)
      }
    }
  })

  if (
    process.env.NODE_ENV === 'development' &&
    (skippedForeignEntries > 0 || skippedForeignFlows > 0 || skippedFlowMissingParent > 0)
  ) {
    // eslint-disable-next-line no-console
    console.log(
      `🛡️ [restoreExcludedEntries] skipped ${skippedForeignEntries} foreign entries, ${skippedForeignFlows} foreign flows, ${skippedFlowMissingParent} flows w/o parent (current user ${userId.slice(0, 8)}…)`
    )
  }
}

// -----------------------------------------------------------------
// Previous-user data: counts + deletion (banner support)
// -----------------------------------------------------------------

/**
 * Counts entries and flows on this device that are owned by the given userId.
 * Used by the previous-account banner to show accurate counts before the user
 * decides whether to delete or keep the prior account's local data.
 */
export const countPreviousUserData = (
  userId: string
): { entryCount: number; flowCount: number } => {
  if (!userId) return { entryCount: 0, flowCount: 0 }
  const allEntries = entries$.peek() ?? {}
  const allFlows = flows$.peek() ?? {}

  let entryCount = 0
  for (const id in allEntries) {
    if (allEntries[id]?.user_id === userId) entryCount++
  }
  let flowCount = 0
  for (const id in allFlows) {
    if (allFlows[id]?.user_id === userId) flowCount++
  }
  return { entryCount, flowCount }
}

/**
 * Wipes all rows on this device owned by `userId` (entries, flows, grace days).
 * Mirrors `clearUserData`'s two-phase nullify-then-replace pattern so
 * Legend-State does not enqueue ghost Supabase deletes against the previous
 * user's account.
 *
 * Filters by `user_id === userId` (no sync_excluded carve-out — the banner is
 * the user's explicit "delete this account's data" affordance, including any
 * local-only items that account authored).
 */
export const deletePreviousUserData = (userId: string): void => {
  if (!userId) return
  // Self-delete guard: never wipe the currently-signed-in user's own rows.
  // Banner UI keys delete on `previousAccountBanner$.previousUserId`, which
  // is non-null only when prev !== current — but a fast account-swap race
  // between dialog open and confirm could collapse them. Refuse explicitly.
  const currentUserId = store$.session.userId.peek()
  if (currentUserId && currentUserId === userId) return
  const allFlows = flows$.peek() ?? {}
  const allEntries = entries$.peek() ?? {}
  const allGraceDays = graceDays$.peek() ?? {}

  // Snapshot target ids BEFORE phase 1 nullifies user_id (otherwise the
  // proxy-backed `allFlows[id].user_id` we'd filter on later reads as null).
  const targetFlowIds = new Set<string>()
  for (const id in allFlows) {
    if (allFlows[id]?.user_id === userId) targetFlowIds.add(id)
  }
  const targetEntryIds = new Set<string>()
  for (const id in allEntries) {
    if (allEntries[id]?.user_id === userId) targetEntryIds.add(id)
  }
  const targetGraceIds = new Set<string>()
  for (const id in allGraceDays) {
    if (allGraceDays[id]?.userId === userId) targetGraceIds.add(id)
  }

  // Phase 1: nullify user_id on items we're about to remove so transform.save
  // returns undefined and Legend-State will not queue Supabase delete ops.
  batch(() => {
    // Proxies always resolve; these ids were just collected from the snapshots.
    for (const id of targetFlowIds) {
      flows$[id]!.user_id.set(null)
    }
    for (const id of targetEntryIds) {
      entries$[id]!.user_id.set(null)
    }
    for (const id of targetGraceIds) {
      graceDays$[id]!.userId.set(null as unknown as string)
    }
  })

  // Phase 2: drop the targeted rows; keep everything else.
  batch(() => {
    const finalFlows: Record<string, Flow> = {}
    for (const [id, flow] of Object.entries(flows$.peek() ?? {})) {
      if (!targetFlowIds.has(id)) finalFlows[id] = flow
    }
    flows$.set(finalFlows)

    const finalEntries: Record<string, Entry> = {}
    for (const [id, entry] of Object.entries(entries$.peek() ?? {})) {
      if (!targetEntryIds.has(id)) finalEntries[id] = entry
    }
    entries$.set(finalEntries)

    const finalGrace: Record<string, typeof allGraceDays[string]> = {}
    for (const [id, gd] of Object.entries(graceDays$.peek() ?? {})) {
      if (!targetGraceIds.has(id)) finalGrace[id] = gd
    }
    graceDays$.set(finalGrace)

    store$.lastUpdated.set(new Date().toISOString())
  })
}

/**
 * Previous-account banner state, derived from:
 *   - deviceState$.lastAuthedUserId  (the most recent prior identity)
 *   - store$.session.userId          (the current authenticated identity)
 *   - entries$ + flows$              (does data with that prior id still exist?)
 *   - deviceState$.acknowledgedAccountTransitions  (Keep-local dismissals)
 *
 * Returns null unless ALL of:
 *   - prior identity exists and is non-null
 *   - current session is authenticated and differs from prior
 *   - at least one entry or flow with user_id === prior identity remains
 *   - the (prior → current) transition has not been acknowledged
 *
 * Lives here (not in syncConfig.ts) to avoid an import cycle: syncConfig must
 * not import store/entries/flows.
 */
export const previousAccountBanner$ = observable<PreviousAccountBannerState | null>(
  (): PreviousAccountBannerState | null => {
    const previousUserId = deviceState$.lastAuthedUserId.get()
    if (!previousUserId) return null

    const currentUserId = store$.session.userId.get()
    if (!currentUserId) return null
    if (currentUserId === previousUserId) return null

    const transitionKey = `${previousUserId}->${currentUserId}`
    const ack = deviceState$.acknowledgedAccountTransitions.get() ?? {}
    if (ack[transitionKey]) return null

    const allEntries = entries$.get() ?? {}
    const allFlows = flows$.get() ?? {}
    let entryCount = 0
    for (const id in allEntries) {
      if (allEntries[id]?.user_id === previousUserId) entryCount++
    }
    let flowCount = 0
    for (const id in allFlows) {
      if (allFlows[id]?.user_id === previousUserId) flowCount++
    }
    if (entryCount === 0 && flowCount === 0) return null

    return { previousUserId, entryCount, flowCount, acknowledged: false }
  }
)

// =================================================================
// 3. STATE ACTIONS
// =================================================================

// -----------------------------------------------------------------
// Active Flow Actions
// -----------------------------------------------------------------

/**
 * Starts a new active flow session for real-time editing
 */
export const startNewActiveFlow = (): void => {
  batch(() => {
    store$.activeFlow.set({
      content: '',
      wordCount: 0,
    })
    store$.lastUpdated.set(new Date().toISOString())
  })
}

// -----------------------------------------------------------------
// Editor content-sync flush registry
// -----------------------------------------------------------------
// The editor→store content sync is debounced inside the editor components
// (PersistentEditor.native on native, LexicalSync on web). During continuous
// typing the store copy of activeFlow.content lags behind the editor. Any path
// that reads/saves the store content (Finish Session, hide, exit/navigate) must
// flush that pending write FIRST, or the last burst of typing is silently lost.
//
// The editor registers its debounced `flush()` here; store/screen code calls
// flushEditorContent() before reading store$.activeFlow.content.
let editorContentFlush: (() => void) | null = null

/**
 * Registers the active editor's pending content-sync flush. Returns an
 * unregister function (safe for useEffect cleanup) that only clears the slot if
 * this exact flush is still the registered one.
 */
export const registerEditorContentFlush = (flush: () => void): (() => void) => {
  editorContentFlush = flush
  return () => {
    if (editorContentFlush === flush) editorContentFlush = null
  }
}

/**
 * Flushes any pending debounced editor→store content write synchronously.
 * No-op if nothing is registered or nothing is pending.
 */
export const flushEditorContent = (): void => {
  editorContentFlush?.()
}

/**
 * Updates the content of the active flow session and recalculates word count
 * Auto-initializes active flow on first keystroke if none exists
 */
export const updateActiveFlowContent = (content: string): void => {
  const wordCount = calculateWordCount(content)

  batch(() => {
    // Auto-initialize active flow on first keystroke if none exists
    if (!store$.activeFlow.get() && content.length > 0) {
      store$.activeFlow.set({
        content,
        wordCount,
      })

      // Debug log for flow creation tracking
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.log('🌊 Active flow started on first keystroke:', {
          firstCharacter: content.charAt(0),
          contentLength: content.length,
          wordCount,
        })
      }
    } else if (store$.activeFlow.get()) {
      // Direct mutable updates to the active flow
      store$.activeFlow.content.set(content)
      store$.activeFlow.wordCount.set(wordCount)
    }
    store$.lastUpdated.set(new Date().toISOString())
  })
}

/**
 * Saves the active flow session to the daily journal entry using mutable updates.
 * Stores the flow data in lastSavedFlow for the celebration screen.
 */
export const saveActiveFlowSession = (): void => {
  // Checkpoint any still-debounced editor content before reading the store,
  // so a fast typist's final burst is saved rather than discarded.
  flushEditorContent()

  const activeFlow = store$.activeFlow.get()

  // Don't save if there's no active flow or it's empty
  if (!activeFlow || !activeFlow.content.trim()) {
    return
  }

  const todayJournalDay = getTodayJournalDayString()
  const timestamp = new Date().toISOString()

  batch(() => {
    // Store flow data for celebration screen BEFORE clearing activeFlow
    store$.lastSavedFlow.set({
      content: activeFlow.content,
      wordCount: activeFlow.wordCount,
      timestamp,
    })

    // Find today's entry ID using the timezone-agnostic date string
    const entryIndex = store$.views.entryIdsByDate.get()
    let todayEntryId = entryIndex?.[todayJournalDay] || null

    // If today's entry doesn't exist, create it
    if (!todayEntryId) {
      todayEntryId = generateEntryId(todayJournalDay)
      const newEntry: Entry = {
        id: todayEntryId,
        // The `entryDate` property is the 'YYYY-MM-DD' string, not a full timestamp.
        entryDate: todayJournalDay,
        lastModified: timestamp,
        local_session_id: store$.session.localSessionId.get(),
        user_id: store$.session.userId.get(), // Add userId on creation
      }
      // Directly set the new entry in the entries map.
      // Proxy index always resolves to a writable child observable.
      entries$[todayEntryId]!.set(newEntry)
    }

    // Create the new flow session
    const newFlowId = generateFlowId()
    const newFlow: Flow = {
      id: newFlowId,
      dailyEntryId: todayEntryId,
      // The flow's timestamp is stored as a full, precise UTC string.
      // This is the absolute, immutable truth of *when* the flow was written.
      // This separates the concept of a 'day' (for grouping) from the exact
      // moment of writing (for record-keeping).
      timestamp,
      content: activeFlow.content,
      wordCount: activeFlow.wordCount,
      local_session_id: store$.session.localSessionId.get(),
      user_id: store$.session.userId.get(), // Add userId on creation
    }

    // Directly add the new flow to the flows map
    flows$[newFlowId]!.set(newFlow)

    // Update the entry's lastModified timestamp
    entries$[todayEntryId]!.lastModified.set(timestamp)

    // NOTE: activeFlow is NOT cleared here - it will be cleared by CelebrationScreen
    // on mount to prevent the placeholder flash during navigation
    store$.lastUpdated.set(timestamp)
  })
}

/**
 * Clears the lastSavedFlow state after user dismisses celebration screen
 */
export const clearLastSavedFlow = (): void => {
  store$.lastSavedFlow.set(null)
}

/**
 * Clears the activeFlow state. Called by CelebrationScreen on mount
 * to complete the save flow transition without causing placeholder flash.
 */
export const clearActiveFlow = (): void => {
  store$.activeFlow.set(null)
  ephemeral$.instantWordCount.set(0)
  ephemeral$.thresholdCrossing.set(null)
}

/**
 * Records a milestone as "surfaced" in the CelebrationScreen handoff variant.
 * Calling multiple times with the same milestone is a no-op (idempotent).
 *
 * Replace the Set rather than mutating in place — Legend-State's change
 * detection relies on referential identity for non-primitive values.
 *
 * NOTE: `surfacedUnlockMilestones` is ephemeral (per-session). Do NOT call
 * this from clearActiveFlow, discardActiveFlowSession, or clearUserData.
 */
export const markUnlockSurfaced = (milestone: number): void => {
  const current = ephemeral$.surfacedUnlockMilestones.peek()
  if (current.has(milestone)) return
  const next = new Set(current)
  next.add(milestone)
  ephemeral$.surfacedUnlockMilestones.set(next)
}

export const discardActiveFlowSession = (): void => {
  batch(() => {
    store$.activeFlow.set(null)
    store$.lastUpdated.set(new Date().toISOString())
  })
  ephemeral$.instantWordCount.set(0)
  ephemeral$.thresholdCrossing.set(null)
}

/**
 * Deletes a flow session. Sync-aware:
 * - syncEnabled: .delete() triggers fieldDeleted → sets is_deleted=true in Supabase
 * - no sync: hard delete from local storage
 */
export const deleteFlow = (flowId: string): void => {
  const flow = flows$[flowId]!.peek()
  if (!flow) {
    console.warn(`[deleteFlow] Flow ${flowId} not found`)
    return
  }

  batch(() => {
    // .delete() is the correct call in both cases:
    // When syncedSupabase has fieldDeleted configured, .delete() automatically
    // sets is_deleted=true for the remote sync. When sync is disabled (waitFor
    // blocks remote ops), it still removes the item from the local observable.
    flows$[flowId]!.delete()
    store$.lastUpdated.set(new Date().toISOString())
  })
}

/**
 * Gets the current active flow content
 */
export const getActiveFlowContent = (): string => {
  return store$.activeFlow.content.get() || ''
}

/**
 * Gets the current active flow word count
 */
export const getActiveFlowWordCount = (): number => {
  return store$.activeFlow.wordCount.get() || 0
}

/**
 * Debug function to test active flow persistence
 */
export const debugActiveFlow = () => {
  const activeFlow = store$.activeFlow.get()
  const lastUpdated = store$.lastUpdated.get()

  return {
    content: activeFlow?.content || '',
    wordCount: activeFlow?.wordCount || 0,
    lastUpdated,
    hasContent: !!activeFlow?.content?.trim(),
    isActive: !!activeFlow,
  }
}

// -----------------------------------------------------------------
// Instant Word Count (bypasses debounce for snappy bottom bar UI)
// -----------------------------------------------------------------

/**
 * Records the threshold-crossing event when the active flow's word count
 * crosses from < 500 to >= 500 for the FIRST time during this active flow.
 * Idempotent: subsequent calls after the threshold is crossed are no-ops
 * (until the active flow is cleared, which resets thresholdCrossing to null).
 *
 * Called from the same Lexical text-content listener that sets
 * ephemeral$.instantWordCount, AFTER the count is updated. The threshold
 * registration occurs within the same synchronous tick as the count update.
 */
export const recordThresholdCrossingIfNeeded = (newCount: number): void => {
  if (newCount < 500) return
  if (ephemeral$.thresholdCrossing.peek() !== null) return // already crossed
  ephemeral$.thresholdCrossing.set({
    crossedAt: new Date().toISOString(),
    wordCountAtCrossing: newCount,
  })
}

/**
 * Updates the instant word count from plain text content.
 * Called on every keystroke (no debounce) via Lexical's
 * registerTextContentListener, so the bottom bar appears and updates
 * immediately — bypassing the 300ms debounce on store$.activeFlow
 * which exists to throttle Supabase sync writes.
 */
export const setInstantWordCountFromText = (text: string): void => {
  const trimmed = text.trim()
  const count = trimmed ? trimmed.split(/\s+/).length : 0
  ephemeral$.instantWordCount.set(count)
  recordThresholdCrossingIfNeeded(count)
}

// -----------------------------------------------------------------
// Persistent Editor Actions (Native only)
// -----------------------------------------------------------------

/**
 * Shows the persistent editor with the given options.
 * On native, the editor is always mounted at root but visibility is controlled here.
 */
export const showPersistentEditor = (
  options: { readOnly?: boolean; content?: string } = {}
): void => {
  ephemeral$.persistentEditor.assign({
    isVisible: true,
    readOnly: options.readOnly ?? false,
    initialContent: options.content ?? '',
  })
}

/**
 * Hides the persistent editor and resets initial content.
 * Content must be cleared here so the DOM WebView receives the empty
 * string while still visible, before opacity fades out.
 */
export const hidePersistentEditor = (): void => {
  // Flush any pending editor content before we clear/hide, so keystrokes made
  // right before exiting are checkpointed into activeFlow rather than dropped.
  flushEditorContent()

  ephemeral$.persistentEditor.initialContent.set('')
  ephemeral$.persistentEditor.initialContentRevision.set(
    ephemeral$.persistentEditor.initialContentRevision.peek() + 1
  )
  ephemeral$.persistentEditor.isVisible.set(false)
  ephemeral$.persistentEditor.bottomBarHeight.set(0)
}

/**
 * Updates the header height so the persistent editor can position below it.
 */
export const updatePersistentEditorHeaderHeight = (height: number): void => {
  ephemeral$.persistentEditor.headerHeight.set(height)
}

/**
 * Updates the bottom bar height so the persistent editor can inset above it.
 */
export const updatePersistentEditorBottomBarHeight = (height: number): void => {
  ephemeral$.persistentEditor.bottomBarHeight.set(height)
}

/**
 * Updates the initial content in the persistent editor.
 * Used for syncing content from Legend State to the editor.
 */
export const updatePersistentEditorContent = (content: string): void => {
  ephemeral$.persistentEditor.initialContent.set(content)
}

// -----------------------------------------------------------------
// Profile & Settings Actions
// -----------------------------------------------------------------

/**
 * Creates a default profile if none exists, or backfills missing optional fields
 * on legacy profiles loaded from persistence.
 */
export const ensureProfile = () => {
  if (!store$.profile.get()) {
    store$.profile.set({
      word_goal: 750,
      themeName: DEFAULT_THEME,
      customTheme: null,
      fontPairing: DEFAULT_FONT_PAIRING,
      hotkeyOverrides: {},
      editor: { focusMode: false, focusGranularity: 'paragraph' },
      unlockedThemes: [],
      sync: {
        word_goal: true,
        themeName: true,
        customTheme: true,
        fontPairing: true,
      },
    })
  } else {
    if (!store$.profile.editor.get()) {
      // Migration: legacy profiles lack the editor sub-object — backfill it.
      store$.profile.editor.set({ focusMode: false, focusGranularity: 'paragraph' })
    } else if (store$.profile.editor.focusGranularity.get() === undefined) {
      // Migration: editor sub-object predates focusGranularity — backfill it.
      store$.profile.editor.focusGranularity.set('paragraph')
    }
    if (!store$.profile.unlockedThemes.get()) {
      // Migration: legacy profiles lack unlockedThemes — backfill empty array.
      store$.profile.unlockedThemes.set([])
    }
    if (!store$.profile.preferences.get()) {
      // Migration: legacy profiles lack the preferences sub-object — backfill
      // with an empty object. Do NOT pre-create the disclosures sub-object;
      // let it materialize on first write to avoid an unnecessary syncedSupabase
      // round-trip on every cold start.
      store$.profile.preferences.set({})
    }
  }
}

/**
 * Sets focus mode preference on the user profile.
 * Creates a profile if none exists (mirrors setWordGoal / setFontPairing pattern).
 */
export const setFocusMode = (value: boolean): void => {
  ensureProfile()
  store$.profile.editor.focusMode.set(value)
}

/**
 * Sets the focus-mode granularity preference (Story 2.11).
 * Creates a profile if none exists (mirrors setFocusMode).
 */
export const setFocusGranularity = (value: 'paragraph' | 'sentence'): void => {
  ensureProfile()
  store$.profile.editor.focusGranularity.set(value)
}

/**
 * Adds a post id to the local-hide set in users.preferences.locallyHiddenPosts.
 * Idempotent — re-adding the same id is a no-op.
 * Persisted to server via users.preferences syncedSupabase mechanism.
 */
export const addLocallyHiddenPost = (postId: string): void => {
  ensureProfile()
  const cur = store$.profile.preferences.locallyHiddenPosts.get() ?? []
  if (cur.includes(postId)) return
  store$.profile.preferences.locallyHiddenPosts.set([...cur, postId])
}

/**
 * True when the active flow has been autosaved at least once this session.
 * Used by JournalScreen's exit-confirm gate.
 *
 * MVP semantics: returns true iff `store$.activeFlow.content` (the debounced
 * value, 300ms behind keystrokes) is non-empty. The 300ms editor → store
 * debounce is the only persist path during writing; once it fires,
 * activeFlow.content is non-empty and we treat that as "checkpoint reached".
 *
 * NOTE: activeFlow has only { content, wordCount } — there is no `id` field.
 */
export function hasReachedAutosaveCheckpoint(): boolean {
  const active = store$.activeFlow.peek()
  return !!active?.content?.trim()
}

/**
 * Sets the named theme with validation and automatic profile creation.
 * Accepts preset ThemeName values or 'custom' (only when customTheme exists).
 */
export const setTheme = (themeName: ThemeName | 'custom') => {
  if (themeName === 'custom') {
    ensureProfile()
    if (!store$.profile.customTheme.get()) {
      console.warn('Cannot set custom theme: no custom theme defined')
      return
    }
    store$.profile.themeName.set('custom')
    return
  }
  if (!THEME_NAMES.includes(themeName)) {
    console.warn(`Invalid theme: ${themeName}. Using default: ${DEFAULT_THEME}`)
    themeName = DEFAULT_THEME
  }
  ensureProfile()
  store$.profile.themeName.set(themeName)
}

/**
 * Sets a custom theme definition and activates it.
 */
export const setCustomTheme = (def: CustomThemeDef) => {
  ensureProfile()
  batch(() => {
    store$.profile.customTheme.set(def)
    store$.profile.themeName.set('custom')
  })
}

/**
 * Clears the custom theme and reverts to the default preset.
 */
export const clearCustomTheme = () => {
  ensureProfile()
  batch(() => {
    store$.profile.customTheme.set(null)
    if (store$.profile.themeName.get() === 'custom') {
      store$.profile.themeName.set(DEFAULT_THEME)
    }
  })
}

/**
 * Spends one unlock token on the given theme (Model B — user-chosen unlocks).
 * Idempotent: if `theme` is already in `unlockedThemes`, no-op.
 *
 * The caller is responsible for verifying that the user HAS an unspent token
 * (i.e., `streak.unlockTokensEarned > unlockedThemes.length`). This action
 * trusts its caller; the ThemePicker UI gates the affordance via the
 * available-token count.
 */
export const spendUnlockToken = (theme: ThemeName): void => {
  ensureProfile()
  const current = store$.profile.unlockedThemes.peek() ?? []
  if (current.includes(theme)) return
  store$.profile.unlockedThemes.set([...current, theme])
}

/**
 * Sets the font pairing with validation and automatic profile creation.
 */
export const setFontPairing = (id: FontPairingId) => {
  if (!FONT_PAIRING_IDS.includes(id)) {
    console.warn(`Invalid font pairing: ${id}`)
    return
  }
  ensureProfile()
  store$.profile.fontPairing.set(id)
}

export const setWordGoal = (goal: number) => {
  ensureProfile()
  store$.profile.word_goal.set(goal)
}

// -----------------------------------------------------------------
// Hotkey override actions
// -----------------------------------------------------------------

/**
 * Ensures store$.profile.hotkeyOverrides is an object (not undefined).
 * Profiles persisted before the customizable-shortcuts feature lack the field;
 * back-fill lazily so writes never dereference undefined.
 */
const ensureHotkeyOverridesField = () => {
  ensureProfile()
  if (!store$.profile.hotkeyOverrides.peek()) {
    store$.profile.hotkeyOverrides.set({})
  }
}

export const setHotkeyOverride = (id: HotkeyActionId, hotkey: string): void => {
  ensureHotkeyOverridesField()
  store$.profile.hotkeyOverrides[id].set(hotkey)
}

export const resetHotkeyOverride = (id: HotkeyActionId): void => {
  ensureHotkeyOverridesField()
  store$.profile.hotkeyOverrides[id].delete()
}

// =================================================================
// 5. THEME HELPERS (WITH FALLBACKS)
// =================================================================

/**
 * Gets the current theme name, with fallback to default
 */
export const getCurrentTheme = (): ThemeName | 'custom' => {
  return store$.profile.themeName.get() ?? DEFAULT_THEME
}

/**
 * Derives light/dark from the theme name.
 * For 'custom', checks the custom theme's background luminance.
 */
export const isDarkTheme = (themeName: ThemeName | 'custom'): boolean => {
  if (themeName === 'custom') {
    const customTheme = store$.profile.customTheme.peek()
    return customTheme ? isDarkColor(customTheme.bg) : false
  }
  return DARK_THEMES.includes(themeName)
}

// =================================================================
// 4. COMPUTED VIEWS (DERIVED STATE)
// =================================================================
// By adding computeds directly to the observable, Legend State automatically
// memoizes them. They only re-run when the underlying data they `get()` changes,
// making them efficient.

store$.assign({
  views: {
    /**
     * Creates a fast index mapping date strings ('YYYY-MM-DD') to their
     * corresponding entry IDs (UUIDs).
     * This is memoized and only recalculates when entries are added or removed,
     * making date-to-ID lookups instantaneous.
     */
    entryIdsByDate: (): Record<string, string> => {
      const allEntries = Object.values(entries$.get() ?? {})
      // The `reduce` function efficiently transforms the array of entries
      // into a simple { 'date': 'id' } map.
      return allEntries.reduce(
        (index, entry) => {
          index[entry.entryDate] = entry.id
          return index
        },
        {} as Record<string, string>
      )
    },

    /**
     * A highly efficient lookup table to get all flows for a specific entry ID.
     */
    flowsByEntryId: (entryId: string): Flow[] => {
      const allFlows = Object.values(flows$.get() ?? {})
      return allFlows.filter((flow) => flow.dailyEntryId === entryId)
    },

    /**
     * A "lookup table" computed to efficiently get a fully populated daily entry.
     * Access a specific day reactively like this:
     * `use$(store$.views.entryByDate('2025-09-23'))`
     * This is the most performant way to get data for a single item.
     */
    entryByDate: (date: string): DailyEntryView | null => {
      const allEntries = Object.values(entries$.get() ?? {})
      const entryData = allEntries.find((entry) => entry.entryDate === date)

      if (!entryData) return null

      const allFlows = Object.values(flows$.get() ?? {})
      const flows = allFlows.filter((flow) => flow.dailyEntryId === entryData.id)
      const totalWords = flows.reduce((sum, flow) => sum + flow.wordCount, 0)

      return {
        ...entryData,
        flows,
        totalWords,
      }
    },

    /**
     * A computed for a day's statistics.
     * This demonstrates composition: it efficiently uses the `entryByDate`
     * computed internally. It will re-run if that entry changes OR
     * if the user's word goal changes.
     */
    statsByDate: (date: string): DailyStatsView => {
      // This computed depends on the result of another computed and `profile.word_goal`.
      const entry = store$.views.entryByDate(date)
      // **CRITICAL CHANGE**: The word goal now comes from the unified profile state!
      const wordGoal = store$.profile.word_goal.get() ?? 750

      if (!entry) {
        return {
          totalWords: 0,
          goalReached: false,
          flows: [],
          progress: 0,
        }
      }

      const progress = wordGoal > 0 ? Math.min(entry.totalWords / wordGoal, 1) : 1

      return {
        totalWords: entry.totalWords,
        goalReached: entry.totalWords >= wordGoal,
        flows: entry.flows,
        progress,
      }
    },

    /**
     * A computed that returns all entries, fully populated and sorted.
     * This value is now cached and will only be recalculated if any entry
     * or flow is added, changed, or removed.
     */
    allEntriesSorted: (): DailyEntryView[] => {
      const allEntries = Object.values(entries$.get() ?? {})
      const allFlows = Object.values(flows$.get() ?? {})

      return allEntries
        .map((entry) => {
          const flows = allFlows.filter((flow) => flow.dailyEntryId === entry.id)
          const totalWords = flows.reduce((sum, flow) => sum + flow.wordCount, 0)
          return { ...entry, flows, totalWords }
        })
        .sort((a, b) => b.entryDate.localeCompare(a.entryDate))
    },

    /**
     * A computed "lookup table" to get all populated entries for a specific month.
     * The `date` property 'YYYY-MM-DD' makes this easy with `startsWith`.
     * Access reactively like: `use$(store$.views.entriesByMonth('2025-09'))`
     * @param month A string in 'YYYY-MM' format.
     * @returns An array of populated daily entries, sorted most recent first.
     */
    entriesByMonth: (month: string): DailyEntryView[] => {
      // This view now implicitly depends on the `allEntriesSorted` view for its data,
      // making it even more efficient.
      const sortedEntries = store$.views.allEntriesSorted()
      return sortedEntries.filter((entry) => entry.entryDate.startsWith(month))
    },

    /**
     * A computed "lookup table" to get all populated entries for a specific year.
     * Access reactively like: `use$(store$.views.entriesByYear('2025'))`
     * @param year A string in 'YYYY' format.
     * @returns An array of populated daily entries, sorted most recent first.
     */
    entriesByYear: (year: string): DailyEntryView[] => {
      const sortedEntries = store$.views.allEntriesSorted()
      return sortedEntries.filter((entry) => entry.entryDate.startsWith(year))
    },
  },
})
