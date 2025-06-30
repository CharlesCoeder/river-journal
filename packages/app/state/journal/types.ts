/**
 * TypeScript types for journal state management
 */

import type { Observable } from '@legendapp/state'

// Base data models (re-exported from store for consistency)
export interface FlowSession {
  id: string
  timestamp: string
  content: string
  wordCount: number
}

export interface DailyJournalEntry {
  id: string
  date: string
  flows: FlowSession[]
  finalWordCount: number
  lastModified: string
}

export interface JournalState {
  currentEntry: DailyJournalEntry | null
  entries: DailyJournalEntry[]
  lastUpdated: string | null
  currentFlowSession: FlowSession | null
  // Direct properties for better persistence tracking
  currentFlowContent: string
  currentFlowWordCount: number
}

// Observable types for Legend-State
export type JournalObservable = Observable<JournalState>
export type FlowSessionObservable = Observable<FlowSession>
export type CurrentFlowContentObservable = Observable<string>
export type CurrentFlowWordCountObservable = Observable<number>

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
