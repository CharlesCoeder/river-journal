/**
 * state/store.ts
 *
 * The single, unified state store for the entire application, powered by Legend State.
 * This file defines the central `store$` observable and includes all actions and
 * computed views that operate on the state.
 */

import { observable, syncState, batch, when } from '@legendapp/state'
import type {
  AppState,
  Flow,
  Entry,
  DailyEntryView,
  DailyStatsView,
  BaseThemeName,
  ColorThemeName,
} from './types'
import { DEFAULT_COLOR_THEMES } from './types'

import { getTodayJournalDayString } from './date-utils'

// Default theme values when no profile exists
const DEFAULT_BASE_THEME: BaseThemeName = 'light'
const DEFAULT_COLOR_THEME: ColorThemeName = 'blue'

// Re-export theme constants for convenience
export { DEFAULT_COLOR_THEMES }

// Theme validation helper
export const isValidColorTheme = (theme: string): theme is ColorThemeName => {
  return DEFAULT_COLOR_THEMES.includes(theme as ColorThemeName)
}

// =================================================================
// 1. THE CENTRAL STORE DEFINITION
// =================================================================

export const store$ = observable<AppState>({
  session: {
    localSessionId: '', // Populated on app startup from device storage
    userId: null,
  },
  profile: null, // Populated on login
  journal: {
    entries: {},
    flows: {},
    activeFlow: null,
    lastSavedFlow: null,
  },
  lastUpdated: null,
})

// =================================================================
// 2. CORE HELPER FUNCTIONS
// =================================================================

/**
 * Helper function to wait for the store to be loaded from persistence.
 * Replaces the old `waitForJournalLoaded`.
 */
export const waitForStoreLoaded = async () => {
  // If we're on the server, return immediately
  if (typeof window === 'undefined') {
    return true
  }

  try {
    await when(syncState(store$).isPersistLoaded)
    return true
  } catch (error) {
    console.error('Error in waitForStoreLoaded:', error)
    return false
  }
}

// ID generation and word count utilities
export const generateFlowId = (): string =>
  `flow_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

export const generateEntryId = (date: string): string =>
  `entry_${date}_${Math.random().toString(36).substring(2, 9)}`

export const calculateWordCount = (content: string): number =>
  content.trim() ? content.trim().split(/\s+/).length : 0

/**
 * Resets the application's data state, preserving the session.
 * Useful for logout scenarios.
 */
export const clearUserData = () => {
  batch(() => {
    store$.profile.set(null)
    store$.journal.set({
      entries: {},
      flows: {},
      activeFlow: null,
      lastSavedFlow: null,
    })
    store$.lastUpdated.set(new Date().toISOString())
  })
}

// =================================================================
// 3. STATE ACTIONS
// =================================================================

// -----------------------------------------------------------------
// Active Flow Actions
// -----------------------------------------------------------------

/**
 * Starts a new active flow session for real-time editing
 */
export const startNewActiveFlow = (): void => {
  batch(() => {
    store$.journal.activeFlow.set({
      content: '',
      wordCount: 0,
    })
    store$.lastUpdated.set(new Date().toISOString())
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
    if (!store$.journal.activeFlow.get() && content.length > 0) {
      store$.journal.activeFlow.set({
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
    } else if (store$.journal.activeFlow.get()) {
      // Direct mutable updates to the active flow
      store$.journal.activeFlow.content.set(content)
      store$.journal.activeFlow.wordCount.set(wordCount)
    }
    store$.lastUpdated.set(new Date().toISOString())
  })
}

/**
 * Saves the active flow session to the daily journal entry using mutable updates.
 * Stores the flow data in lastSavedFlow for the celebration screen.
 */
export const saveActiveFlowSession = (): void => {
  const activeFlow = store$.journal.activeFlow.get()

  // Don't save if there's no active flow or it's empty
  if (!activeFlow || !activeFlow.content.trim()) {
    return
  }

  const todayJournalDay = getTodayJournalDayString()
  const timestamp = new Date().toISOString()

  batch(() => {
    // Store flow data for celebration screen BEFORE clearing activeFlow
    store$.journal.lastSavedFlow.set({
      content: activeFlow.content,
      wordCount: activeFlow.wordCount,
      timestamp,
    })

    // Find today's entry ID using the timezone-agnostic date string
    const entryIndex = store$.views.entryIdsByDate.get()
    let todayEntryId = entryIndex?.[todayJournalDay] || null

    // If today's entry doesn't exist, create it
    if (!todayEntryId) {
      todayEntryId = generateEntryId(todayJournalDay)
      const newEntry: Entry = {
        id: todayEntryId,
        // The `date` property is the 'YYYY-MM-DD' string, not a full timestamp.
        date: todayJournalDay,
        lastModified: timestamp,
        local_session_id: store$.session.localSessionId.get(),
        user_id: store$.session.userId.get(), // Add userId on creation
      }
      // Directly set the new entry in the entries map
      store$.journal.entries[todayEntryId].set(newEntry)
    }

    // Create the new flow session
    const newFlowId = generateFlowId()
    const newFlow: Flow = {
      id: newFlowId,
      entry_id: todayEntryId,
      // The flow's timestamp is stored as a full, precise UTC string.
      // This is the absolute, immutable truth of *when* the flow was written.
      // This separates the concept of a 'day' (for grouping) from the exact
      // moment of writing (for record-keeping).
      timestamp,
      content: activeFlow.content,
      wordCount: activeFlow.wordCount,
      local_session_id: store$.session.localSessionId.get(),
      user_id: store$.session.userId.get(), // Add userId on creation
    }

    // Directly add the new flow to the flows map
    store$.journal.flows[newFlowId].set(newFlow)

    // Update the entry's lastModified timestamp
    store$.journal.entries[todayEntryId].lastModified.set(timestamp)

    // NOTE: activeFlow is NOT cleared here - it will be cleared by CelebrationScreen
    // on mount to prevent the placeholder flash during navigation
    store$.lastUpdated.set(timestamp)
  })
}

/**
 * Clears the lastSavedFlow state after user dismisses celebration screen
 */
export const clearLastSavedFlow = (): void => {
  store$.journal.lastSavedFlow.set(null)
}

/**
 * Clears the activeFlow state. Called by CelebrationScreen on mount
 * to complete the save flow transition without causing placeholder flash.
 */
export const clearActiveFlow = (): void => {
  store$.journal.activeFlow.set(null)
}

export const discardActiveFlowSession = (): void => {
  batch(() => {
    store$.journal.activeFlow.set(null)
    store$.lastUpdated.set(new Date().toISOString())
  })
}

/**
 * Gets the current active flow content
 */
export const getActiveFlowContent = (): string => {
  return store$.journal.activeFlow.content.get() || ''
}

/**
 * Gets the current active flow word count
 */
export const getActiveFlowWordCount = (): number => {
  return store$.journal.activeFlow.wordCount.get() || 0
}

/**
 * Debug function to test active flow persistence
 */
export const debugActiveFlow = () => {
  const activeFlow = store$.journal.activeFlow.get()
  const lastUpdated = store$.lastUpdated.get()

  return {
    content: activeFlow?.content || '',
    wordCount: activeFlow?.wordCount || 0,
    lastUpdated,
    hasContent: !!activeFlow?.content?.trim(),
    isActive: !!activeFlow,
  }
}

// -----------------------------------------------------------------
// Profile & Settings Actions
// -----------------------------------------------------------------

/**
 * Sets the base theme (light/dark) with automatic profile creation
 */
export const setBaseTheme = (baseTheme: BaseThemeName) => {
  // Create a default profile if none exists
  if (!store$.profile.get()) {
    store$.profile.set({
      word_goal: 750,
      baseTheme: DEFAULT_BASE_THEME,
      colorTheme: DEFAULT_COLOR_THEME,
      sync: {
        word_goal: true,
        baseTheme: true,
        colorTheme: true,
      },
    })
  }
  store$.profile.baseTheme.set(baseTheme)
}

/**
 * Sets the color theme with validation and automatic profile creation
 */
export const setColorTheme = (colorTheme: ColorThemeName) => {
  // Validate the theme name
  if (!DEFAULT_COLOR_THEMES.includes(colorTheme)) {
    console.warn(`Invalid color theme: ${colorTheme}. Using default: ${DEFAULT_COLOR_THEME}`)
    colorTheme = DEFAULT_COLOR_THEME
  }

  // Create a default profile if none exists
  if (!store$.profile.get()) {
    store$.profile.set({
      word_goal: 750,
      baseTheme: DEFAULT_BASE_THEME,
      colorTheme: DEFAULT_COLOR_THEME,
      sync: {
        word_goal: true,
        baseTheme: true,
        colorTheme: true,
      },
    })
  }
  store$.profile.colorTheme.set(colorTheme)
}

export const setWordGoal = (goal: number) => {
  // Create a default profile if none exists
  if (!store$.profile.get()) {
    store$.profile.set({
      word_goal: 750,
      baseTheme: DEFAULT_BASE_THEME,
      colorTheme: DEFAULT_COLOR_THEME,
      sync: {
        word_goal: true,
        baseTheme: true,
        colorTheme: true,
      },
    })
  }
  store$.profile.word_goal.set(goal)
}

// =================================================================
// 5. THEME HELPERS (WITH FALLBACKS)
// =================================================================

/**
 * Gets the current base theme, with fallback to default
 */
export const getCurrentBaseTheme = (): BaseThemeName => {
  return store$.profile.baseTheme.get() ?? DEFAULT_BASE_THEME
}

/**
 * Gets the current color theme, with fallback to default
 */
export const getCurrentColorTheme = (): ColorThemeName => {
  return store$.profile.colorTheme.get() ?? DEFAULT_COLOR_THEME
}

// =================================================================
// 4. COMPUTED VIEWS (DERIVED STATE)
// =================================================================
// By adding computeds directly to the observable, Legend State automatically
// memoizes them. They only re-run when the underlying data they `get()` changes,
// making them efficient.

store$.assign({
  views: {
    /**
     * Creates a fast index mapping date strings ('YYYY-MM-DD') to their
     * corresponding entry IDs (UUIDs).
     * This is memoized and only recalculates when entries are added or removed,
     * making date-to-ID lookups instantaneous.
     */
    entryIdsByDate: (): Record<string, string> => {
      const allEntries = Object.values(store$.journal.entries.get())
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
      const allFlows = Object.values(store$.journal.flows.get())
      return allFlows.filter((flow) => flow.entry_id === entryId)
    },

    /**
     * A "lookup table" computed to efficiently get a fully populated daily entry.
     * Access a specific day reactively like this:
     * `use$(store$.views.entryByDate('2025-09-23'))`
     * This is the most performant way to get data for a single item.
     */
    entryByDate: (date: string): DailyEntryView | null => {
      // This computed depends on `entries` and `flows`.
      const allEntries = Object.values(store$.journal.entries.get())
      const entryData = allEntries.find((entry) => entry.date === date)

      if (!entryData) return null

      const allFlows = Object.values(store$.journal.flows.get())
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
      // This computed depends on the result of another computed and `profile.word_goal`.
      const entry = store$.views.entryByDate(date)
      // **CRITICAL CHANGE**: The word goal now comes from the unified profile state!
      const wordGoal = store$.profile.word_goal.get() ?? 750

      if (!entry) {
        return {
          totalWords: 0,
          goalReached: false,
          flows: [],
          progress: 0,
        }
      }

      const progress = wordGoal > 0 ? Math.min(entry.totalWords / wordGoal, 1) : 1

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
      const allEntries = Object.values(store$.journal.entries.get())
      const allFlows = Object.values(store$.journal.flows.get())

      return allEntries
        .map((entry) => {
          const flows = allFlows.filter((flow) => flow.entry_id === entry.id)
          const totalWords = flows.reduce((sum, flow) => sum + flow.wordCount, 0)
          return { ...entry, flows, totalWords }
        })
        .sort((a, b) => b.date.localeCompare(a.date))
    },

    /**
     * A computed "lookup table" to get all populated entries for a specific month.
     * The `date` property 'YYYY-MM-DD' makes this easy with `startsWith`.
     * Access reactively like: `use$(store$.views.entriesByMonth('2025-09'))`
     * @param month A string in 'YYYY-MM' format.
     * @returns An array of populated daily entries, sorted most recent first.
     */
    entriesByMonth: (month: string): DailyEntryView[] => {
      // This view now implicitly depends on the `allEntriesSorted` view for its data,
      // making it even more efficient.
      const sortedEntries = store$.views.allEntriesSorted()
      return sortedEntries.filter((entry) => entry.date.startsWith(month))
    },

    /**
     * A computed "lookup table" to get all populated entries for a specific year.
     * Access reactively like: `use$(store$.views.entriesByYear('2025'))`
     * @param year A string in 'YYYY' format.
     * @returns An array of populated daily entries, sorted most recent first.
     */
    entriesByYear: (year: string): DailyEntryView[] => {
      const sortedEntries = store$.views.allEntriesSorted()
      return sortedEntries.filter((entry) => entry.date.startsWith(year))
    },
  },
})
