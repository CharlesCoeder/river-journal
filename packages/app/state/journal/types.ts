/**
 * TypeScript types for journal state management
 * Normalized, relational data structure optimized for Legend State
 */

import type { Observable } from '@legendapp/state'

// Base data models - normalized structure that mirrors Supabase schema
export interface Flow {
  id: string
  entry_id: string // Link back to the parent entry
  timestamp: string
  content: string
  wordCount: number
}

export interface Entry {
  id: string
  date: string // "YYYY-MM-DD"
  lastModified: string
  // We no longer store flows directly inside. We'll derive this in memory.
}

// In your types file (e.g., types.ts)

// ... (other interfaces like Flow, Entry, etc.)

export interface JournalState {
  // Use Records (maps) for efficient O(1) lookups
  entries: Record<string, Entry> // Keyed by Entry ID
  flows: Record<string, Flow>     // Keyed by Flow ID

  // A single, clean object for the active session
  activeFlow: {
    content: string
    wordCount: number
  } | null

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