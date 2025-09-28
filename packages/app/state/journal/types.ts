/**
 * TypeScript types for journal state management
 * Normalized, relational data structure optimized for Legend State
 */

import type { Observable } from '@legendapp/state'

// Interface to describe the user's session state
export interface SessionState {
  localSessionId: string // Persistent UUID for the local device/browser session
  userId: string | null // Supabase user ID, populated on login
}

// Base data models - normalized structure that mirrors Supabase schema
export interface Flow {
  id: string
  entry_id: string // Link back to the parent entry
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

// The main state interface, now with the session object
export interface JournalState {
  entries: Record<string, Entry>
  flows: Record<string, Flow>
  activeFlow: {
    content: string
    wordCount: number
  } | null

  session: SessionState

  currentUser: {
    id: string
    word_goal: number
  } | null

  lastUpdated: string | null

  // Define the shape of the computed observables
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

// UI-friendly computed data structures (returned by selectors)
export interface DailyEntryView {
  id: string
  date: string
  lastModified: string
  flows: Flow[]
  totalWords: number
}

export interface DailyStatsView {
  totalWords: number
  goalReached: boolean
  flows: Flow[]
  progress: number // 0-1 representing progress toward goal
}

// Observable types for Legend-State
export type JournalObservable = Observable<JournalState>
export type FlowObservable = Observable<Flow>
export type EntryObservable = Observable<Entry>
export type ActiveFlowObservable = Observable<{ content: string; wordCount: number } | null>

// Text input change handler type
export type TextChangeHandler = (text: string) => void

// Flow session management action types
export type FlowSessionAction = 'start' | 'update' | 'save' | 'discard'

// Content validation result
export interface ContentValidationResult {
  isValid: boolean
  wordCount: number
  hasContent: boolean
  errors?: string[]
}
