/**
 * state/types.ts
 *
 * This file defines the single source of truth for the entire application's state shape.
 * It centralizes all core data structures, including session, user profile, and journal data,
 * into a unified `AppState` interface.
 */

import type { StreakState, SubscriptionTier } from './streak'

// =================================================================
// 1. CORE INTERFACES
// =================================================================

/**
 * For identity and authentication status. This is kept separate from the user's
 * editable profile data.
 */
export interface SessionState {
  localSessionId: string // Persistent UUID for the local device/browser session
  userId: string | null // Supabase user ID, populated on login
  email: string | null // User's email address when authenticated
  isAuthenticated: boolean // Whether user is logged in
  syncEnabled: boolean // Whether remote Supabase sync is active
  lastSyncedTimezone: string | null // Last IANA tz PATCHed to users.timezone — idempotency cache for syncDeviceTimezone()
}

/**
 * Defines all possible theme settings. These will be part of the UserProfile.
 */
export const THEME_NAMES = [
  'ink',
  'night',
  'forest-morning',
  'forest-night',
  'leather',
  'fireside',
] as const

export type ThemeName = (typeof THEME_NAMES)[number]

export const LIGHT_THEMES: ThemeName[] = ['ink', 'forest-morning', 'leather']
export const DARK_THEMES: ThemeName[] = ['night', 'forest-night', 'fireside']

export const DEFAULT_THEME: ThemeName = 'ink'

/**
 * Curated font pairings: each pairs a sans-serif UI font with a serif content font.
 */
export const FONT_PAIRING_IDS = ['outfit-newsreader', 'lato-lora', 'inter-source-serif'] as const
export type FontPairingId = (typeof FONT_PAIRING_IDS)[number]
export const DEFAULT_FONT_PAIRING: FontPairingId = 'outfit-newsreader'

export type HotkeyActionId = 'newEntry' | 'openSettings' | 'exitEditor'

export interface HotkeyOverrides {
  newEntry?: string // absent = use default 'Mod+N'
  openSettings?: string // absent = use default 'Mod+,'
  exitEditor?: string // absent = use default 'Escape'
}

/**
 * Maps each pairing to the journal (content) font-family strings
 * used by the Lexical editor's inline styles.
 */
export const FONT_PAIRING_FAMILIES: Record<FontPairingId, { web: string; native: string }> = {
  'outfit-newsreader': {
    web: 'Newsreader, Georgia, "Times New Roman", serif',
    native: 'Newsreader',
  },
  'lato-lora': {
    web: 'Lora, Georgia, "Times New Roman", serif',
    native: 'Lora',
  },
  'inter-source-serif': {
    web: 'SourceSerif4, Georgia, "Times New Roman", serif',
    native: 'SourceSerif4',
  },
}

/**
 * Three user-chosen colors that define a custom theme.
 * A 12-step Tamagui palette is generated from these at runtime.
 */
export interface CustomThemeDef {
  bg: string // hex color for background
  text: string // hex color for primary text
  stone: string // hex color for muted/secondary elements
}

/**
 * For all user-specific settings and preferences. Persisted on-device; the
 * account-level subset (see `SyncedPreferencesDoc`) syncs to `users.preferences`
 * through state/preferencesSync.ts. Hotkeys, `appearanceScope` and the push
 * prompt timestamps stay on this device.
 */
export interface UserProfile {
  word_goal: number
  themeName: ThemeName | 'custom'
  customTheme: CustomThemeDef | null
  fontPairing: FontPairingId
  hotkeyOverrides: HotkeyOverrides

  /**
   * Editor-specific preferences. Optional at the type level for backward compat
   * with persisted legacy profiles created before this field was added.
   * Always set on newly created profiles. Consumers read with `?? false`.
   */
  editor?: {
    focusMode: boolean
    /**
     * Focus-mode granularity. Optional for back-compat with profiles
     * persisted before this field existed; consumers read with
     * `?? 'paragraph'`. `paragraph` (default) preserves the original
     * byte-for-byte focus-mode behavior.
     */
    focusGranularity?: 'paragraph' | 'sentence'
  }

  /**
   * Themes the user has spent unlock tokens on (Model B — user-chosen unlocks).
   * Length === number of tokens spent. Server source of truth: `users.preferences.unlockedThemes`
   * JSONB array. Optional at the type level for backward compat with persisted profiles
   * created before this field was added; consumers read with `?? []`.
   */
  unlockedThemes?: ThemeName[]

  /**
   * Account preferences, synced to `users.preferences` by state/preferencesSync.ts
   * (except the push-prompt timestamps under `reminders.streak`, which are
   * device-local). The server shape is documented in
   * packages/app/types/database.ts users.preferences JSONB JSDoc.
   * Optional at the type level for backward compat with persisted profiles
   * created before this field was added; consumers read with `?.collective_post_v1`.
   *
   * Version-key design: each disclosure boundary uses an independent key so
   * a future `collective_post_v2` copy change re-prompts automatically without
   * a migration path — new key = unacknowledged state.
   */
  preferences?: {
    disclosures?: {
      collective_post_v1?: { acknowledged_at: string }
      ai_cloud_v1?: { acknowledged_at: string } // reserved Boundary B; not written in this story
    }
    /** Default false (undefined). When true, AuthorByline displays tenure tier in feed and composer preview. */
    collective_show_tenure_tier?: boolean
    /**
     * Post ids the local user has hidden via the report flow. Synced to users.preferences.
     * Optional at the type level for backward compat with persisted profiles created before this field was added.
     */
    locallyHiddenPosts?: string[]

    /**
     * Per-receipt acknowledgment timestamps for the in-app moderation receipt UX.
     * Keyed by a stable composite receiptId — `removed_post:<postId>:<removed_at>`
     * (the RAW removed_at from the RPC, so a re-removal after reinstatement yields
     * a fresh key) and `suspension:<suspensionId>`. Synced to
     * users.preferences, mirroring the disclosures precedent, so a receipt
     * acknowledged on one device never re-surfaces on another. Optional for
     * back-compat with profiles created before this field existed; consumers
     * read null-safe.
     */
    moderationReceipts?: Record<string, { acknowledged_at: string }>

    /**
     * Notification-reminder preferences. All fields optional for back-compat
     * with pre-existing profiles — consumers read null-safe, exactly like
     * `moderationReceipts` / `disclosures`.
     *
     * The push-permission-prompt path only WRITES `streak.permissionPromptSeenAt`
     * (the one-time in-app ask answered) and `streak.permissionLastDeniedAt` (the
     * OS-deny cooldown). Those two are DEVICE-LOCAL — OS notification permission
     * is per device — and are never synced. The rest of the shape is declared now so the
     * reminder-settings surface has a stable contract; `streak.enabled` /
     * `streak.local_time` / `streak.last_local_offset_minutes` are written by the
     * reminder-settings surface, and `replies` / `moderation` are reserved for the
     * reply- and moderation-notification categories.
     */
    reminders?: {
      streak?: {
        enabled?: boolean
        local_time?: string // 'HH:mm' local; default handled by the reminder-settings surface
        last_local_offset_minutes?: number // written by the reminder-settings surface; used by the streak cron
        permissionLastDeniedAt?: string // ISO; OS-deny cooldown
        permissionPromptSeenAt?: string // ISO; one-time in-app ask answered
      }
      replies?: { enabled?: boolean } // reserved for the reply-notification category
      moderation?: { enabled?: boolean } // reserved for the moderation-notification category
      repliesLastSeenAt?: string // ISO; the "since" bound the in-app reminder card advances once per open
    }

    /**
     * UI-surface feature flags. Server-seeded (default false) and read only by
     * the purchase/cancel surfaces; the server gates all paid features via
     * subscription_tier, never via this flag. Optional for back-compat with
     * profiles created before this field existed — consumers must treat an
     * absent flag as false (defensive default).
     */
    feature_flags?: { external_billing_link_enabled?: boolean }
  }

  /**
   * The user's subscription tier. Server-written only — the client never sets
   * this directly; it is reflected from the authoritative receipt-validation
   * response (and app-open re-validation) via `applySubscriptionTierFromServer`.
   * Optional at the type level for backward compat with persisted profiles
   * created before this field existed; consumers read with `?? 'free'`.
   */
  subscription_tier?: SubscriptionTier

  /**
   * Whether this device's look (theme, custom theme, font pairing, focus mode)
   * follows the account or is kept to this device. Device-local — never synced.
   * Absent means 'account'. See state/preferencesSync.ts.
   */
  appearanceScope?: AppearanceScope

  /**
   * Bookkeeping for state/preferencesSync.ts: the account's preferences document
   * as last confirmed by the server, and whose account it belongs to. Local
   * changes are found by diffing against it. Kept on the profile (not the
   * session) on purpose: wiping the profile must also forget the base, or the
   * next sync would push the freshly reset defaults over the account.
   */
  preferencesSyncBase?: PreferencesSyncBase | null
}

export type AppearanceScope = 'account' | 'device'

/**
 * The account-level preferences document stored in `users.preferences` — what
 * syncs between a user's devices. Field names are the server's; the mapping
 * to and from `UserProfile` lives in state/preferencesSync.ts.
 *
 * Deliberately NOT here (device-local): hotkey overrides, `appearanceScope`,
 * and the push-permission prompt timestamps
 * (`reminders.streak.permissionPromptSeenAt` / `permissionLastDeniedAt`) —
 * notification permission is granted per device, so a prompt answered on one
 * device must not suppress it on another.
 */
export interface SyncedPreferencesDoc {
  word_goal?: number
  unlockedThemes?: ThemeName[]
  appearance?: {
    themeName?: ThemeName | 'custom'
    customTheme?: CustomThemeDef | null
    fontPairing?: FontPairingId
    focusMode?: boolean
    focusGranularity?: 'paragraph' | 'sentence'
  }
  disclosures?: NonNullable<UserProfile['preferences']>['disclosures']
  collective_show_tenure_tier?: boolean
  locallyHiddenPosts?: string[]
  moderationReceipts?: Record<string, { acknowledged_at: string }>
  reminders?: {
    streak?: {
      enabled?: boolean
      local_time?: string
      last_local_offset_minutes?: number
    }
    replies?: { enabled?: boolean }
    moderation?: { enabled?: boolean }
    repliesLastSeenAt?: string
  }
  /** Server-seeded, pulled only — clients never write it. */
  feature_flags?: { external_billing_link_enabled?: boolean }
}

export interface PreferencesSyncBase {
  userId: string
  doc: SyncedPreferencesDoc
}

/**
 * Temporary state to hold the last saved flow data for the celebration screen.
 * Cleared when user dismisses the celebration screen.
 */
export interface LastSavedFlow {
  content: string
  wordCount: number
  timestamp: string
}

/**
 * Controls the persistent editor (native only).
 * The editor is always mounted at root layout but visibility is controlled via this state.
 */
export interface PersistentEditorState {
  isVisible: boolean
  readOnly: boolean
  initialContent: string
  /** Monotonic counter incremented on hide so ContentSyncer always re-fires its
   *  clear effect, even when initialContent stays '' → '' (typing bypasses this field). */
  initialContentRevision: number
  /** Height of the screen header, used to position editor below it on Android */
  headerHeight: number
  /** Height of the bottom bar, used to inset editor above it on Android */
  bottomBarHeight: number
  /**
   * How the editor is anchored on screen.
   *  - 'screen': the JournalScreen layout — anchored below `headerHeight`,
   *    full width.
   *  - 'inline': the home-screen writing area. Anchored below `expandedTop`
   *    and inset by `insetX`; while collapsed it is pushed down to `inlineTop`
   *    so it sits under the home chrome, and expanding slides it up as the
   *    chrome fades out.
   */
  layoutMode: 'screen' | 'inline'
  /** Inline mode: y (below the safe-area top) of the collapsed writing area. */
  inlineTop: number
  /** Inline mode: y (below the safe-area top) the editor slides up to when expanded. */
  expandedTop: number
  /** Inline mode: horizontal padding of the home chrome, so the editor text lines up with it. */
  insetX: number
  /** Inline mode: whether the editor is expanded into writing mode. */
  expanded: boolean
  /** Whether the WebView's contenteditable currently has focus (reported by the editor). */
  isFocused: boolean
  /** Monotonic counter; incrementing it asks the WebView to blur (dismiss the keyboard). */
  blurRequest: number
}

// =================================================================
// 2. THE UNIFIED APP STATE INTERFACE
// =================================================================

/**
 * The single, unified state object for the entire application.
 * Note: `flows` and `entries` have been extracted to standalone observables
 * (`flows$` in flows.ts, `entries$` in entries.ts) to enable per-table
 * syncedSupabase() configuration.
 */
export interface AppState {
  session: SessionState
  profile: UserProfile | null // Null when the user is anonymous
  activeFlow: {
    content: string
    wordCount: number
  } | null
  lastSavedFlow: LastSavedFlow | null // Temporary state for celebration screen
  lastUpdated: string | null

  // Computed views will be attached here
  views?: {
    entryIdsByDate: () => Record<string, string>
    entryByDate: (date: string) => DailyEntryView | null
    statsByDate: (date: string) => DailyStatsView
    allEntriesSorted: () => DailyEntryView[]
    flowsByEntryId: (entryId: string) => Flow[]
    entriesByMonth: (month: string) => DailyEntryView[]
    entriesByYear: (year: string) => DailyEntryView[]
    streak?: () => StreakState // NEW — reactive computed streak view (attached by streak.ts side-effect)
  }
}

// =================================================================
// 3. DATABASE-MAPPED & VIEW TYPES (Largely unchanged)
// =================================================================

export interface Flow {
  id: string
  dailyEntryId: string
  timestamp: string
  content: string
  wordCount: number
  user_id?: string | null
  local_session_id: string
  sync_excluded?: boolean
}

export interface Entry {
  id: string
  entryDate: string // "YYYY-MM-DD"
  lastModified: string
  user_id?: string | null
  local_session_id: string
  sync_excluded?: boolean
}

/**
 * A grace day earned by hitting a streak milestone.
 * Grace days can be spent to protect a streak on a missed day.
 *
 * Note: `userId` is camelCase here (unlike `Flow.user_id` which stays snake_case
 * for orphan-adoption compatibility). Grace days have no anonymous-origin lifecycle —
 * they are always created for an authenticated user — so there is no need for the
 * snake_case convention that signals "this field is written before login and adopted later".
 * If a future story introduces orphan grace-day adoption, switch to snake_case at that point.
 */
export interface GraceDay {
  id: string
  userId: string
  earnedAt: string
  earnedForMilestone: number
  usedForDate: string | null
}

/**
 * A registered device push token, used to fan out notifications to a user's
 * mobile devices.
 *
 * camelCase per the v1 convention. `userId` is camelCase (not snake_case
 * like Flow.user_id) because push tokens have NO anonymous-then-adopted
 * lifecycle — rows are only ever created by an authenticated user (mirrors
 * GraceDay). If a later story needs orphan adoption, switch to snake_case then.
 */
export interface PushToken {
  id: string
  userId: string
  expoPushToken: string
  platform: 'ios' | 'android'
  deviceLabel: string | null
  lastUsedAt: string
}

/**
 * A computed, UI-friendly structure representing a fully populated day's entry.
 *
 * Built by spreading the underlying `Entry` (`{ ...entry, flows, totalWords }`
 * in store views), so ownership metadata is present at runtime. `user_id` is
 * surfaced in the type because consumers on the cross-user defense path
 * (export filtering) must distinguish the current account's entries from a
 * previous account's local data.
 */
export interface DailyEntryView {
  id: string
  entryDate: string
  lastModified: string
  user_id?: string | null
  flows: Flow[]
  totalWords: number
}

/**
 * A computed, UI-friendly structure for a day's statistics.
 */
export interface DailyStatsView {
  totalWords: number
  goalReached: boolean
  flows: Flow[]
  progress: number // 0-1 representing progress toward goal
}
