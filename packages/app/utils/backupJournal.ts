/**
 * Pure backup payload serializer + restore planner.
 *
 * This module is intentionally store-free, network-free, platform-free and
 * synchronous: it only turns the current identity's exportable entries into a
 * serializable payload (`buildBackupPayload`), validates a decoded payload
 * (`parseAndValidateBackup`), and computes an additive restore plan
 * (`planRestore`). The store wrapper applies that plan; the UI drives the flow.
 *
 * Ownership scoping is delegated verbatim to `filterExportableEntries` — the
 * same rule used by the Markdown export and local search — so a previous
 * account's surviving local plaintext can never leak into a backup made by a
 * new identity.
 */
import type { DailyEntryView, Entry, Flow } from 'app/state/types'
import { filterExportableEntries } from 'app/utils/exportJournal'

/** Bump only for a breaking payload-shape change; older/newer values fail loud. */
export const BACKUP_SCHEMA_VERSION = 1

export interface BackupPayload {
  schemaVersion: number
  createdAt: string
  appVersion: string
  entryCount: number
  flowCount: number
  entries: Entry[]
  flows: Flow[]
}

export interface RestorePlan {
  entriesToInsert: Entry[]
  flowsToInsert: Flow[]
  entriesSkipped: number
  flowsSkipped: number
}

/** Typed error for malformed/unknown-version payloads (thrown after decrypt, before any write). */
export class BackupValidationError extends Error {
  code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'BackupValidationError'
    this.code = code
  }
}

/**
 * Flatten a filtered `DailyEntryView` back into the raw `Entry` that restore
 * writes into `entries$`. The view is `{ ...entry, flows, totalWords }`, so
 * dropping `flows`/`totalWords` leaves the raw entry fields verbatim — critically
 * `user_id`/`local_session_id`/`sync_excluded`, which keep restore additive-by-id
 * and ownership-preserving.
 */
function flattenEntry(view: DailyEntryView): Entry {
  const raw = view as unknown as Entry
  const entry: Entry = {
    id: raw.id,
    entryDate: raw.entryDate,
    lastModified: raw.lastModified,
    user_id: raw.user_id ?? null,
    local_session_id: raw.local_session_id,
  }
  if (raw.sync_excluded !== undefined) entry.sync_excluded = raw.sync_excluded
  return entry
}

/**
 * Build a backup payload from the current identity's exportable entries. The
 * first step is `filterExportableEntries` (ownership scoping — never
 * reimplemented here). An empty filtered set is valid: it returns a well-formed
 * zero-count payload rather than throwing on empty local state. Pure and
 * synchronous — `appVersion` and `createdAt` are supplied by the caller so this
 * module reads no platform module.
 */
export function buildBackupPayload(
  entries: DailyEntryView[],
  currentUserId: string | null,
  appVersion: string,
  createdAt: string = new Date().toISOString()
): BackupPayload {
  const filtered = filterExportableEntries(entries, currentUserId)

  const outEntries: Entry[] = []
  const outFlows: Flow[] = []
  for (const view of filtered) {
    outEntries.push(flattenEntry(view))
    for (const flow of view.flows) outFlows.push(flow)
  }

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt,
    appVersion,
    entryCount: outEntries.length,
    flowCount: outFlows.length,
    entries: outEntries,
    flows: outFlows,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object'

/**
 * Parse and shape/version-validate a decrypted payload string. Runs AFTER
 * decrypt but BEFORE any store write, so a malformed or unknown-version payload
 * fails loud with a typed error and never triggers a partial import.
 */
export function parseAndValidateBackup(json: string): BackupPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new BackupValidationError('Backup contents are not valid JSON.', 'backup_invalid_json')
  }

  if (!isRecord(parsed)) {
    throw new BackupValidationError('Backup contents are malformed.', 'backup_invalid_shape')
  }

  if (parsed.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new BackupValidationError(
      'Backup was created by an unsupported app version.',
      'backup_unsupported_schema_version'
    )
  }

  if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.flows)) {
    throw new BackupValidationError('Backup contents are malformed.', 'backup_invalid_collections')
  }

  // Every element must carry the id + linking fields restore keys the store on.
  // A missing/empty id would be inserted under the literal key "undefined"; a
  // missing entryDate/dailyEntryId would leave an incoherent record. Fail loud
  // here so a corrupt (but authenticated) payload never triggers a partial import.
  for (const entry of parsed.entries as unknown[]) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) {
      throw new BackupValidationError('A backup entry is malformed.', 'backup_invalid_entry')
    }
    if (typeof entry.entryDate !== 'string' || !entry.entryDate) {
      throw new BackupValidationError('A backup entry is malformed.', 'backup_invalid_entry')
    }
  }

  for (const flow of parsed.flows as unknown[]) {
    if (!isRecord(flow) || typeof flow.id !== 'string' || !flow.id) {
      throw new BackupValidationError('A backup flow is malformed.', 'backup_invalid_flow')
    }
    if (typeof flow.dailyEntryId !== 'string' || !flow.dailyEntryId) {
      throw new BackupValidationError('A backup flow is malformed.', 'backup_invalid_flow')
    }
  }

  return parsed as unknown as BackupPayload
}

/**
 * Compute the additive restore plan. Entries and flows are decided
 * independently by id: an id already present locally is skipped (counted); a new
 * id is inserted. Ids duplicated WITHIN the payload collapse to their first
 * occurrence (never double-inserted, never inflating a count). Ownership fields
 * are left untouched — this planner never mutates `user_id`/`sync_excluded`.
 */
export function planRestore(
  payload: BackupPayload,
  existingEntryIds: Set<string>,
  existingFlowIds: Set<string>
): RestorePlan {
  const entriesToInsert: Entry[] = []
  const flowsToInsert: Flow[] = []
  let entriesSkipped = 0
  let flowsSkipped = 0

  const seenEntryIds = new Set<string>()
  for (const entry of payload.entries) {
    if (seenEntryIds.has(entry.id)) continue
    seenEntryIds.add(entry.id)
    if (existingEntryIds.has(entry.id)) {
      entriesSkipped += 1
      continue
    }
    entriesToInsert.push(entry)
  }

  const seenFlowIds = new Set<string>()
  for (const flow of payload.flows) {
    if (seenFlowIds.has(flow.id)) continue
    seenFlowIds.add(flow.id)
    if (existingFlowIds.has(flow.id)) {
      flowsSkipped += 1
      continue
    }
    flowsToInsert.push(flow)
  }

  return { entriesToInsert, flowsToInsert, entriesSkipped, flowsSkipped }
}
