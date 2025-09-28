/**
 * Journal state store using normalized, relational data structure optimized for Legend State
 */

import { observable, syncState, batch, when } from '@legendapp/state'
import type { Flow, Entry, JournalState, DailyEntryView, DailyStatsView } from './types'
import { getTodayJournalDayString } from './date-utils'

// Re-export types for convenience
export type { Flow, Entry, JournalState, DailyEntryView, DailyStatsView } from './types'

// Create the journal store with normalized initial state
export const journal$ = observable<JournalState>({
  entries: {},
  flows: {},
  activeFlow: null,
  session: {
    localSessionId: '',
    userId: null,
  },
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

export const clearJournalData = () => {
  journal$.set({
    entries: {},
    flows: {},
    activeFlow: null,
    session: {
      localSessionId: '',
      userId: null,
    },
    currentUser: null,
    lastUpdated: new Date().toISOString(),
  })
}

// Find an entry ID by its "Journal Day" string: uses the pre-built, memoized index
const findEntryIdByDateString = (dateString: string): string | null => {
  const entryIndex = journal$.views.entryIdsByDate.get()
  const id = entryIndex?.[dateString]
  return id || null
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

  const todayJournalDay = getTodayJournalDayString()

  batch(() => {
    // Find today's entry ID using the timezone-agnostic date string
    let todayEntryId = findEntryIdByDateString(todayJournalDay)

    // If today's entry doesn't exist, create it
    if (!todayEntryId) {
      todayEntryId = generateEntryId(todayJournalDay)
      const newEntry: Entry = {
        id: todayEntryId,
        // The `date` property is the 'YYYY-MM-DD' string, not a full timestamp.
        date: todayJournalDay,
        lastModified: new Date().toISOString(),
        local_session_id: journal$.session.localSessionId.get(),
      }
      // Directly set the new entry in the entries map
      journal$.entries[todayEntryId].set(newEntry)
    }

    // Create the new flow session
    const newFlowId = generateFlowId()
    const newFlow: Flow = {
      id: newFlowId,
      entry_id: todayEntryId,
      // 2. The flow's timestamp is stored as a full, precise UTC string.
      // This is the absolute, immutable truth of *when* the flow was written.
      // This separates the concept of a 'day' (for grouping) from the exact
      // moment of writing (for record-keeping).
      timestamp: new Date().toISOString(),
      content: activeFlow.content,
      local_session_id: journal$.session.localSessionId.get(),
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
    hasContent: !!activeFlow?.content?.trim(),
    isActive: !!activeFlow,
  }
}

// =================================================================
// Computed Observables for Derived State
// =================================================================
// By adding computeds directly to the observable, Legend State automatically
// memoizes them. They only re-run when the underlying data they `get()` changes,
// making them efficient.

journal$.assign({
  views: {
    /**
     * Creates a fast index mapping date strings ('YYYY-MM-DD') to their
     * corresponding entry IDs (UUIDs).
     * This is memoized and only recalculates when entries are added or removed,
     * making date-to-ID lookups instantaneous.
     */
    entryIdsByDate: (): Record<string, string> => {
      const allEntries = Object.values(journal$.entries.get())
      // The `reduce` function efficiently transforms the array of entries
      // into a simple { 'date': 'id' } map.
      return allEntries.reduce(
        (index, entry) => {
          index[entry.date] = entry.id
          return index
        },
        {} as Record<string, string>
      )
    },

    /**
     * A highly efficient lookup table to get all flows for a specific entry ID.
     */
    flowsByEntryId: (entryId: string): Flow[] => {
      const allFlows = Object.values(journal$.flows.get())
      return allFlows.filter((flow) => flow.entry_id === entryId)
    },
    /**
     * A "lookup table" computed to efficiently get a fully populated daily entry.
     * Access a specific day reactively like this:
     * `use$(journal$.views.entryByDate('2025-09-23'))`
     * This is the most performant way to get data for a single item.
     */
    entryByDate: (date: string): DailyEntryView | null => {
      // This computed depends on `entries` and `flows`.
      const allEntries = Object.values(journal$.entries.get())
      const entryData = allEntries.find((entry) => entry.date === date)

      if (!entryData) return null

      const allFlows = Object.values(journal$.flows.get())
      // Find all flows that belong to this entry.
      const flows = allFlows.filter((flow) => flow.entry_id === entryData.id)

      const totalWords = flows.reduce((sum, flow) => sum + flow.wordCount, 0)

      return {
        ...entryData,
        flows,
        totalWords,
      }
    },

    /**
     * A computed for a day's statistics.
     * This demonstrates composition: it efficiently uses the `entryByDate`
     * computed internally. It will re-run if that entry changes OR
     * if the user's word goal changes.
     */
    statsByDate: (date: string): DailyStatsView => {
      // This computed depends on the result of another computed and `currentUser.word_goal`.
      const entry = journal$.views.entryByDate(date)
      const wordGoal = journal$.currentUser.word_goal.get() ?? 750

      if (!entry) {
        return {
          totalWords: 0,
          goalReached: false,
          flows: [],
          progress: 0,
        }
      }

      const progress = Math.min(entry.totalWords / wordGoal, 1)

      return {
        totalWords: entry.totalWords,
        goalReached: entry.totalWords >= wordGoal,
        flows: entry.flows,
        progress,
      }
    },

    /**
     * A computed that returns all entries, fully populated and sorted.
     * This value is now cached and will only be recalculated if any entry
     * or flow is added, changed, or removed.
     */
    allEntriesSorted: (): DailyEntryView[] => {
      const allEntries = Object.values(journal$.entries.get())
      const allFlows = Object.values(journal$.flows.get())

      return allEntries
        .map((entry) => {
          const flows = allFlows.filter((flow) => flow.entry_id === entry.id)
          const totalWords = flows.reduce((sum, flow) => sum + flow.wordCount, 0)

          return {
            ...entry,
            flows,
            totalWords,
          }
        })
        .sort((a, b) => b.date.localeCompare(a.date))
    },

    /**
     * A computed "lookup table" to get all populated entries for a specific month.
     * The `date` property 'YYYY-MM-DD' makes this easy with `startsWith`.
     * Access reactively like: `use$(journal$.views.entriesByMonth('2025-09'))`
     * @param month A string in 'YYYY-MM' format.
     * @returns An array of populated daily entries, sorted most recent first.
     */
    entriesByMonth: (month: string): DailyEntryView[] => {
      const allEntries = Object.values(journal$.entries.get())
      const allFlows = Object.values(journal$.flows.get())

      return allEntries
        .filter((entry) => entry.date.startsWith(month))
        .map((entry) => {
          const flows = allFlows.filter((flow) => flow.entry_id === entry.id)
          const totalWords = flows.reduce((sum, flow) => sum + flow.wordCount, 0)
          return { ...entry, flows, totalWords }
        })
        .sort((a, b) => b.date.localeCompare(a.date))
    },

    /**
     * A computed "lookup table" to get all populated entries for a specific year.
     * Access reactively like: `use$(journal$.views.entriesByYear('2025'))`
     * @param year A string in 'YYYY' format.
     * @returns An array of populated daily entries, sorted most recent first.
     */
    entriesByYear: (year: string): DailyEntryView[] => {
      const allEntries = Object.values(journal$.entries.get())
      const allFlows = Object.values(journal$.flows.get())

      return allEntries
        .filter((entry) => entry.date.startsWith(year))
        .map((entry) => {
          const flows = allFlows.filter((flow) => flow.entry_id === entry.id)
          const totalWords = flows.reduce((sum, flow) => sum + flow.wordCount, 0)
          return { ...entry, flows, totalWords }
        })
        .sort((a, b) => b.date.localeCompare(a.date))
    },
  },
})
