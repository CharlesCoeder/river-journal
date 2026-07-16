/**
 * Unit tests for the pure backup serializer + restore planner
 * (`backupJournal.ts`) — ownership scoping, metadata/counts, payload validation,
 * and the additive/independent/de-duplicating restore plan. No store, no crypto.
 */
import { describe, expect, it } from 'vitest'
import type { DailyEntryView, Entry, Flow } from 'app/state/types'
import {
  BACKUP_SCHEMA_VERSION,
  BackupValidationError,
  buildBackupPayload,
  parseAndValidateBackup,
  planRestore,
  type BackupPayload,
} from '../backupJournal'

function flow(id: string, entryId: string, userId: string | null, content = 'body'): Flow {
  return {
    id,
    dailyEntryId: entryId,
    timestamp: '2026-04-10T12:00:00.000Z',
    content,
    wordCount: content.split(/\s+/).filter(Boolean).length,
    user_id: userId,
    local_session_id: 'session-1',
  }
}

function view(id: string, userId: string | null, flows: Flow[]): DailyEntryView {
  const raw = {
    id,
    entryDate: '2026-04-10',
    lastModified: '2026-04-10T12:00:00.000Z',
    user_id: userId,
    local_session_id: 'session-1',
    flows,
    totalWords: flows.reduce((sum, f) => sum + f.wordCount, 0),
  }
  return raw as unknown as DailyEntryView
}

describe('buildBackupPayload — ownership scoping via filterExportableEntries', () => {
  it('excludes entries owned by a different (non-null) user', () => {
    const mine = view('entry-mine', 'me', [flow('flow-mine', 'entry-mine', 'me')])
    const theirs = view('entry-theirs', 'other', [flow('flow-theirs', 'entry-theirs', 'other')])
    const payload = buildBackupPayload([mine, theirs], 'me', '1.0.0')

    expect(payload.entries.map((e) => e.id)).toEqual(['entry-mine'])
    expect(payload.flows.map((f) => f.id)).toEqual(['flow-mine'])
  })

  it('always includes anonymous (null user_id) local data', () => {
    const anon = view('entry-anon', null, [flow('flow-anon', 'entry-anon', null)])
    const payload = buildBackupPayload([anon], 'me', '1.0.0')
    expect(payload.entries.map((e) => e.id)).toEqual(['entry-anon'])
  })

  it('when signed out (null current user), excludes every account-owned entry', () => {
    const owned = view('entry-owned', 'someone', [flow('flow-owned', 'entry-owned', 'someone')])
    const anon = view('entry-anon', null, [flow('flow-anon', 'entry-anon', null)])
    const payload = buildBackupPayload([owned, anon], null, '1.0.0')
    expect(payload.entries.map((e) => e.id)).toEqual(['entry-anon'])
  })
})

describe('buildBackupPayload — metadata, counts, empty corpus, field preservation', () => {
  it('produces a well-formed zero-count payload for an empty corpus (never throws)', () => {
    const payload = buildBackupPayload([], 'me', '2.3.4', '2026-04-10T00:00:00.000Z')
    expect(payload).toMatchObject({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '2.3.4',
      createdAt: '2026-04-10T00:00:00.000Z',
      entryCount: 0,
      flowCount: 0,
      entries: [],
      flows: [],
    })
  })

  it('sets counts to match the serialized collections', () => {
    const v = view('e1', 'me', [flow('f1', 'e1', 'me'), flow('f2', 'e1', 'me')])
    const payload = buildBackupPayload([v], 'me', '1.0.0')
    expect(payload.entryCount).toBe(1)
    expect(payload.flowCount).toBe(2)
  })

  it('flattens the view back into a raw Entry, preserving ownership fields verbatim', () => {
    const v = view('e1', 'me', [flow('f1', 'e1', 'me')])
    ;(v as unknown as Entry).sync_excluded = true
    const payload = buildBackupPayload([v], 'me', '1.0.0')
    const entry = payload.entries[0]!
    expect(entry).toEqual({
      id: 'e1',
      entryDate: '2026-04-10',
      lastModified: '2026-04-10T12:00:00.000Z',
      user_id: 'me',
      local_session_id: 'session-1',
      sync_excluded: true,
    })
    // The view-only computed fields must not leak into the raw entry.
    expect('flows' in entry).toBe(false)
    expect('totalWords' in entry).toBe(false)
  })
})

describe('parseAndValidateBackup', () => {
  const valid: BackupPayload = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: '2026-04-10T00:00:00.000Z',
    appVersion: '1.0.0',
    entryCount: 0,
    flowCount: 0,
    entries: [],
    flows: [],
  }

  it('parses a valid payload', () => {
    expect(parseAndValidateBackup(JSON.stringify(valid))).toMatchObject({ schemaVersion: 1 })
  })

  it('rejects a future/unknown schemaVersion', () => {
    const future = { ...valid, schemaVersion: BACKUP_SCHEMA_VERSION + 1 }
    expect(() => parseAndValidateBackup(JSON.stringify(future))).toThrow(BackupValidationError)
  })

  it('rejects malformed JSON', () => {
    expect(() => parseAndValidateBackup('{not json')).toThrow(BackupValidationError)
  })

  it('rejects a payload whose entries/flows are not arrays', () => {
    const bad = { ...valid, entries: 'nope' }
    expect(() => parseAndValidateBackup(JSON.stringify(bad))).toThrow(BackupValidationError)
  })

  const wellFormedEntry = {
    id: 'e1',
    entryDate: '2026-04-10',
    lastModified: '2026-04-10T12:00:00.000Z',
    user_id: 'me',
    local_session_id: 'session-1',
  }
  const wellFormedFlow = {
    id: 'f1',
    dailyEntryId: 'e1',
    timestamp: '2026-04-10T12:00:00.000Z',
    content: 'body',
    wordCount: 1,
    user_id: 'me',
    local_session_id: 'session-1',
  }

  it('accepts a payload whose entries and flows are well-formed', () => {
    const good = { ...valid, entries: [wellFormedEntry], flows: [wellFormedFlow] }
    expect(() => parseAndValidateBackup(JSON.stringify(good))).not.toThrow()
  })

  it('rejects an entry that is not an object', () => {
    const bad = { ...valid, entries: ['nope'] }
    expect(() => parseAndValidateBackup(JSON.stringify(bad))).toThrow(BackupValidationError)
  })

  it('rejects an entry missing a non-empty string id', () => {
    const bad = { ...valid, entries: [{ ...wellFormedEntry, id: '' }] }
    expect(() => parseAndValidateBackup(JSON.stringify(bad))).toThrow(BackupValidationError)
  })

  it('rejects an entry whose id is not a string', () => {
    const { id: _dropped, ...noId } = wellFormedEntry
    const bad = { ...valid, entries: [noId] }
    expect(() => parseAndValidateBackup(JSON.stringify(bad))).toThrow(BackupValidationError)
  })

  it('rejects an entry missing a string entryDate', () => {
    const { entryDate: _dropped, ...noDate } = wellFormedEntry
    const bad = { ...valid, entries: [noDate] }
    expect(() => parseAndValidateBackup(JSON.stringify(bad))).toThrow(BackupValidationError)
  })

  it('rejects a flow missing a non-empty string id', () => {
    const bad = { ...valid, entries: [wellFormedEntry], flows: [{ ...wellFormedFlow, id: '' }] }
    expect(() => parseAndValidateBackup(JSON.stringify(bad))).toThrow(BackupValidationError)
  })

  it('rejects a flow missing a string dailyEntryId', () => {
    const { dailyEntryId: _dropped, ...noParent } = wellFormedFlow
    const bad = { ...valid, entries: [wellFormedEntry], flows: [noParent] }
    expect(() => parseAndValidateBackup(JSON.stringify(bad))).toThrow(BackupValidationError)
  })
})

describe('planRestore — additive, independent-by-collection, self-de-duplicating', () => {
  function payloadOf(entries: Entry[], flows: Flow[]): BackupPayload {
    return {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      createdAt: 'x',
      appVersion: '1.0.0',
      entryCount: entries.length,
      flowCount: flows.length,
      entries,
      flows,
    }
  }

  const entry = (id: string, userId: string | null = 'me'): Entry => ({
    id,
    entryDate: '2026-04-10',
    lastModified: '2026-04-10T12:00:00.000Z',
    user_id: userId,
    local_session_id: 'session-1',
  })

  it('skips ids already present and inserts new ones, with correct skip counts', () => {
    const payload = payloadOf(
      [entry('e1'), entry('e2')],
      [flow('f1', 'e1', 'me'), flow('f2', 'e2', 'me')]
    )
    const plan = planRestore(payload, new Set(['e1']), new Set(['f1']))
    expect(plan.entriesToInsert.map((e) => e.id)).toEqual(['e2'])
    expect(plan.flowsToInsert.map((f) => f.id)).toEqual(['f2'])
    expect(plan.entriesSkipped).toBe(1)
    expect(plan.flowsSkipped).toBe(1)
  })

  it('keys entries and flows independently — an existing entry with a new flow inserts only the flow', () => {
    const payload = payloadOf([entry('e1')], [flow('f-old', 'e1', 'me'), flow('f-new', 'e1', 'me')])
    const plan = planRestore(payload, new Set(['e1']), new Set(['f-old']))
    expect(plan.entriesToInsert).toEqual([])
    expect(plan.entriesSkipped).toBe(1)
    expect(plan.flowsToInsert.map((f) => f.id)).toEqual(['f-new'])
    expect(plan.flowsToInsert[0]!.dailyEntryId).toBe('e1')
  })

  it('collapses ids duplicated within the payload (first occurrence wins, no inflated counts)', () => {
    const payload = payloadOf(
      [entry('e1'), entry('e1')],
      [flow('f1', 'e1', 'me'), flow('f1', 'e1', 'me')]
    )
    const plan = planRestore(payload, new Set(), new Set())
    expect(plan.entriesToInsert.map((e) => e.id)).toEqual(['e1'])
    expect(plan.flowsToInsert.map((f) => f.id)).toEqual(['f1'])
    expect(plan.entriesSkipped).toBe(0)
    expect(plan.flowsSkipped).toBe(0)
  })

  it('treats an empty/all-duplicate payload as a valid no-op', () => {
    const plan = planRestore(payloadOf([], []), new Set(['e1']), new Set(['f1']))
    expect(plan.entriesToInsert).toEqual([])
    expect(plan.flowsToInsert).toEqual([])
  })

  it('never mutates ownership fields on the planned inserts', () => {
    const foreign = entry('e-foreign', 'other-user')
    foreign.sync_excluded = false
    const payload = payloadOf([foreign], [])
    const plan = planRestore(payload, new Set(), new Set())
    expect(plan.entriesToInsert[0]!.user_id).toBe('other-user')
    expect(plan.entriesToInsert[0]!.sync_excluded).toBe(false)
  })
})
