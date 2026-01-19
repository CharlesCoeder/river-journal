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
}

/**
 * Defines all possible theme settings. These will be part of the UserProfile.
 */
export type BaseThemeName = 'light' | 'dark'

// Single source of truth for color theme names
export const DEFAULT_COLOR_THEMES = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'gray',
] as const

export type ColorThemeName = (typeof DEFAULT_COLOR_THEMES)[number]

/**
 * For all user-specific settings and preferences. This entire object will be synced
 * to the 'profiles' table in Supabase.
 */
export interface UserProfile {
  // Setting values
  word_goal: number
  baseTheme: BaseThemeName
  colorTheme: ColorThemeName

  // Granular configuration for which settings to sync
  sync: {
    word_goal: boolean
    baseTheme: boolean
    colorTheme: boolean
  }
}

/**
 * For the journal's data, kept in a normalized structure.
 */
export interface JournalData {
  entries: Record<string, Entry> // Keyed by Entry ID
  flows: Record<string, Flow> // Keyed by Flow ID
  activeFlow: {
    content: string
    wordCount: number
  } | null
  lastSavedFlow: LastSavedFlow | null // Temporary state for celebration screen
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
 * Layout bounds for positioning the persistent editor.
 */
export interface EditorLayoutBounds {
  top: number
  left: number
  width: number
  height: number
}

/**
 * Controls the persistent editor (native only).
 * The editor is always mounted at root layout but visibility is controlled via this state.
 */
export interface PersistentEditorState {
  isVisible: boolean
  readOnly: boolean
  content: string
  layout: EditorLayoutBounds | null
}

// =================================================================
// 2. THE UNIFIED APP STATE INTERFACE
// =================================================================

/**
 * The single, unified state object for the entire application.
 */
export interface AppState {
  session: SessionState
  profile: UserProfile | null // Null when the user is anonymous
  journal: JournalData
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
  entry_id: string
  timestamp: string
  content: string
  wordCount: number
  user_id?: string | null
  local_session_id: string
}

export interface Entry {
  id: string
  date: string // "YYYY-MM-DD"
  lastModified: string
  user_id?: string | null
  local_session_id: string
}

/**
 * A computed, UI-friendly structure representing a fully populated day's entry.
 */
export interface DailyEntryView {
  id: string
  date: string
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
