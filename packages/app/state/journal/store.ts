/**
 * Journal state store using normalized, relational data structure optimized for Legend State
 */

import { observable, syncState, batch, when } from '@legendapp/state'
import type { Flow, Entry, JournalState, DailyEntryView, DailyStatsView } from './types'

// Re-export types for convenience
export type { Flow, Entry, JournalState, DailyEntryView, DailyStatsView } from './types'

// Create the journal store with normalized initial state
export const journal$ = observable<JournalState>({
  entries: {},
  flows: {},
  activeFlow: null,
  currentUser: null,
  lastUpdated: null,
})

// Helper function to wait for journal state to be loaded from persistence
export const waitForJournalLoaded = async () => {
  // If we're on the server, return immediately
  if (typeof window === 'undefined') {
    return true
  }

  try {
    await when(syncState(journal$).isPersistLoaded)
    return true
  } catch (error) {
    console.error('Error in waitForJournalLoaded:', error)
    return false
  }
}

// Helper functions for creating IDs and calculating word counts
export const generateFlowId = (): string => {
  return `flow_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

export const generateEntryId = (date: string): string => {
  return `entry_${date}_${Math.random().toString(36).substring(2, 9)}`
}

export const calculateWordCount = (content: string): number => {
  return content.trim() ? content.trim().split(/\s+/).length : 0
}

// Helper function to find today's entry ID efficiently
const findTodayEntryId = (date: string): string | null => {
  const entries = journal$.entries.get()
  const entry = Object.values(entries).find((entry) => entry.date === date)
  return entry?.id || null
}

export const clearJournalData = () => {
  journal$.set({
    entries: {},
    flows: {},
    activeFlow: null,
    currentUser: null,
    lastUpdated: new Date().toISOString(),
  })
}

// Active Flow Session Management Functions

/**
 * Starts a new active flow session for real-time editing
 */
export const startNewActiveFlow = (): void => {
  batch(() => {
    journal$.activeFlow.set({
      content: '',
      wordCount: 0,
    })
    journal$.lastUpdated.set(new Date().toISOString())
  })
}

/**
 * Updates the content of the active flow session and recalculates word count
 * Auto-initializes active flow on first keystroke if none exists
 */
export const updateActiveFlowContent = (content: string): void => {
  const wordCount = calculateWordCount(content)

  batch(() => {
    // Auto-initialize active flow on first keystroke if none exists
    if (!journal$.activeFlow.get() && content.length > 0) {
      journal$.activeFlow.set({
        content,
        wordCount,
      })

      // Debug log for flow creation tracking
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.log('🌊 Active flow started on first keystroke:', {
          firstCharacter: content.charAt(0),
          contentLength: content.length,
          wordCount,
        })
      }
    } else if (journal$.activeFlow.get()) {
      // Direct mutable updates to the active flow
      journal$.activeFlow.content.set(content)
      journal$.activeFlow.wordCount.set(wordCount)
    }

    journal$.lastUpdated.set(new Date().toISOString())
  })
}

/**
 * Gets the current active flow content
 */
export const getActiveFlowContent = (): string => {
  return journal$.activeFlow.content.get() || ''
}

/**
 * Gets the current active flow word count
 */
export const getActiveFlowWordCount = (): number => {
  return journal$.activeFlow.wordCount.get() || 0
}

/**
 * Saves the active flow session to the daily journal entry using mutable updates
 */
export const saveActiveFlowSession = (): void => {
  const activeFlow = journal$.activeFlow.get()

  // Don't save if there's no active flow or it's empty
  if (!activeFlow || !activeFlow.content.trim()) {
    return
  }

  const today = new Date().toISOString().split('T')[0]

  batch(() => {
    // Find today's entry ID
    let todayEntryId = findTodayEntryId(today)

    // If today's entry doesn't exist, create it
    if (!todayEntryId) {
      todayEntryId = generateEntryId(today)
      const newEntry: Entry = {
        id: todayEntryId,
        date: today,
        lastModified: new Date().toISOString(),
      }
      // Directly set the new entry in the entries map
      journal$.entries[todayEntryId].set(newEntry)
    }

    // Create the new flow session
    const newFlowId = generateFlowId()
    const newFlow: Flow = {
      id: newFlowId,
      entry_id: todayEntryId,
      timestamp: new Date().toISOString(),
      content: activeFlow.content,
      wordCount: activeFlow.wordCount,
    }

    // Directly add the new flow to the flows map
    journal$.flows[newFlowId].set(newFlow)

    // Update the entry's lastModified timestamp
    journal$.entries[todayEntryId].lastModified.set(new Date().toISOString())

    // Clear the active flow session
    journal$.activeFlow.set(null)
    journal$.lastUpdated.set(new Date().toISOString())
  })
}

/**
 * Discards the active flow session without saving
 */
export const discardActiveFlowSession = (): void => {
  batch(() => {
    journal$.activeFlow.set(null)
    journal$.lastUpdated.set(new Date().toISOString())
  })
}

/**
 * Debug function to test active flow persistence
 */
export const debugActiveFlow = () => {
  const activeFlow = journal$.activeFlow.get()
  const lastUpdated = journal$.lastUpdated.get()

  return {
    content: activeFlow?.content || '',
    wordCount: activeFlow?.wordCount || 0,
    lastUpdated,
    hasContent: !!(activeFlow?.content?.trim()),
    isActive: !!activeFlow,
  }
}

// Computed Selectors - Functions that derive UI-friendly data from the normalized store

/**
 * Gets a fully populated daily entry, including its flows
 */
export function selectDailyEntry(date: string): DailyEntryView | null {
  const allEntries = Object.values(journal$.entries.get())
  const entryData = allEntries.find(entry => entry.date === date)

  if (!entryData) return null

  const allFlows = Object.values(journal$.flows.get())
  const flows = allFlows.filter(flow => flow.entry_id === entryData.id)
  
  const totalWords = flows.reduce((sum, flow) => sum + flow.wordCount, 0)

  return { 
    ...entryData, 
    flows,
    totalWords
  }
}

/**
 * Computes stats for a given day
 */
export function selectDailyStats(date: string): DailyStatsView {
  const entry = selectDailyEntry(date)
  const wordGoal = journal$.currentUser.word_goal.get() ?? 750

  if (!entry) {
    return { 
      totalWords: 0, 
      goalReached: false, 
      flows: [],
      progress: 0
    }
  }

  const progress = Math.min(entry.totalWords / wordGoal, 1)
  
  return {
    totalWords: entry.totalWords,
    goalReached: entry.totalWords >= wordGoal,
    flows: entry.flows,
    progress
  }
}

/**
 * Gets all entries sorted by date (newest first)
 */
export function selectAllEntries(): DailyEntryView[] {
  const allEntries = Object.values(journal$.entries.get())
  const allFlows = Object.values(journal$.flows.get())
  
  return allEntries
    .map(entry => {
      const flows = allFlows.filter(flow => flow.entry_id === entry.id)
      const totalWords = flows.reduce((sum, flow) => sum + flow.wordCount, 0)
      
      return {
        ...entry,
        flows,
        totalWords
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * Gets recent entries (last 7 days by default)
 */
export function selectRecentEntries(days = 7): DailyEntryView[] {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)
  const cutoffString = cutoffDate.toISOString().split('T')[0]
  
  return selectAllEntries().filter(entry => entry.date >= cutoffString)
}