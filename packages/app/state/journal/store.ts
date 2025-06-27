/**
 * Journal state store for testing Legend-State persistence with FlowSession and DailyJournalEntry
 */

import { syncObservable } from '@legendapp/state/sync'
import { observable, syncState, batch, when } from '@legendapp/state'
import { configurePersistence } from '../persistConfig'

// Data models from story requirements
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
}

// Create the journal store with initial values
export const journal$ = observable<JournalState>({
  currentEntry: null,
  entries: [],
  lastUpdated: null,
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

  console.log('Test data added to journal store:', {
    currentEntry: journal$.currentEntry.get(),
    entriesCount: journal$.entries.get().length,
  })
}

export const clearJournalData = () => {
  journal$.set({
    currentEntry: null,
    entries: [],
    lastUpdated: new Date().toISOString(),
  })
}
