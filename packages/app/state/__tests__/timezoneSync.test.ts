import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted refs for the supabase mock chain
const updateMock = vi.fn()
const eqMock = vi.fn()
const fromMock = vi.fn()

vi.mock('../../utils/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

vi.mock('../persistConfig', () => ({
  persistPlugin: {
    getTable: vi.fn(() => ({})),
    setTable: vi.fn(),
    deleteTable: vi.fn(),
  },
  configurePersistence: vi.fn((cfg) => cfg),
}))

import { store$ } from '../store'
import { syncDeviceTimezone } from '../timezoneSync'

const wireSupabaseChain = (response: { error: { message: string } | null }) => {
  eqMock.mockResolvedValue(response)
  updateMock.mockReturnValue({ eq: eqMock })
  fromMock.mockReturnValue({ update: updateMock })
}

describe('syncDeviceTimezone', () => {
  beforeEach(() => {
    fromMock.mockReset()
    updateMock.mockReset()
    eqMock.mockReset()
    store$.session.userId.set('user-abc')
    store$.session.lastSyncedTimezone.set(null)
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () =>
        ({ resolvedOptions: () => ({ timeZone: 'America/New_York' }) }) as unknown as Intl.DateTimeFormat
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('PATCHes users.timezone when device zone differs from cache', async () => {
    wireSupabaseChain({ error: null })

    await syncDeviceTimezone()

    expect(fromMock).toHaveBeenCalledWith('users')
    expect(updateMock).toHaveBeenCalledWith({ timezone: 'America/New_York' })
    expect(eqMock).toHaveBeenCalledWith('id', 'user-abc')
    expect(store$.session.lastSyncedTimezone.peek()).toBe('America/New_York')
  })

  it('is a no-op when the cached zone matches the device zone', async () => {
    store$.session.lastSyncedTimezone.set('America/New_York')
    wireSupabaseChain({ error: null })

    await syncDeviceTimezone()

    expect(fromMock).not.toHaveBeenCalled()
  })

  it('is a no-op when no user is signed in', async () => {
    store$.session.userId.set(null)
    wireSupabaseChain({ error: null })

    await syncDeviceTimezone()

    expect(fromMock).not.toHaveBeenCalled()
  })

  it('does not throw when Intl.DateTimeFormat is unavailable', async () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('Intl unavailable')
    })

    await expect(syncDeviceTimezone()).resolves.toBeUndefined()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('swallows PATCH errors and leaves the cache untouched for retry', async () => {
    wireSupabaseChain({ error: { message: 'network down' } })

    await syncDeviceTimezone()

    expect(updateMock).toHaveBeenCalled()
    expect(store$.session.lastSyncedTimezone.peek()).toBeNull()
  })
})
