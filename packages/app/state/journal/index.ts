/**
 * Journal state management exports
 */

// Main store and status
export { journal$, journalStatus$, waitForJournalLoaded } from './store'

// Current flow session management
export {
  startNewFlowSession,
  updateCurrentFlowContent,
  getCurrentFlowContent,
  getCurrentFlowWordCount,
  saveCurrentFlowSession,
  discardCurrentFlowSession,
} from './store'

// Legacy functions (maintained for backward compatibility)
export {
  createFlowSession,
  createDailyJournalEntry,
  addFlowSession,
  testBasicPersistence,
  clearJournalData,
  debugCurrentFlow,
} from './store'

// Types
export type {
  FlowSession,
  DailyJournalEntry,
  JournalState,
  JournalObservable,
  FlowSessionObservable,
  CurrentFlowContentObservable,
  CurrentFlowWordCountObservable,
  TextChangeHandler,
  FlowSessionAction,
  ContentValidationResult,
} from './types'
