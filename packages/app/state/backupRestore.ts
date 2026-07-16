/**
 * Store-side restore action for encrypted backups.
 *
 * Applies a validated `BackupPayload` additively inside a single `batch()` so
 * subscribers fire once and `syncedSupabase` sees one atomic change set. Items
 * whose id already exists locally are skipped (never overwritten — restore is
 * additive, never destructive); new items are inserted verbatim. Ownership
 * fields (`user_id`/`sync_excluded`) are never nulled, rewritten, or re-derived
 * here: a foreign-owned item lands inert and is governed thereafter by the
 * app's existing orphan-consent + `isSyncReady$` machinery, with no new
 * adoption logic and no special-casing.
 */
import { batch } from '@legendapp/state'
import { entries$ } from './entries'
import { flows$ } from './flows'
import { store$ } from './store'
import { planRestore, type BackupPayload } from '../utils/backupJournal'

export interface RestoreResult {
  entriesRestored: number
  flowsRestored: number
  entriesSkipped: number
  flowsSkipped: number
}

export function restoreBackup(payload: BackupPayload): RestoreResult {
  const existingEntryIds = new Set(Object.keys(entries$.peek() ?? {}))
  const existingFlowIds = new Set(Object.keys(flows$.peek() ?? {}))

  const plan = planRestore(payload, existingEntryIds, existingFlowIds)

  batch(() => {
    for (const entry of plan.entriesToInsert) {
      // Insert-only .set() of a fresh id — never a map replacement, so the
      // two-phase-nullify ghost-delete hazard does not apply.
      entries$[entry.id]!.set(entry)
    }
    for (const flow of plan.flowsToInsert) {
      flows$[flow.id]!.set(flow)
    }
    store$.lastUpdated.set(new Date().toISOString())
  })

  return {
    entriesRestored: plan.entriesToInsert.length,
    flowsRestored: plan.flowsToInsert.length,
    entriesSkipped: plan.entriesSkipped,
    flowsSkipped: plan.flowsSkipped,
  }
}
