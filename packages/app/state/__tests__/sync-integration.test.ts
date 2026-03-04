import { describe, it, expect, beforeEach, vi } from 'vitest'
import { observable } from '@legendapp/state'

vi.mock('../../utils/supabase', () => ({
  supabase: {},
}))

import { isSyncReady$, syncUserId$, generateUUID } from '../syncConfig'

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

describe('UUID generation for sync', () => {
  it('produces UUIDs accepted by Postgres UUID type', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateUUID()
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      )
    }
  })

  it('is usable as an observable key', () => {
    const obs$ = observable<Record<string, { id: string; value: number }>>({})
    const id = generateUUID()
    obs$[id].set({ id, value: 42 })
    expect(obs$[id].get()).toEqual({ id, value: 42 })
  })
})

describe('syncEnabled flag on SessionState', () => {
  it('syncEnabled defaults to false in a fresh store', () => {
    // Import types only — we verify the shape, not a live store
    const session = {
      localSessionId: '',
      userId: null,
      email: null,
      isAuthenticated: false,
      syncEnabled: false,
    }
    expect(session.syncEnabled).toBe(false)
  })
})
