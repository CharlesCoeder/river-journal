import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Supabase client to prevent network requests during tests
vi.mock('../../utils/supabase', () => {
  return {
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      })),
    },
  }
})

// Mock persistence to avoid IDB/MMKV issues in Node
vi.mock('../persistConfig', () => ({
  persistPlugin: {
    getTable: vi.fn(() => ({})),
    setTable: vi.fn(),
    deleteTable: vi.fn(),
    getMetadata: vi.fn(),
    setMetadata: vi.fn(),
    deleteMetadata: vi.fn(),
    loadTable: vi.fn(),
    saveTable: vi.fn(),
    set: vi.fn(),
  },
  configurePersistence: vi.fn(),
}))

import { isSyncReady$, syncUserId$, orphanFlowsPending$, deviceState$ } from '../syncConfig'
import { flows$ } from '../flows'
import { entries$ } from '../entries'
import { graceDays$ } from '../grace_days'
import { store$ } from '../store'

// ---------------------------------------------------------------------------
// Shared test data helpers
// ---------------------------------------------------------------------------

const makeEntry = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  entryDate: '2026-03-05',
  lastModified: new Date().toISOString(),
  user_id: null as string | null,
  local_session_id: 'sess-1',
  ...overrides,
})

const makeFlow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  dailyEntryId: 'entry-1',
  content: 'hello world',
  wordCount: 2,
  timestamp: new Date().toISOString(),
  local_session_id: 'sess-1',
  user_id: null as string | null,
  ...overrides,
})

// ---------------------------------------------------------------------------
// Sync readiness gate
// ---------------------------------------------------------------------------

describe('Sync readiness gate', () => {
  beforeEach(() => {
    isSyncReady$.set(false)
    syncUserId$.set(null)
  })

  it('defaults to false', () => {
    expect(isSyncReady$.get()).toBe(false)
  })

  it('can be toggled to true', () => {
    isSyncReady$.set(true)
    expect(isSyncReady$.get()).toBe(true)
  })

  it('syncUserId$ defaults to null', () => {
    expect(syncUserId$.get()).toBeNull()
  })

  it('syncUserId$ holds a user ID', () => {
    syncUserId$.set('user-abc-123')
    expect(syncUserId$.get()).toBe('user-abc-123')
  })
})

// ---------------------------------------------------------------------------
// Synced observables initialization
// ---------------------------------------------------------------------------

describe('Synced Observables Initialization', () => {
  it('flows$ initializes as an observable object', () => {
    const flows = flows$.get()
    expect(typeof flows).toBe('object')
  })

  it('entries$ initializes as an observable object', () => {
    const entries = entries$.get()
    expect(typeof entries).toBe('object')
  })

  it('allows local mutations on flows$', () => {
    const testFlow = makeFlow('test-flow-1')

    flows$![testFlow.id]!.set(testFlow)

    const flows = flows$.get()
    expect(flows[testFlow.id]).toEqual(testFlow)

    flows$![testFlow.id]!.delete()
  })
})

// ---------------------------------------------------------------------------
// adoptOrphanFlows
// ---------------------------------------------------------------------------

describe('adoptOrphanFlows', () => {
  let adoptOrphanFlows: (userId: string) => void

  beforeEach(async () => {
    const storeModule = await import('../store')
    adoptOrphanFlows = storeModule.adoptOrphanFlows

    flows$.set({})
    entries$.set({})
  })

  it('stamps user_id on entries with null user_id', () => {
    entries$!['entry-1']!.set(makeEntry('entry-1'))
    adoptOrphanFlows('user-123')
    expect(entries$!['entry-1']!.user_id.get()).toBe('user-123')
  })

  it('stamps user_id on flows with null user_id', () => {
    flows$!['flow-1']!.set(makeFlow('flow-1'))
    adoptOrphanFlows('user-123')
    expect(flows$!['flow-1']!.user_id.get()).toBe('user-123')
  })

  it('skips entries and flows that already have a user_id', () => {
    entries$!['entry-1']!.set(makeEntry('entry-1', { user_id: 'other-user' }))
    flows$!['flow-1']!.set(makeFlow('flow-1', { user_id: 'other-user' }))

    adoptOrphanFlows('user-123')

    expect(entries$!['entry-1']!.user_id.get()).toBe('other-user')
    expect(flows$!['flow-1']!.user_id.get()).toBe('other-user')
  })

  it('skips entries and flows with sync_excluded: true (AC #4)', () => {
    entries$!['entry-excluded']!.set(makeEntry('entry-excluded', { sync_excluded: true }))
    flows$!['flow-excluded']!.set(makeFlow('flow-excluded', { sync_excluded: true }))

    adoptOrphanFlows('user-123')

    // sync_excluded items must NOT get a user_id stamped
    expect(entries$!['entry-excluded']!.user_id.get()).toBeNull()
    expect(flows$!['flow-excluded']!.user_id.get()).toBeNull()
  })

  it('is a no-op when no orphans exist', () => {
    entries$!['entry-1']!.set(makeEntry('entry-1', { user_id: 'user-123' }))
    adoptOrphanFlows('user-123')
    expect(entries$!['entry-1']!.user_id.get()).toBe('user-123')
  })
})

// ---------------------------------------------------------------------------
// countUndecidedOrphans
// ---------------------------------------------------------------------------

describe('countUndecidedOrphans', () => {
  let countUndecidedOrphans: () => { flowCount: number; entryCount: number }

  beforeEach(async () => {
    const storeModule = await import('../store')
    countUndecidedOrphans = storeModule.countUndecidedOrphans
    flows$.set({})
    entries$.set({})
  })

  it('returns zero when no data exists', () => {
    const result = countUndecidedOrphans()
    expect(result).toEqual({ flowCount: 0, entryCount: 0 })
  })

  it('counts entries and flows without user_id or sync_excluded (AC #1)', () => {
    entries$!['e1']!.set(makeEntry('e1'))
    entries$!['e2']!.set(makeEntry('e2'))
    flows$!['f1']!.set(makeFlow('f1'))

    const result = countUndecidedOrphans()
    expect(result).toEqual({ flowCount: 1, entryCount: 2 })
  })

  it('ignores entries/flows that have user_id', () => {
    entries$!['e1']!.set(makeEntry('e1', { user_id: 'user-123' }))
    flows$!['f1']!.set(makeFlow('f1', { user_id: 'user-123' }))

    const result = countUndecidedOrphans()
    expect(result).toEqual({ flowCount: 0, entryCount: 0 })
  })

  it('ignores entries/flows with sync_excluded: true (AC #4)', () => {
    entries$!['e1']!.set(makeEntry('e1', { sync_excluded: true }))
    flows$!['f1']!.set(makeFlow('f1', { sync_excluded: true }))

    const result = countUndecidedOrphans()
    expect(result).toEqual({ flowCount: 0, entryCount: 0 })
  })

  it('counts only undecided orphans when mixed data present (AC #8)', () => {
    entries$!['e-decided']!.set(makeEntry('e-decided', { sync_excluded: true }))
    entries$!['e-new']!.set(makeEntry('e-new'))
    flows$!['f-new']!.set(makeFlow('f-new'))

    const result = countUndecidedOrphans()
    expect(result).toEqual({ flowCount: 1, entryCount: 1 })
  })

  it('does NOT count flows downloaded from Supabase (local_session_id: "")', () => {
    // dbFlowToLocal() sets local_session_id: '' for all Supabase-downloaded flows.
    // These are already in the cloud and must not trigger the consent dialog.
    flows$!['f-from-supabase-1']!.set(makeFlow('f-from-supabase-1', { local_session_id: '' }))
    flows$!['f-from-supabase-2']!.set(makeFlow('f-from-supabase-2', { local_session_id: '' }))
    entries$!['e-from-supabase']!.set(makeEntry('e-from-supabase', { local_session_id: '', user_id: 'user-123' }))
    // One real local orphan
    flows$!['f-local']!.set(makeFlow('f-local'))

    const result = countUndecidedOrphans()
    expect(result).toEqual({ flowCount: 1, entryCount: 0 })
  })
})

// ---------------------------------------------------------------------------
// excludeOrphanFlows
// ---------------------------------------------------------------------------

describe('excludeOrphanFlows', () => {
  let excludeOrphanFlows: () => void

  beforeEach(async () => {
    const storeModule = await import('../store')
    excludeOrphanFlows = storeModule.excludeOrphanFlows
    flows$.set({})
    entries$.set({})
  })

  it('sets sync_excluded: true on all undecided orphan entries and flows (AC #3)', () => {
    entries$!['e1']!.set(makeEntry('e1'))
    flows$!['f1']!.set(makeFlow('f1'))

    excludeOrphanFlows()

    expect(entries$!['e1']!.sync_excluded.get()).toBe(true)
    expect(flows$!['f1']!.sync_excluded.get()).toBe(true)
    // user_id must remain null
    expect(entries$!['e1']!.user_id.get()).toBeNull()
    expect(flows$!['f1']!.user_id.get()).toBeNull()
  })

  it('skips already-excluded items (AC #4)', () => {
    entries$!['e-excluded']!.set(makeEntry('e-excluded', { sync_excluded: true }))
    flows$!['f-excluded']!.set(makeFlow('f-excluded', { sync_excluded: true }))

    excludeOrphanFlows()

    // Should remain excluded (no change, no error)
    expect(entries$!['e-excluded']!.sync_excluded.get()).toBe(true)
    expect(flows$!['f-excluded']!.sync_excluded.get()).toBe(true)
  })

  it('skips items that already have a user_id', () => {
    entries$!['e-synced']!.set(makeEntry('e-synced', { user_id: 'user-123' }))
    flows$!['f-synced']!.set(makeFlow('f-synced', { user_id: 'user-123' }))

    excludeOrphanFlows()

    expect(entries$!['e-synced']!.sync_excluded.get()).toBeUndefined()
    expect(flows$!['f-synced']!.sync_excluded.get()).toBeUndefined()
  })

  it('does NOT mark Supabase-downloaded flows as sync_excluded (local_session_id: "")', () => {
    // Flows downloaded from Supabase via dbFlowToLocal() have local_session_id: ''.
    // They're already in the cloud — marking them sync_excluded would be wrong.
    flows$!['f-from-supabase']!.set(makeFlow('f-from-supabase', { local_session_id: '' }))
    entries$!['e-from-supabase']!.set(
      makeEntry('e-from-supabase', { local_session_id: '', user_id: 'user-123' })
    )

    excludeOrphanFlows()

    expect(flows$!['f-from-supabase']!.sync_excluded.get()).toBeUndefined()
    expect(entries$!['e-from-supabase']!.sync_excluded.get()).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// orphan-flow under adopted parent entry (logout-window regression)
//
// Repro: user is logged in, today's entry is stamped with user_id. User signs
// out. signOut() does NOT clearUserData (only different-user signin does), so
// the entry retains its user_id. User writes a new flow while signed out — the
// flow inherits user_id: null but its dailyEntryId points at the existing
// (adopted) entry. On re-login, the flow must be detected as an undecided
// orphan independently of the parent entry's adoption state, otherwise it
// stays at user_id: null forever (transform.save returns undefined → no
// upload) and is never sync_excluded (Settings recovery row never surfaces).
// ---------------------------------------------------------------------------

describe('orphan-flow under adopted parent entry (logout-window regression)', () => {
  let countUndecidedOrphans: () => { flowCount: number; entryCount: number }
  let excludeOrphanFlows: () => void
  let resolveOrphanFlows: (adopt: boolean) => void
  let getLocallyExcludedEntries: () => Array<{
    entryId: string
    entryDate: string
    totalWordCount: number
    flowIds: string[]
  }>

  beforeEach(async () => {
    const storeModule = await import('../store')
    countUndecidedOrphans = storeModule.countUndecidedOrphans
    excludeOrphanFlows = storeModule.excludeOrphanFlows
    resolveOrphanFlows = storeModule.resolveOrphanFlows
    getLocallyExcludedEntries = storeModule.getLocallyExcludedEntries
    flows$.set({})
    entries$.set({})
    isSyncReady$.set(false)
    orphanFlowsPending$.set(null)
  })

  // The shared scenario builder: an adopted parent entry with a logged-out
  // flow written under it.
  const seedLogoutWindowState = () => {
    entries$!['e-today']!.set(makeEntry('e-today', { user_id: 'user-123' }))
    flows$!['f-logged-out']!.set(
      makeFlow('f-logged-out', { dailyEntryId: 'e-today' })
      // makeFlow defaults: user_id: null, sync_excluded: undefined,
      // local_session_id: 'sess-1' — exactly the logout-window shape.
    )
  }

  it('countUndecidedOrphans reports the flow as orphan even though parent entry is adopted', () => {
    seedLogoutWindowState()
    expect(countUndecidedOrphans()).toEqual({ flowCount: 1, entryCount: 0 })
  })

  it('resolveOrphanFlows(true) stamps user_id on the flow without touching the parent entry', () => {
    seedLogoutWindowState()
    orphanFlowsPending$.set({ flowCount: 1, entryCount: 0, userId: 'user-123' })

    resolveOrphanFlows(true)

    expect(flows$!['f-logged-out']!.user_id.get()).toBe('user-123')
    // Parent entry was already adopted — must remain so.
    expect(entries$!['e-today']!.user_id.get()).toBe('user-123')
    expect(entries$!['e-today']!.sync_excluded.get()).toBeUndefined()
    expect(isSyncReady$.get()).toBe(true)
  })

  it('resolveOrphanFlows(false) marks the flow sync_excluded but leaves the adopted parent entry alone', () => {
    seedLogoutWindowState()
    orphanFlowsPending$.set({ flowCount: 1, entryCount: 0, userId: 'user-123' })

    resolveOrphanFlows(false)

    expect(flows$!['f-logged-out']!.sync_excluded.get()).toBe(true)
    expect(flows$!['f-logged-out']!.user_id.get()).toBeNull()
    // Entry must NOT be excluded — it has other legitimately synced flows
    // (the per-entry summary row in Settings is enough to surface recovery).
    expect(entries$!['e-today']!.sync_excluded.get()).toBeUndefined()
    expect(entries$!['e-today']!.user_id.get()).toBe('user-123')
    expect(isSyncReady$.get()).toBe(true)
  })

  it('excludeOrphanFlows directly: flow gets sync_excluded, parent entry untouched', () => {
    seedLogoutWindowState()

    excludeOrphanFlows()

    expect(flows$!['f-logged-out']!.sync_excluded.get()).toBe(true)
    expect(entries$!['e-today']!.sync_excluded.get()).toBeUndefined()
  })

  it('Settings recovery surface picks up the parent entry once the flow is excluded', () => {
    seedLogoutWindowState()
    excludeOrphanFlows()

    const summaries = getLocallyExcludedEntries()
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.entryId).toBe('e-today')
    expect(summaries[0]!.flowIds).toEqual(['f-logged-out'])
  })

  // I/O Matrix scenario #4: cloud-downloaded ghost flow (local_session_id: '')
  // is invariant for the whole orphan logic. Pinned alongside the
  // logout-window cases so the symmetry — same predicate in count + exclude —
  // is visible in one block.
  it('cloud-downloaded ghost flow (local_session_id: "") is neither counted nor excluded', () => {
    flows$!['f-ghost']!.set(makeFlow('f-ghost', { local_session_id: '' }))
    entries$!['e-ghost']!.set(
      makeEntry('e-ghost', { local_session_id: '', user_id: 'user-123' })
    )

    expect(countUndecidedOrphans()).toEqual({ flowCount: 0, entryCount: 0 })

    excludeOrphanFlows()
    expect(flows$!['f-ghost']!.sync_excluded.get()).toBeUndefined()
    expect(entries$!['e-ghost']!.sync_excluded.get()).toBeUndefined()
  })

  // I/O Matrix scenario #5: fully anonymous (pre-login) flow under anonymous
  // entry — both should still be counted and excluded together via their
  // respective predicates. Confirms the entry-level path is preserved.
  it('fully anonymous flow under anonymous entry: both counted; both excluded together', () => {
    entries$!['e-anon']!.set(makeEntry('e-anon'))
    flows$!['f-anon']!.set(makeFlow('f-anon', { dailyEntryId: 'e-anon' }))

    expect(countUndecidedOrphans()).toEqual({ flowCount: 1, entryCount: 1 })

    excludeOrphanFlows()
    expect(entries$!['e-anon']!.sync_excluded.get()).toBe(true)
    expect(flows$!['f-anon']!.sync_excluded.get()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// resolveOrphanFlows
// ---------------------------------------------------------------------------

describe('resolveOrphanFlows', () => {
  let resolveOrphanFlows: (adopt: boolean) => void

  beforeEach(async () => {
    const storeModule = await import('../store')
    resolveOrphanFlows = storeModule.resolveOrphanFlows
    flows$.set({})
    entries$.set({})
    isSyncReady$.set(false)
    orphanFlowsPending$.set(null)
  })

  it('is a no-op when orphanFlowsPending$ is null', () => {
    resolveOrphanFlows(true)
    expect(isSyncReady$.get()).toBe(false)
  })

  it('adopt=true: stamps user_id, clears pending, opens sync gate (AC #2)', () => {
    orphanFlowsPending$.set({ flowCount: 1, entryCount: 1, userId: 'user-123' })
    entries$!['e1']!.set(makeEntry('e1'))
    flows$!['f1']!.set(makeFlow('f1'))

    resolveOrphanFlows(true)

    expect(entries$!['e1']!.user_id.get()).toBe('user-123')
    expect(flows$!['f1']!.user_id.get()).toBe('user-123')
    expect(orphanFlowsPending$.get()).toBeNull()
    expect(isSyncReady$.get()).toBe(true)
  })

  it('adopt=false: marks sync_excluded, clears pending, opens sync gate (AC #3)', () => {
    orphanFlowsPending$.set({ flowCount: 1, entryCount: 1, userId: 'user-123' })
    entries$!['e1']!.set(makeEntry('e1'))
    flows$!['f1']!.set(makeFlow('f1'))

    resolveOrphanFlows(false)

    expect(entries$!['e1']!.sync_excluded.get()).toBe(true)
    expect(entries$!['e1']!.user_id.get()).toBeNull()
    expect(flows$!['f1']!.sync_excluded.get()).toBe(true)
    expect(flows$!['f1']!.user_id.get()).toBeNull()
    expect(orphanFlowsPending$.get()).toBeNull()
    expect(isSyncReady$.get()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// restoreExcludedEntries — local-only entries recovery
// ---------------------------------------------------------------------------

describe('restoreExcludedEntries', () => {
  let restoreExcludedEntries: (entryIds: string[], userId: string) => void
  let getLocallyExcludedEntries: () => Array<{
    entryId: string
    entryDate: string
    totalWordCount: number
    flowIds: string[]
  }>
  let countLocallyExcludedEntries: () => number

  beforeEach(async () => {
    const storeModule = await import('../store')
    restoreExcludedEntries = storeModule.restoreExcludedEntries
    getLocallyExcludedEntries = storeModule.getLocallyExcludedEntries
    countLocallyExcludedEntries = storeModule.countLocallyExcludedEntries
    flows$.set({})
    entries$.set({})
  })

  it('clears sync_excluded and stamps user_id on entry and its flows', () => {
    entries$!['e1']!.set(makeEntry('e1', { sync_excluded: true }))
    flows$!['f1']!.set(makeFlow('f1', { dailyEntryId: 'e1', sync_excluded: true }))
    flows$!['f2']!.set(makeFlow('f2', { dailyEntryId: 'e1', sync_excluded: true }))

    restoreExcludedEntries(['e1'], 'user-123')

    expect(entries$!['e1']!.sync_excluded.get()).toBe(false)
    expect(entries$!['e1']!.user_id.get()).toBe('user-123')
    expect(flows$!['f1']!.sync_excluded.get()).toBe(false)
    expect(flows$!['f1']!.user_id.get()).toBe('user-123')
    expect(flows$!['f2']!.sync_excluded.get()).toBe(false)
    expect(flows$!['f2']!.user_id.get()).toBe('user-123')
  })

  it('only restores entries listed in entryIds; leaves others excluded', () => {
    entries$!['e1']!.set(makeEntry('e1', { sync_excluded: true }))
    entries$!['e2']!.set(makeEntry('e2', { sync_excluded: true }))
    flows$!['f1']!.set(makeFlow('f1', { dailyEntryId: 'e1', sync_excluded: true }))
    flows$!['f2']!.set(makeFlow('f2', { dailyEntryId: 'e2', sync_excluded: true }))

    restoreExcludedEntries(['e1'], 'user-123')

    expect(entries$!['e1']!.sync_excluded.get()).toBe(false)
    expect(flows$!['f1']!.sync_excluded.get()).toBe(false)
    // e2 untouched
    expect(entries$!['e2']!.sync_excluded.get()).toBe(true)
    expect(flows$!['f2']!.sync_excluded.get()).toBe(true)
    expect(flows$!['f2']!.user_id.get()).toBeNull()
  })

  it('is a no-op on empty input', () => {
    entries$!['e1']!.set(makeEntry('e1', { sync_excluded: true }))
    flows$!['f1']!.set(makeFlow('f1', { dailyEntryId: 'e1', sync_excluded: true }))

    restoreExcludedEntries([], 'user-123')

    expect(entries$!['e1']!.sync_excluded.get()).toBe(true)
    expect(flows$!['f1']!.sync_excluded.get()).toBe(true)
  })

  it('is a no-op when userId is empty', () => {
    entries$!['e1']!.set(makeEntry('e1', { sync_excluded: true }))
    flows$!['f1']!.set(makeFlow('f1', { dailyEntryId: 'e1', sync_excluded: true }))

    restoreExcludedEntries(['e1'], '')

    expect(entries$!['e1']!.sync_excluded.get()).toBe(true)
    expect(flows$!['f1']!.user_id.get()).toBeNull()
  })

  it('multi-entry call uses a single batch (subscriber fires once)', () => {
    entries$!['e1']!.set(makeEntry('e1', { sync_excluded: true }))
    entries$!['e2']!.set(makeEntry('e2', { sync_excluded: true }))
    flows$!['f1']!.set(makeFlow('f1', { dailyEntryId: 'e1', sync_excluded: true }))
    flows$!['f2']!.set(makeFlow('f2', { dailyEntryId: 'e2', sync_excluded: true }))

    const flowSubscriber = vi.fn()
    const unsub = flows$.onChange(flowSubscriber)

    restoreExcludedEntries(['e1', 'e2'], 'user-123')

    expect(flowSubscriber).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('getLocallyExcludedEntries groups flows by entry and sums word counts', () => {
    entries$!['e1']!.set(makeEntry('e1', { sync_excluded: true, entryDate: '2026-03-01' }))
    entries$!['e2']!.set(makeEntry('e2', { sync_excluded: true, entryDate: '2026-03-05' }))
    flows$!['f1']!.set(
      makeFlow('f1', { dailyEntryId: 'e1', sync_excluded: true, wordCount: 100 })
    )
    flows$!['f2']!.set(
      makeFlow('f2', { dailyEntryId: 'e1', sync_excluded: true, wordCount: 200 })
    )
    flows$!['f3']!.set(
      makeFlow('f3', { dailyEntryId: 'e2', sync_excluded: true, wordCount: 50 })
    )

    const summaries = getLocallyExcludedEntries()

    expect(summaries).toHaveLength(2)
    // Sorted desc by entryDate
    expect(summaries[0]!.entryId).toBe('e2')
    expect(summaries[1]!.entryId).toBe('e1')
    expect(summaries[1]!.totalWordCount).toBe(300)
    expect(summaries[1]!.flowIds.sort()).toEqual(['f1', 'f2'])
  })

  it('getLocallyExcludedEntries skips flows whose parent entry was deleted', () => {
    flows$!['f-orphan']!.set(
      makeFlow('f-orphan', { dailyEntryId: 'missing', sync_excluded: true })
    )
    expect(getLocallyExcludedEntries()).toHaveLength(0)
  })

  it('countLocallyExcludedEntries returns the number of distinct affected entries', () => {
    entries$!['e1']!.set(makeEntry('e1', { sync_excluded: true }))
    entries$!['e2']!.set(makeEntry('e2', { sync_excluded: true }))
    flows$!['f1']!.set(makeFlow('f1', { dailyEntryId: 'e1', sync_excluded: true }))
    flows$!['f2']!.set(makeFlow('f2', { dailyEntryId: 'e1', sync_excluded: true }))
    flows$!['f3']!.set(makeFlow('f3', { dailyEntryId: 'e2', sync_excluded: true }))

    expect(countLocallyExcludedEntries()).toBe(2)
  })

  it('countLocallyExcludedEntries is zero when no flows are excluded', () => {
    flows$!['f1']!.set(makeFlow('f1', { user_id: 'user-123' }))
    entries$!['e1']!.set(makeEntry('e1', { user_id: 'user-123' }))
    expect(countLocallyExcludedEntries()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// clearUserData — sync_excluded preservation
// ---------------------------------------------------------------------------

describe('clearUserData', () => {
  let clearUserData: () => void

  beforeEach(async () => {
    const storeModule = await import('../store')
    clearUserData = storeModule.clearUserData
    flows$.set({})
    entries$.set({})
  })

  it('preserves sync_excluded flows and entries on logout (AC #7)', () => {
    entries$!['e-excluded']!.set(makeEntry('e-excluded', { sync_excluded: true }))
    flows$!['f-excluded']!.set(makeFlow('f-excluded', { sync_excluded: true }))
    entries$!['e-synced']!.set(makeEntry('e-synced', { user_id: 'user-123' }))
    flows$!['f-synced']!.set(makeFlow('f-synced', { user_id: 'user-123' }))

    clearUserData()

    const remainingFlows = flows$.get()
    const remainingEntries = entries$.get()

    expect(remainingFlows['f-excluded']).toBeDefined()
    expect(remainingFlows['f-excluded']?.sync_excluded).toBe(true)
    expect(remainingEntries['e-excluded']).toBeDefined()
    expect(remainingEntries['e-excluded']?.sync_excluded).toBe(true)
    // Synced items should be cleared
    expect(remainingFlows['f-synced']).toBeUndefined()
    expect(remainingEntries['e-synced']).toBeUndefined()
  })

  it('clears all data when nothing is sync_excluded', () => {
    entries$!['e1']!.set(makeEntry('e1', { user_id: 'user-123' }))
    flows$!['f1']!.set(makeFlow('f1', { user_id: 'user-123' }))

    clearUserData()

    expect(Object.keys(flows$.get() ?? {})).toHaveLength(0)
    expect(Object.keys(entries$.get() ?? {})).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Integration: sync gate stays closed while orphanFlowsPending$ is set (AC #1)
// ---------------------------------------------------------------------------

describe('Integration: sync gate with orphan pending state', () => {
  beforeEach(() => {
    isSyncReady$.set(false)
    orphanFlowsPending$.set(null)
  })

  it('sync gate stays closed while orphanFlowsPending$ is non-null (AC #1)', () => {
    orphanFlowsPending$.set({ flowCount: 2, entryCount: 1, userId: 'user-123' })
    // Gate must not open while pending
    expect(isSyncReady$.get()).toBe(false)
  })

  it('no dialog when all flows have user_id — orphanFlowsPending$ stays null (AC #6)', async () => {
    flows$.set({})
    entries$.set({})

    const storeModule = await import('../store')
    const { countUndecidedOrphans } = storeModule

    entries$!['e1']!.set(makeEntry('e1', { user_id: 'user-123' }))
    flows$!['f1']!.set(makeFlow('f1', { user_id: 'user-123' }))

    const { flowCount, entryCount } = countUndecidedOrphans()
    expect(flowCount).toBe(0)
    expect(entryCount).toBe(0)
    // In the actual gate, no orphans → orphanFlowsPending$ stays null
    expect(orphanFlowsPending$.get()).toBeNull()
  })

  it('no dialog when all flows have sync_excluded — orphanFlowsPending$ stays null (AC #6)', async () => {
    flows$.set({})
    entries$.set({})

    const storeModule = await import('../store')
    const { countUndecidedOrphans } = storeModule

    entries$!['e1']!.set(makeEntry('e1', { sync_excluded: true }))
    flows$!['f1']!.set(makeFlow('f1', { sync_excluded: true }))

    const { flowCount, entryCount } = countUndecidedOrphans()
    expect(flowCount).toBe(0)
    expect(entryCount).toBe(0)
    expect(orphanFlowsPending$.get()).toBeNull()
  })

  it('fresh orphans after a previous decline trigger new dialog (AC #8)', async () => {
    flows$.set({})
    entries$.set({})

    const storeModule = await import('../store')
    const { countUndecidedOrphans } = storeModule

    // Previous decline: entries/flows are sync_excluded
    entries$!['e-old']!.set(makeEntry('e-old', { sync_excluded: true }))
    flows$!['f-old']!.set(makeFlow('f-old', { sync_excluded: true }))

    // New flows created after decline (no sync_excluded, no user_id)
    entries$!['e-new']!.set(makeEntry('e-new'))
    flows$!['f-new']!.set(makeFlow('f-new'))

    const { flowCount, entryCount } = countUndecidedOrphans()
    // Only new undecided orphans counted
    expect(flowCount).toBe(1)
    expect(entryCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// clearUserData ghost deletion prevention
// ---------------------------------------------------------------------------

describe('clearUserData ghost deletion prevention', () => {
  let clearUserData: () => void

  beforeEach(async () => {
    const storeModule = await import('../store')
    clearUserData = storeModule.clearUserData
    flows$.set({})
    entries$.set({})
  })

  it('strips user_id before removing synced items to prevent ghost sync deletes', () => {
    entries$!['e-synced']!.set(makeEntry('e-synced', { user_id: 'user-123' }))
    flows$!['f-synced']!.set(makeFlow('f-synced', { user_id: 'user-123' }))

    clearUserData()

    expect(flows$.get()['f-synced']).toBeUndefined()
    expect(entries$.get()['e-synced']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// resolveOrphanFlows — error resilience
// ---------------------------------------------------------------------------

describe('resolveOrphanFlows error handling', () => {
  let resolveOrphanFlows: (adopt: boolean, overrides?: { adoptFn?: (userId: string) => void; excludeFn?: () => void }) => void

  beforeEach(async () => {
    const storeModule = await import('../store')
    resolveOrphanFlows = storeModule.resolveOrphanFlows
    flows$.set({})
    entries$.set({})
    isSyncReady$.set(false)
    orphanFlowsPending$.set(null)
  })

  it('clears pending state and opens sync gate even if adoption throws', () => {
    orphanFlowsPending$.set({ flowCount: 1, entryCount: 1, userId: 'user-123' })

    const throwingAdopt = () => { throw new Error('simulated failure') }
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    resolveOrphanFlows(true, { adoptFn: throwingAdopt })

    expect(orphanFlowsPending$.get()).toBeNull()
    expect(isSyncReady$.get()).toBe(true)
    expect(consoleSpy).toHaveBeenCalledWith(
      '[resolveOrphanFlows] Failed to resolve orphans:',
      expect.any(Error)
    )

    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Cross-user data defense — restoreExcludedEntries foreign-row guard
// ---------------------------------------------------------------------------

describe('restoreExcludedEntries — cross-user defense', () => {
  let restoreExcludedEntries: (entryIds: string[], userId: string) => void

  beforeEach(async () => {
    const storeModule = await import('../store')
    restoreExcludedEntries = storeModule.restoreExcludedEntries
    flows$.set({})
    entries$.set({})
  })

  it('refuses to restore an entry owned by a different user (I/O matrix: Restore foreign row)', () => {
    entries$!['e-foreign']!.set(makeEntry('e-foreign', { user_id: 'user-A', sync_excluded: true }))
    flows$!['f-foreign']!.set(
      makeFlow('f-foreign', { dailyEntryId: 'e-foreign', user_id: 'user-A', sync_excluded: true })
    )

    restoreExcludedEntries(['e-foreign'], 'user-B')

    // Entry untouched: still excluded, still owned by A
    expect(entries$!['e-foreign']!.sync_excluded.get()).toBe(true)
    expect(entries$!['e-foreign']!.user_id.get()).toBe('user-A')
    // Flow under foreign-owned parent also untouched
    expect(flows$!['f-foreign']!.sync_excluded.get()).toBe(true)
    expect(flows$!['f-foreign']!.user_id.get()).toBe('user-A')
  })

  it('skips a flow whose PARENT entry is foreign-owned, even if the flow itself has user_id null', () => {
    // Parent entry owned by A; new flow written under it (logout-window shape)
    entries$!['e-A']!.set(makeEntry('e-A', { user_id: 'user-A', sync_excluded: true }))
    flows$!['f-null-under-A']!.set(
      makeFlow('f-null-under-A', { dailyEntryId: 'e-A', sync_excluded: true })
    )

    restoreExcludedEntries(['e-A'], 'user-B')

    // Both untouched — defense covers the flow via parent ownership.
    expect(entries$!['e-A']!.user_id.get()).toBe('user-A')
    expect(flows$!['f-null-under-A']!.user_id.get()).toBeNull()
    expect(flows$!['f-null-under-A']!.sync_excluded.get()).toBe(true)
  })

  it('still restores an anonymous (user_id === null) entry — null is the legitimate adoption path', () => {
    entries$!['e-anon']!.set(makeEntry('e-anon', { sync_excluded: true }))
    flows$!['f-anon']!.set(
      makeFlow('f-anon', { dailyEntryId: 'e-anon', sync_excluded: true })
    )

    restoreExcludedEntries(['e-anon'], 'user-B')

    expect(entries$!['e-anon']!.sync_excluded.get()).toBe(false)
    expect(entries$!['e-anon']!.user_id.get()).toBe('user-B')
    expect(flows$!['f-anon']!.sync_excluded.get()).toBe(false)
    expect(flows$!['f-anon']!.user_id.get()).toBe('user-B')
  })

  it('mixed batch: restores own + anonymous, leaves foreign untouched', () => {
    entries$!['e-own']!.set(makeEntry('e-own', { user_id: 'user-B', sync_excluded: true }))
    entries$!['e-anon']!.set(makeEntry('e-anon', { sync_excluded: true }))
    entries$!['e-foreign']!.set(makeEntry('e-foreign', { user_id: 'user-A', sync_excluded: true }))

    restoreExcludedEntries(['e-own', 'e-anon', 'e-foreign'], 'user-B')

    expect(entries$!['e-own']!.sync_excluded.get()).toBe(false)
    expect(entries$!['e-anon']!.user_id.get()).toBe('user-B')
    expect(entries$!['e-foreign']!.user_id.get()).toBe('user-A')
    expect(entries$!['e-foreign']!.sync_excluded.get()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Cross-user data defense — adoptOrphanFlows foreign-parent guard
// ---------------------------------------------------------------------------

describe('adoptOrphanFlows — foreign-parent defense', () => {
  let adoptOrphanFlows: (userId: string) => void

  beforeEach(async () => {
    const storeModule = await import('../store')
    adoptOrphanFlows = storeModule.adoptOrphanFlows
    flows$.set({})
    entries$.set({})
  })

  it('skips a null-user_id flow whose parent entry is owned by a different user (I/O matrix: Adopt foreign parent)', () => {
    entries$!['e-A']!.set(makeEntry('e-A', { user_id: 'user-A' }))
    flows$!['f-orphan-under-A']!.set(makeFlow('f-orphan-under-A', { dailyEntryId: 'e-A' }))

    adoptOrphanFlows('user-B')

    // Parent untouched, flow remains orphan (no FK/RLS violation will be queued).
    expect(entries$!['e-A']!.user_id.get()).toBe('user-A')
    expect(flows$!['f-orphan-under-A']!.user_id.get()).toBeNull()
  })

  it('still adopts a null-user_id flow whose parent entry is also null (anonymous lineage)', () => {
    entries$!['e-anon']!.set(makeEntry('e-anon'))
    flows$!['f-anon']!.set(makeFlow('f-anon', { dailyEntryId: 'e-anon' }))

    adoptOrphanFlows('user-B')

    expect(entries$!['e-anon']!.user_id.get()).toBe('user-B')
    expect(flows$!['f-anon']!.user_id.get()).toBe('user-B')
  })

  it('still adopts a null-user_id flow whose parent entry is owned by the SAME user (logout-window adoption)', () => {
    entries$!['e-B']!.set(makeEntry('e-B', { user_id: 'user-B' }))
    flows$!['f-orphan-under-B']!.set(makeFlow('f-orphan-under-B', { dailyEntryId: 'e-B' }))

    adoptOrphanFlows('user-B')

    expect(flows$!['f-orphan-under-B']!.user_id.get()).toBe('user-B')
  })
})

// ---------------------------------------------------------------------------
// Cross-user data defense — countPreviousUserData / deletePreviousUserData
// ---------------------------------------------------------------------------

describe('countPreviousUserData / deletePreviousUserData', () => {
  let countPreviousUserData: (userId: string) => { entryCount: number; flowCount: number }
  let deletePreviousUserData: (userId: string) => void

  beforeEach(async () => {
    const storeModule = await import('../store')
    countPreviousUserData = storeModule.countPreviousUserData
    deletePreviousUserData = storeModule.deletePreviousUserData
    flows$.set({})
    entries$.set({})
    graceDays$.set({})
  })

  it('countPreviousUserData returns zero for unknown userId', () => {
    expect(countPreviousUserData('user-A')).toEqual({ entryCount: 0, flowCount: 0 })
  })

  it('countPreviousUserData counts only rows owned by the given userId', () => {
    entries$!['e-A1']!.set(makeEntry('e-A1', { user_id: 'user-A' }))
    entries$!['e-A2']!.set(makeEntry('e-A2', { user_id: 'user-A' }))
    entries$!['e-B']!.set(makeEntry('e-B', { user_id: 'user-B' }))
    entries$!['e-anon']!.set(makeEntry('e-anon'))
    flows$!['f-A']!.set(makeFlow('f-A', { user_id: 'user-A' }))
    flows$!['f-B']!.set(makeFlow('f-B', { user_id: 'user-B' }))

    expect(countPreviousUserData('user-A')).toEqual({ entryCount: 2, flowCount: 1 })
  })

  it('deletePreviousUserData removes only the targeted user\'s rows; leaves current user + anonymous intact', () => {
    entries$!['e-A']!.set(makeEntry('e-A', { user_id: 'user-A' }))
    entries$!['e-B']!.set(makeEntry('e-B', { user_id: 'user-B' }))
    entries$!['e-anon']!.set(makeEntry('e-anon'))
    flows$!['f-A']!.set(makeFlow('f-A', { user_id: 'user-A' }))
    flows$!['f-B']!.set(makeFlow('f-B', { user_id: 'user-B' }))
    flows$!['f-anon']!.set(makeFlow('f-anon'))

    deletePreviousUserData('user-A')

    expect(entries$.get()['e-A']).toBeUndefined()
    expect(flows$.get()['f-A']).toBeUndefined()
    // Other users + anonymous untouched
    expect(entries$.get()['e-B']).toBeDefined()
    expect(entries$.get()['e-anon']).toBeDefined()
    expect(flows$.get()['f-B']).toBeDefined()
    expect(flows$.get()['f-anon']).toBeDefined()
  })

  it('deletePreviousUserData also wipes grace days owned by the targeted user', () => {
    graceDays$!['g-A']!.set({
      id: 'g-A',
      userId: 'user-A',
      earnedAt: '2026-01-01T00:00:00Z',
      earnedForMilestone: 7,
      usedForDate: null,
    })
    graceDays$!['g-B']!.set({
      id: 'g-B',
      userId: 'user-B',
      earnedAt: '2026-01-01T00:00:00Z',
      earnedForMilestone: 7,
      usedForDate: null,
    })

    deletePreviousUserData('user-A')

    expect(graceDays$.get()['g-A']).toBeUndefined()
    expect(graceDays$.get()['g-B']).toBeDefined()
  })

  it('deletePreviousUserData is a no-op when userId is empty', () => {
    entries$!['e-A']!.set(makeEntry('e-A', { user_id: 'user-A' }))
    deletePreviousUserData('')
    expect(entries$.get()['e-A']).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Cross-user data defense — previousAccountBanner$ derivation
// ---------------------------------------------------------------------------

describe('previousAccountBanner$ derivation', () => {
  beforeEach(async () => {
    // Lazy import so the observable is materialized via the same module path.
    await import('../store')
    flows$.set({})
    entries$.set({})
    deviceState$.lastAuthedUserId.set(null)
    deviceState$.acknowledgedAccountTransitions.set({})
    store$.session.userId.set(null)
  })

  it('returns null when no previous user has ever signed in', async () => {
    const { previousAccountBanner$ } = await import('../store')
    store$.session.userId.set('user-B')
    expect(previousAccountBanner$.get() ?? null).toBeNull()
  })

  it('returns null when current user matches the previous user (same-user re-sign-in)', async () => {
    const { previousAccountBanner$ } = await import('../store')
    deviceState$.lastAuthedUserId.set('user-A')
    store$.session.userId.set('user-A')
    entries$!['e-A']!.set(makeEntry('e-A', { user_id: 'user-A' }))
    expect(previousAccountBanner$.get() ?? null).toBeNull()
  })

  it('returns null when no signed-in current user (signed-out)', async () => {
    const { previousAccountBanner$ } = await import('../store')
    deviceState$.lastAuthedUserId.set('user-A')
    store$.session.userId.set(null)
    entries$!['e-A']!.set(makeEntry('e-A', { user_id: 'user-A' }))
    expect(previousAccountBanner$.get() ?? null).toBeNull()
  })

  it('returns null when prev != current but no rows owned by prev remain', async () => {
    const { previousAccountBanner$ } = await import('../store')
    deviceState$.lastAuthedUserId.set('user-A')
    store$.session.userId.set('user-B')
    entries$!['e-B']!.set(makeEntry('e-B', { user_id: 'user-B' }))
    expect(previousAccountBanner$.get() ?? null).toBeNull()
  })

  it('returns banner state with counts when prev != current AND data exists for prev', async () => {
    const { previousAccountBanner$ } = await import('../store')
    deviceState$.lastAuthedUserId.set('user-A')
    store$.session.userId.set('user-B')
    entries$!['e-A1']!.set(makeEntry('e-A1', { user_id: 'user-A' }))
    entries$!['e-A2']!.set(makeEntry('e-A2', { user_id: 'user-A' }))
    flows$!['f-A']!.set(makeFlow('f-A', { user_id: 'user-A' }))

    const banner = previousAccountBanner$.get()
    expect(banner).toEqual({
      previousUserId: 'user-A',
      entryCount: 2,
      flowCount: 1,
      acknowledged: false,
    })
  })

  it('returns null after the (prev → current) transition is acknowledged ("Keep local")', async () => {
    const { previousAccountBanner$ } = await import('../store')
    deviceState$.lastAuthedUserId.set('user-A')
    store$.session.userId.set('user-B')
    entries$!['e-A']!.set(makeEntry('e-A', { user_id: 'user-A' }))

    // Banner visible initially
    expect(previousAccountBanner$.get()).not.toBeNull()

    deviceState$.acknowledgedAccountTransitions['user-A->user-B']!.set(true)

    expect(previousAccountBanner$.get() ?? null).toBeNull()
  })

  it('a different third-account transition (B → C) re-opens the banner even after (A → B) was acknowledged', async () => {
    const { previousAccountBanner$ } = await import('../store')
    // Start from A → B acknowledged + advanced
    deviceState$.lastAuthedUserId.set('user-B')
    deviceState$.acknowledgedAccountTransitions.set({ 'user-A->user-B': true })
    store$.session.userId.set('user-C')
    entries$!['e-B']!.set(makeEntry('e-B', { user_id: 'user-B' }))

    const banner = previousAccountBanner$.get()
    expect(banner).not.toBeNull()
    expect(banner?.previousUserId).toBe('user-B')
  })
})

