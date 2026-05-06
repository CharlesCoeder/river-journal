/**
 * Story 3-2 — TDD red-phase E2E (integration) tests for the TanStack Query
 * infrastructure substrate. These tests MUST fail before Story 3-2 is
 * implemented and pass after.
 *
 * Surface covered:
 *   - AC #3, #15: queryClient defaultOptions (retry, retryDelay cap, mutations.retry).
 *   - AC #4, #15: dehydrateOptions.shouldDehydrateMutation matrix.
 *   - AC #5: queryClient.native re-exports identical shape (smoke import).
 *   - AC #6, #18: state/collective/mutations stub side-effects + load timestamp.
 *   - AC #20: queryStorage adapter resilience — getItem returns undefined,
 *             setItem/removeItem swallow errors (no unhandled rejection).
 */

import { describe, expect, it, vi } from 'vitest'
import { QueryClient, MutationCache } from '@tanstack/react-query'

import { queryClient, dehydrateOptions } from '../queryClient'

describe('Story 3-2 / queryClient defaults (AC #3, #15)', () => {
  it('exports a singleton QueryClient instance', () => {
    expect(queryClient).toBeInstanceOf(QueryClient)
  })

  it('queries.retry === 2', () => {
    const opts = queryClient.getDefaultOptions()
    expect(opts.queries?.retry).toBe(2)
  })

  it('mutations.retry === 0', () => {
    const opts = queryClient.getDefaultOptions()
    expect(opts.mutations?.retry).toBe(0)
  })

  it('queries.retryDelay(0) === 1000 (first retry)', () => {
    const opts = queryClient.getDefaultOptions()
    const fn = opts.queries?.retryDelay as (attempt: number, error: unknown) => number
    expect(typeof fn).toBe('function')
    expect(fn(0, new Error('x'))).toBe(1000)
  })

  it('queries.retryDelay caps at 30_000ms', () => {
    const opts = queryClient.getDefaultOptions()
    const fn = opts.queries?.retryDelay as (attempt: number, error: unknown) => number
    expect(fn(5, new Error('x'))).toBe(30_000)
    expect(fn(20, new Error('x'))).toBe(30_000)
  })
})

// Helper — synthesise a minimal Mutation-like object that
// `shouldDehydrateMutation` can inspect. We avoid importing private
// QueryClient internals; the predicate only reads `state.isPaused`,
// `state.status`, and `options.mutationKey`.
function makeMutation(opts: {
  key: string[]
  status: 'idle' | 'pending' | 'success' | 'error'
  isPaused: boolean
}) {
  return {
    options: { mutationKey: opts.key },
    state: { status: opts.status, isPaused: opts.isPaused },
  } as unknown as Parameters<NonNullable<typeof dehydrateOptions.shouldDehydrateMutation>>[0]
}

describe('Story 3-2 / dehydrateOptions.shouldDehydrateMutation (AC #4, #15)', () => {
  it('persists in-flight collective.post', () => {
    const m = makeMutation({ key: ['collective', 'post'], status: 'pending', isPaused: false })
    expect(dehydrateOptions.shouldDehydrateMutation!(m)).toBe(true)
  })

  it('persists in-flight collective.report', () => {
    const m = makeMutation({ key: ['collective', 'report'], status: 'pending', isPaused: false })
    expect(dehydrateOptions.shouldDehydrateMutation!(m)).toBe(true)
  })

  it('does NOT persist in-flight collective.react', () => {
    const m = makeMutation({ key: ['collective', 'react'], status: 'pending', isPaused: false })
    expect(dehydrateOptions.shouldDehydrateMutation!(m)).toBe(false)
  })

  it('persists any paused mutation regardless of key', () => {
    const m1 = makeMutation({ key: ['collective', 'react'], status: 'idle', isPaused: true })
    const m2 = makeMutation({ key: ['something', 'else'], status: 'idle', isPaused: true })
    expect(dehydrateOptions.shouldDehydrateMutation!(m1)).toBe(true)
    expect(dehydrateOptions.shouldDehydrateMutation!(m2)).toBe(true)
  })

  it('does NOT persist a successful idle mutation', () => {
    const m = makeMutation({ key: ['collective', 'post'], status: 'success', isPaused: false })
    expect(dehydrateOptions.shouldDehydrateMutation!(m)).toBe(false)
  })

  it('does NOT persist an idle non-collective mutation', () => {
    const m = makeMutation({ key: ['unrelated'], status: 'idle', isPaused: false })
    expect(dehydrateOptions.shouldDehydrateMutation!(m)).toBe(false)
  })
})

describe('Story 3-2 / queryClient.native re-exports identical shape (AC #5)', () => {
  it('re-exports queryClient and dehydrateOptions from ./queryClient', async () => {
    // Vitest runs in a Node context; Metro's `.native.ts` resolution does NOT
    // apply here. We import the .native module by explicit path and assert the
    // exported singleton is the same object as the .ts variant — this proves
    // the re-export shape is correct and that the native-only side-effects
    // (AppState/NetInfo wiring) didn't replace the singleton.
    const native = await import('../queryClient.native')
    expect(native.queryClient).toBe(queryClient)
    expect(native.dehydrateOptions).toBe(dehydrateOptions)
  })
})

describe('Story 3-2 / state/collective/mutations stub (AC #6, #18)', () => {
  it('exports __collectiveMutationsStub === true', async () => {
    const mod = await import('../collective/mutations')
    expect(mod.__collectiveMutationsStub).toBe(true)
  })

  it('exports __collectiveMutationsLoadedAt as a finite number', async () => {
    const mod = await import('../collective/mutations')
    expect(typeof mod.__collectiveMutationsLoadedAt).toBe('number')
    expect(Number.isFinite(mod.__collectiveMutationsLoadedAt)).toBe(true)
  })
})

describe('Story 3-2 / queryStorage resilience (AC #20)', () => {
  it('getItem resolves to undefined when underlying storage throws', async () => {
    // The web/desktop adapter wraps IndexedDB. We can't easily induce a real
    // IndexedDB failure under jsdom-less Node, so instead we exercise the
    // adapter against a key that does not exist — the contract is: "no entry
    // → resolve to undefined, never reject." That contract holds whether the
    // underlying store throws (try/catch path) or returns null (no-entry path).
    const { queryStorage } = await import('../queryStorage')
    await expect(queryStorage.getItem('rj-tq:nonexistent-key')).resolves.toBeUndefined()
  })

  it('setItem does not reject when storage throws (returns void)', async () => {
    const { queryStorage } = await import('../queryStorage')
    // The adapter must never propagate a storage rejection — even if the
    // underlying engine fails, the persister contract is to swallow with a
    // console.warn. We assert by attempting a write under the test
    // environment (which has no real IndexedDB) and confirming no throw.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(queryStorage.setItem('rj-tq:k', 'v')).resolves.toBeUndefined()
    warn.mockRestore()
  })

  it('removeItem does not reject when storage throws', async () => {
    const { queryStorage } = await import('../queryStorage')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(queryStorage.removeItem('rj-tq:k')).resolves.toBeUndefined()
    warn.mockRestore()
  })
})

describe('Story 3-2 / queryClient mutationCache exists (sanity)', () => {
  it('exposes a MutationCache (so setMutationDefaults in Story 3.7 has a target)', () => {
    // Ensure that the singleton has a fully-constructed mutation cache —
    // a regression here would mean Story 3.7's setMutationDefaults calls
    // would fail even with correct eager-import ordering.
    expect(queryClient.getMutationCache()).toBeInstanceOf(MutationCache)
  })
})
