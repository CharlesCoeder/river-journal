/**
 * Journal state store for testing Legend-State persistence with FlowSession and DailyJournalEntry
 */

import { syncObservable } from '@legendapp/state/sync'
import { observable, syncState, batch, when } from '@legendapp/state'
import { configurePersistence } from '../persistConfig'
import type { FlowSession, DailyJournalEntry, JournalState } from './types'

// Re-export types for convenience
export type { FlowSession, DailyJournalEntry, JournalState } from './types'

// Create the journal store with initial values
export const journal$ = observable<JournalState>({
  currentEntry: null,
  entries: [],
  lastUpdated: null,
  currentFlowSession: null,
  currentFlowContent: '',
  currentFlowWordCount: 0,
})

// Only setup persistence on the client side
if (typeof window !== 'undefined') {
  try {
    syncObservable(
      journal$,
      configurePersistence({
        persist: {
          name: 'journal',
        },
      })
    )
  } catch (error) {
    console.error('Error setting up journal store persistence:', error)
  }
}

// Status observable for tracking when persistence is loaded
export const journalStatus$ = syncState(journal$)

// Helper function to wait for journal state to be loaded from persistence
export const waitForJournalLoaded = async () => {
  // If we're on the server, return immediately
  if (typeof window === 'undefined') {
    return true
  }

  try {
    await when(journalStatus$.isPersistLoaded)
    return true
  } catch (error) {
    console.error('Error in waitForJournalLoaded:', error)
    return false
  }
}

// Helper functions for journal operations
export const createFlowSession = (content: string): FlowSession => {
  return {
    id: `flow_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    timestamp: new Date().toISOString(),
    content,
    wordCount: content.trim() ? content.trim().split(/\s+/).length : 0,
  }
}

export const createDailyJournalEntry = (
  date: string,
  flows: FlowSession[] = []
): DailyJournalEntry => {
  const finalWordCount = flows.reduce((total, flow) => total + flow.wordCount, 0)

  return {
    id: `entry_${date}_${Math.random().toString(36).substring(2, 11)}`,
    date,
    flows,
    finalWordCount,
    lastModified: new Date().toISOString(),
  }
}

export const addFlowSession = (content: string) => {
  const newFlow = createFlowSession(content)
  const today = new Date().toISOString().split('T')[0]

  batch(() => {
    let currentEntry = journal$.currentEntry.get()

    if (!currentEntry || currentEntry.date !== today) {
      // Create new entry for today
      currentEntry = createDailyJournalEntry(today, [newFlow])
      journal$.currentEntry.set(currentEntry)
      journal$.entries.set((prev) => [...prev, currentEntry!])
    } else {
      // Add to existing entry
      const updatedFlows = [...currentEntry.flows, newFlow]
      const updatedEntry = {
        ...currentEntry,
        flows: updatedFlows,
        finalWordCount: updatedFlows.reduce((total, flow) => total + flow.wordCount, 0),
        lastModified: new Date().toISOString(),
      }

      journal$.currentEntry.set(updatedEntry)
      journal$.entries.set((prev) =>
        prev.map((entry) => (entry.id === updatedEntry.id ? updatedEntry : entry))
      )
    }
  })
}

export const testBasicPersistence = () => {
  // Create test data
  const testContent = 'This is a test flow session for Legend-State persistence validation.'
  addFlowSession(testContent)
}

export const clearJournalData = () => {
  journal$.set({
    currentEntry: null,
    entries: [],
    lastUpdated: new Date().toISOString(),
    currentFlowSession: null,
    currentFlowContent: '',
    currentFlowWordCount: 0,
  })
}

// Current Flow Session Management Functions

/**
 * Creates a new flow session for real-time editing
 */
export const startNewFlowSession = (): void => {
  const newFlowSession = createFlowSession('')
  batch(() => {
    journal$.currentFlowSession.set(newFlowSession)
    journal$.currentFlowContent.set('')
    journal$.currentFlowWordCount.set(0)
    journal$.lastUpdated.set(new Date().toISOString())
  })
}

/**
 * Updates the content of the current flow session and recalculates word count
 * Auto-initializes flow session on first keystroke if none exists
 */
export const updateCurrentFlowContent = (content: string): void => {
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0

  batch(() => {
    // Update direct properties for better persistence tracking
    journal$.currentFlowContent.set(content)
    journal$.currentFlowWordCount.set(wordCount)
    journal$.lastUpdated.set(new Date().toISOString())

    // Auto-initialize flow session on first keystroke if none exists
    const currentFlow = journal$.currentFlowSession.get()
    if (!currentFlow && content.length > 0) {
      // Create new flow session when user starts typing
      const newFlowSession = createFlowSession(content)
      journal$.currentFlowSession.set(newFlowSession)

      // Debug log for flow creation tracking
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.log('🌊 Flow session created on first keystroke:', {
          flowId: newFlowSession.id,
          timestamp: newFlowSession.timestamp,
          firstCharacter: content.charAt(0),
          contentLength: content.length,
        })
      }
    } else if (currentFlow) {
      // Update existing flow session
      journal$.currentFlowSession.content.set(content)
      journal$.currentFlowSession.wordCount.set(wordCount)
    }
  })
}

/**
 * Gets the current flow session content
 */
export const getCurrentFlowContent = (): string => {
  return journal$.currentFlowContent.get()
}

/**
 * Gets the current flow session word count
 */
export const getCurrentFlowWordCount = (): number => {
  return journal$.currentFlowWordCount.get()
}

/**
 * Saves the current flow session to the daily journal entry
 */
export const saveCurrentFlowSession = (): void => {
  const content = journal$.currentFlowContent.get()
  if (!content.trim()) {
    return // Don't save empty flow sessions
  }

  // Create a flow session from the current content
  const currentFlow = createFlowSession(content)

  const today = new Date().toISOString().split('T')[0]

  batch(() => {
    let currentEntry = journal$.currentEntry.get()

    if (!currentEntry || currentEntry.date !== today) {
      // Create new entry for today
      currentEntry = createDailyJournalEntry(today, [currentFlow])
      journal$.currentEntry.set(currentEntry)
      journal$.entries.set((prev) => [...prev, currentEntry!])
    } else {
      // Add to existing entry
      const updatedFlows = [...currentEntry.flows, currentFlow]
      const updatedEntry = {
        ...currentEntry,
        flows: updatedFlows,
        finalWordCount: updatedFlows.reduce((total, flow) => total + flow.wordCount, 0),
        lastModified: new Date().toISOString(),
      }

      journal$.currentEntry.set(updatedEntry)
      journal$.entries.set((prev) =>
        prev.map((entry) => (entry.id === updatedEntry.id ? updatedEntry : entry))
      )
    }

    // Clear the current flow session after saving
    journal$.currentFlowSession.set(null)
    journal$.currentFlowContent.set('')
    journal$.currentFlowWordCount.set(0)
  })
}

/**
 * Discards the current flow session without saving
 */
export const discardCurrentFlowSession = (): void => {
  batch(() => {
    journal$.currentFlowSession.set(null)
    journal$.currentFlowContent.set('')
    journal$.currentFlowWordCount.set(0)
    journal$.lastUpdated.set(new Date().toISOString())
  })
}

/**
 * Debug function to test real-time content persistence
 */
export const debugCurrentFlow = () => {
  const content = journal$.currentFlowContent.get()
  const wordCount = journal$.currentFlowWordCount.get()
  const lastUpdated = journal$.lastUpdated.get()

  return {
    content,
    wordCount,
    lastUpdated,
    hasContent: !!content.trim(),
  }
}
