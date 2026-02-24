/**
 * state/entries.ts
 *
 * Standalone observable for daily entry data, keyed by Entry ID.
 *
 * For now this is a plain observable with local persistence wired in initializeApp.ts.
 */

import { observable } from '@legendapp/state'
import type { Entry } from './types'

// =================================================================
// ENTRIES OBSERVABLE
// =================================================================

/**
 * Top-level observable holding all daily entry records, keyed by Entry ID.
 * This maps 1:1 to the `daily_entries` Supabase table and will be wired
 * with syncedSupabase()
 */
export const entries$ = observable<Record<string, Entry>>({})
