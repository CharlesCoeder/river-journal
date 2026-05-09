// @vitest-environment happy-dom
/**
 * useCollectiveEligibility — precedence ladder + RPC-error → loading + transitions.
 */

import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'

let mockCurrentUserId: string | null | undefined = 'user-1'
let mockIsSuspended: boolean | undefined = false
let mockEligibility: {
  data: boolean | undefined
  isLoading: boolean
  isError: boolean
} = { data: true, isLoading: false, isError: false }
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

vi.mock('app/state/collective/suspension', () => ({
  useIsSuspended: (_uid: string | null) => mockIsSuspended,
}))

vi.mock('app/state/collective/eligibility', () => ({
  useEligibleToPost: () => mockEligibility,
}))

import { useCollectiveEligibility, type EligibilityStatus } from '../useCollectiveEligibility'

function probe(): EligibilityStatus {
  let captured: EligibilityStatus = 'loading'
  function Probe() {
    const { status } = useCollectiveEligibility()
    captured = status
    return null
  }
  render(React.createElement(Probe))
  return captured
}

beforeEach(() => {
  mockCurrentUserId = 'user-1'
  mockIsSuspended = false
  mockEligibility = { data: true, isLoading: false, isError: false }
  mockSyncEnabled = true
})

afterEach(() => {
  cleanup()
})

describe('useCollectiveEligibility — precedence ladder', () => {
  it('eligible: all checks pass', () => {
    expect(probe()).toBe('eligible')
  })

  it('loading: currentUserId === undefined', () => {
    mockCurrentUserId = undefined
    expect(probe()).toBe('loading')
  })

  it('unauthenticated: currentUserId === null', () => {
    mockCurrentUserId = null
    expect(probe()).toBe('unauthenticated')
  })

  it('loading: isSuspended === undefined collapses to loading', () => {
    mockIsSuspended = undefined
    expect(probe()).toBe('loading')
  })

  it('suspended: isSuspended === true', () => {
    mockIsSuspended = true
    expect(probe()).toBe('suspended')
  })

  it('suspended takes precedence over sync-disabled', () => {
    mockIsSuspended = true
    mockSyncEnabled = false
    expect(probe()).toBe('suspended')
  })

  it('suspended takes precedence over not-qualified', () => {
    mockIsSuspended = true
    mockEligibility = { data: false, isLoading: false, isError: false }
    expect(probe()).toBe('suspended')
  })

  it('sync-disabled: syncEnabled !== true', () => {
    mockSyncEnabled = false
    expect(probe()).toBe('sync-disabled')
  })

  it('sync-disabled takes precedence over not-qualified', () => {
    mockSyncEnabled = false
    mockEligibility = { data: false, isLoading: false, isError: false }
    expect(probe()).toBe('sync-disabled')
  })

  it('not-qualified: eligibility data === false', () => {
    mockEligibility = { data: false, isLoading: false, isError: false }
    expect(probe()).toBe('not-qualified')
  })

  it('loading: eligibility data === undefined while loading', () => {
    mockEligibility = { data: undefined, isLoading: true, isError: false }
    expect(probe()).toBe('loading')
  })

  it('loading: eligibility-RPC error with no cache collapses to loading (deliberate)', () => {
    // A transport error must NOT degrade actually-eligible users to not-qualified.
    mockEligibility = { data: undefined, isLoading: false, isError: true }
    expect(probe()).toBe('loading')
  })
})

describe('useCollectiveEligibility — transitions', () => {
  it('not-qualified → eligible when RPC flips true', () => {
    mockEligibility = { data: false, isLoading: false, isError: false }
    expect(probe()).toBe('not-qualified')
    cleanup()
    mockEligibility = { data: true, isLoading: false, isError: false }
    expect(probe()).toBe('eligible')
  })

  it('sync-disabled → not-qualified when sync turns on but server says <500', () => {
    mockSyncEnabled = false
    expect(probe()).toBe('sync-disabled')
    cleanup()
    mockSyncEnabled = true
    mockEligibility = { data: false, isLoading: false, isError: false }
    expect(probe()).toBe('not-qualified')
  })

  it('loading → unauthenticated when auth resolves to null', () => {
    mockCurrentUserId = undefined
    expect(probe()).toBe('loading')
    cleanup()
    mockCurrentUserId = null
    expect(probe()).toBe('unauthenticated')
  })
})
