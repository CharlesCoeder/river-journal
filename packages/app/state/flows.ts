/**
 * state/flows.ts
 *
 * Standalone observable for flow data, keyed by Flow ID.
 *
 * For now this is a plain observable with local persistence wired in initializeApp.ts.
 */

import { observable } from '@legendapp/state'
import type { Flow } from './types'

// =================================================================
// FLOWS OBSERVABLE
// =================================================================

/**
 * Top-level observable holding all flow records, keyed by Flow ID.
 * This maps 1:1 to the `flows` Supabase table and will be wired
 * with syncedSupabase().
 */
export const flows$ = observable<Record<string, Flow>>({})
