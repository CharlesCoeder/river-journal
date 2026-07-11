// @vitest-environment happy-dom
/**
 * useIsAdmin — client-side admin-status projection.
 *
 * Mirrors currentUser.ts's template exactly: getSession() seeds a TanStack
 * Query, onAuthStateChange keeps it fresh across sign-in/out/refresh,
 * staleTime: Infinity. The only difference is the projected value: the
 * caller's `app_metadata.is_admin`, read directly from the JS SDK's session
 * object (this is the UX-only client surface -- distinct from the top-level
 * JWT claim the server reads; see isAdmin.ts's own header comment for that
 * distinction).
 *
 * Coverage:
 *   - undefined while the session query is still loading
 *   - null when there is no session (logged out)
 *   - true only for a session whose app_metadata.is_admin is the strict
 *     boolean `true`
 *   - false for a missing / explicit-false / truthy-but-not-strict-true
 *     app_metadata.is_admin (fail-closed on anything other than `=== true`)
 *   - onAuthStateChange subscribe-on-mount / unsubscribe-on-unmount (no
 *     stacked listeners across repeated mounts)
 *   - a sign-out event flips an already-resolved `true` value back to `null`
 *     while the hook stays mounted (gate re-closes, doesn't go stale)
 *   - module contract: queryKey, staleTime, D7 boundary, app_metadata-only read
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const COLLECTIVE_DIR = path.resolve(__dirname, '..')
const ISADMIN_PATH = path.join(COLLECTIVE_DIR, 'isAdmin.ts')

type AuthChangeCallback = (event: string, session: unknown) => void

const { mockGetSession, mockOnAuthStateChange, mockUnsubscribe, authChangeCallbacks } = vi.hoisted(() => {
  return {
    mockGetSession: vi.fn(),
    mockOnAuthStateChange: vi.fn(),
    mockUnsubscribe: vi.fn(),
    authChangeCallbacks: [] as AuthChangeCallback[],
  }
})

vi.mock('../../../utils/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: (cb: AuthChangeCallback) => {
        authChangeCallbacks.push(cb)
        mockOnAuthStateChange(cb)
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
      },
    },
  },
}))

// eslint-disable-next-line import/first
import { useIsAdmin } from '../isAdmin'

function sessionWithAppMetadata(appMetadata: Record<string, unknown>) {
  return { user: { id: 'user-1', app_metadata: appMetadata } }
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
}

beforeEach(() => {
  mockGetSession.mockReset()
  mockOnAuthStateChange.mockReset()
  mockUnsubscribe.mockReset()
  authChangeCallbacks.length = 0
})

afterEach(() => {
  cleanup()
})

describe('isAdmin.ts — module presence', () => {
  it('exists at the expected path', () => {
    expect(existsSync(ISADMIN_PATH), `isAdmin.ts must exist at ${ISADMIN_PATH}`).toBe(true)
  })
})

describe('useIsAdmin — loading state', () => {
  it('returns undefined before the session query resolves', () => {
    mockGetSession.mockReturnValue(new Promise(() => {})) // never resolves in this test
    const { result } = renderHook(() => useIsAdmin(), { wrapper: makeWrapper() })
    expect(result.current).toBeUndefined()
  })
})

describe('useIsAdmin — resolved states', () => {
  it('resolves to null when there is no session (logged out)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
    const { result } = renderHook(() => useIsAdmin(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current).not.toBeUndefined())
    expect(result.current).toBeNull()
  })

  it('resolves to true when app_metadata.is_admin === true', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithAppMetadata({ is_admin: true }) },
      error: null,
    })
    const { result } = renderHook(() => useIsAdmin(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('resolves to false when app_metadata.is_admin is absent', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithAppMetadata({}) },
      error: null,
    })
    const { result } = renderHook(() => useIsAdmin(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current).not.toBeUndefined())
    expect(result.current).toBe(false)
  })

  it('resolves to false when app_metadata.is_admin is explicitly false', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithAppMetadata({ is_admin: false }) },
      error: null,
    })
    const { result } = renderHook(() => useIsAdmin(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current).not.toBeUndefined())
    expect(result.current).toBe(false)
  })

  it('resolves to false for a truthy-but-not-strict-true string value -- fail closed', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithAppMetadata({ is_admin: 'true' }) },
      error: null,
    })
    const { result } = renderHook(() => useIsAdmin(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current).not.toBeUndefined())
    expect(result.current).toBe(false)
  })

  it('resolves to false for a truthy-but-not-strict-true numeric value (1) -- fail closed', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithAppMetadata({ is_admin: 1 }) },
      error: null,
    })
    const { result } = renderHook(() => useIsAdmin(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current).not.toBeUndefined())
    expect(result.current).toBe(false)
  })
})

describe('useIsAdmin — onAuthStateChange wiring', () => {
  it('subscribes exactly once on mount', () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
    renderHook(() => useIsAdmin(), { wrapper: makeWrapper() })
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes on unmount (no stacked listeners across repeated mounts)', () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
    const { unmount } = renderHook(() => useIsAdmin(), { wrapper: makeWrapper() })
    unmount()
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it('a sign-out event flips an already-true value back to null while still mounted', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithAppMetadata({ is_admin: true }) },
      error: null,
    })
    const { result } = renderHook(() => useIsAdmin(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current).toBe(true))

    expect(authChangeCallbacks).toHaveLength(1)
    authChangeCallbacks[0]!('SIGNED_OUT', null)

    await waitFor(() => expect(result.current).toBeNull())
  })
})

describe('isAdmin.ts — module contract (source-text checks)', () => {
  it('queryKey is ["session", "isAdmin"]', () => {
    expect(existsSync(ISADMIN_PATH)).toBe(true)
    const src = readFileSync(ISADMIN_PATH, 'utf8')
    expect(src).toMatch(/\[\s*['"]session['"]\s*,\s*['"]isAdmin['"]\s*\]/)
  })

  it('staleTime is Infinity', () => {
    expect(existsSync(ISADMIN_PATH)).toBe(true)
    const src = readFileSync(ISADMIN_PATH, 'utf8')
    expect(src).toMatch(/staleTime:\s*Infinity/)
  })

  it('does NOT import @legendapp/state (D7 boundary)', () => {
    expect(existsSync(ISADMIN_PATH)).toBe(true)
    const src = readFileSync(ISADMIN_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state(?:\/[\w-]+(?:\/[\w-]+)?)?/)
  })

  it('projects from app_metadata (never user_metadata, which is user-writable)', () => {
    expect(existsSync(ISADMIN_PATH)).toBe(true)
    const src = readFileSync(ISADMIN_PATH, 'utf8')
    expect(src).toMatch(/app_metadata/)
    expect(src).not.toMatch(/user_metadata/)
  })
})
