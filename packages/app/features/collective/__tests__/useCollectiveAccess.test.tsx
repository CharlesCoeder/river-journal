// @vitest-environment happy-dom
/**
 * useCollectiveAccess — precedence ladder for the feed-mount gate.
 *
 *   loading → unauthenticated → sync-disabled → granted
 *
 * Distinct from useCollectiveEligibility: access does NOT consult suspension or
 * the daily-500 RPC (suspended users still read; sub-500 users see preview).
 */

import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'

let mockCurrentUserId: string | null | undefined = 'user-1'
let mockSyncEnabled = true

vi.mock('@legendapp/state/react', () => ({
  use$: (_obs: unknown) => mockSyncEnabled,
}))

vi.mock('app/state/store', () => ({
  store$: { session: { syncEnabled: { __mockSentinel: true } } },
}))

vi.mock('app/state/collective/currentUser', () => ({
  useCurrentUserId: () => mockCurrentUserId,
}))

import { useCollectiveAccess, type CollectiveAccessStatus } from '../useCollectiveAccess'

function probe(): CollectiveAccessStatus {
  let captured: CollectiveAccessStatus = 'loading'
  function Probe() {
    const { status } = useCollectiveAccess()
    captured = status
    return null
  }
  render(React.createElement(Probe))
  return captured
}

beforeEach(() => {
  mockCurrentUserId = 'user-1'
  mockSyncEnabled = true
})

afterEach(() => {
  cleanup()
})

describe('useCollectiveAccess — precedence ladder', () => {
  it('granted: signed in + sync on', () => {
    expect(probe()).toBe('granted')
  })

  it('loading: currentUserId === undefined', () => {
    mockCurrentUserId = undefined
    expect(probe()).toBe('loading')
  })

  it('loading takes precedence over sync state', () => {
    mockCurrentUserId = undefined
    mockSyncEnabled = false
    expect(probe()).toBe('loading')
  })

  it('unauthenticated: currentUserId === null', () => {
    mockCurrentUserId = null
    expect(probe()).toBe('unauthenticated')
  })

  it('unauthenticated takes precedence over sync state', () => {
    mockCurrentUserId = null
    mockSyncEnabled = false
    expect(probe()).toBe('unauthenticated')
  })

  it('sync-disabled: signed in but syncEnabled !== true', () => {
    mockSyncEnabled = false
    expect(probe()).toBe('sync-disabled')
  })
})

describe('useCollectiveAccess — transitions', () => {
  it('loading → unauthenticated when auth resolves to null', () => {
    mockCurrentUserId = undefined
    expect(probe()).toBe('loading')
    cleanup()
    mockCurrentUserId = null
    expect(probe()).toBe('unauthenticated')
  })

  it('sync-disabled → granted when sync turns on', () => {
    mockSyncEnabled = false
    expect(probe()).toBe('sync-disabled')
    cleanup()
    mockSyncEnabled = true
    expect(probe()).toBe('granted')
  })
})
