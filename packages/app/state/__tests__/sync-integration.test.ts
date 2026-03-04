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
  },
  configurePersistence: vi.fn(),
}))

import { isSyncReady$, syncUserId$ } from '../syncConfig'
import { flows$ } from '../flows'
import { entries$ } from '../entries'

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
    const testFlow = {
      id: 'test-flow-1',
      dailyEntryId: 'test-entry-1',
      content: 'test content',
      wordCount: 2,
      timestamp: new Date().toISOString(),
      local_session_id: 'test-session',
    }
    
    // Set a local flow
    flows$[testFlow.id].set(testFlow)
    
    // Verify it was set
    const flows = flows$.get()
    expect(flows[testFlow.id]).toEqual(testFlow)
    
    // Clean up
    flows$[testFlow.id].delete()
  })
})
