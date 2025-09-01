/**
 * Journal state management exports - Normalized, relational data structure
 */

// Main store and status
export { journal$, waitForJournalLoaded } from './store'

// Active flow session management (new API)
export {
  startNewActiveFlow,
  updateActiveFlowContent,
  getActiveFlowContent,
  getActiveFlowWordCount,
  saveActiveFlowSession,
  discardActiveFlowSession,
  debugActiveFlow,
} from './store'

// Computed selectors for UI data views
export {
  selectDailyEntry,
  selectDailyStats,
  selectAllEntries,
  selectRecentEntries,
} from './store'

// Utility functions
export {
  generateFlowId,
  generateEntryId,
  calculateWordCount,
  clearJournalData,
} from './store'

// Core types (new normalized structure)
export type {
  Flow,
  Entry,
  JournalState,
  DailyEntryView,
  DailyStatsView,
} from './types'

// Observable types
export type {
  JournalObservable,
  FlowObservable,
  EntryObservable,
  ActiveFlowObservable,
} from './types'

// Utility types
export type {
  TextChangeHandler,
  FlowSessionAction,
  ContentValidationResult,
} from './types'
