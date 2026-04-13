/**
 * state/types.ts
 *
 * This file defines the single source of truth for the entire application's state shape.
 * It centralizes all core data structures, including session, user profile, and journal data,
 * into a unified `AppState` interface.
 */

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
 * For all user-specific settings and preferences. This entire object will be synced
 * to the 'profiles' table in Supabase.
 */
export interface UserProfile {
  word_goal: number
  themeName: ThemeName | 'custom'
  customTheme: CustomThemeDef | null
  fontPairing: FontPairingId

  sync: {
    word_goal: boolean
    themeName: boolean
    customTheme: boolean
    fontPairing: boolean
  }
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
  content: string
  /** Monotonic counter incremented on hide so ContentSyncer always re-fires its
   *  clear effect, even when content stays '' → '' (typing bypasses this field). */
  contentRevision: number
  /** Height of the screen header, used to position editor below it on Android */
  headerHeight: number
  /** Height of the bottom bar, used to inset editor above it on Android */
  bottomBarHeight: number
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
 * A computed, UI-friendly structure representing a fully populated day's entry.
 */
export interface DailyEntryView {
  id: string
  entryDate: string
  lastModified: string
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
