// @vitest-environment happy-dom
/**
 * Story 3-12 — TDD red-phase unit tests for `addLocallyHiddenPost` helper in
 * `packages/app/state/store.ts`.
 *
 * Red-phase contract: every test MUST fail until Story 3-12's Task 1 adds
 * `addLocallyHiddenPost` to `packages/app/state/store.ts`.
 *
 * AC coverage (AC #17):
 *   t1 — first call with new postId sets array to [postId]
 *   t2 — calling twice with same postId is idempotent (stays [postId])
 *   t3 — two distinct postIds accumulate in insertion order
 *   t4 — profile not yet initialized: ensureProfile runs without throwing
 *
 * Mock strategy: mock Supabase client (prevents network) + persistConfig
 * (prevents IDB crash in Node). Then import store and addLocallyHiddenPost.
 * Mirrors store.test.ts setup pattern exactly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mock Supabase client ────────────────────────────────────────────────────
vi.mock('../../utils/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    })),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id' } },
        error: null,
      }),
    },
  },
}))

// ─── Mock persistConfig (prevents IDB/MMKV crash in Node) ──────────────────
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

// ─── Import under test — will fail until addLocallyHiddenPost is added ───────
import { store$, addLocallyHiddenPost, ensureProfile } from '../store'

// ─────────────────────────────────────────────────────────────────────────────
// Test isolation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reset the locallyHiddenPosts preference to undefined before each test
 * to ensure a clean slate (prevents cross-test contamination from Legend-State).
 */
function resetLocallyHiddenPosts(): void {
  try {
    // @ts-expect-error — locallyHiddenPosts may not exist yet; will pass after implementation
    store$.profile.preferences.locallyHiddenPosts.set(undefined)
  } catch {
    // swallow — field doesn't exist yet in red-phase
  }
}

/**
 * Read the current value of locallyHiddenPosts from the store.
 */
function getLocallyHiddenPosts(): string[] | undefined {
  try {
    // @ts-expect-error — locallyHiddenPosts may not exist yet; will pass after implementation
    return store$.profile.preferences.locallyHiddenPosts.get()
  } catch {
    return undefined
  }
}

beforeEach(() => {
  // Ensure profile exists so addLocallyHiddenPost can operate
  try {
    ensureProfile()
  } catch {
    // may throw in red-phase; that's fine — tests will catch it
  }
  resetLocallyHiddenPosts()
})

afterEach(() => {
  resetLocallyHiddenPosts()
})

// ─────────────────────────────────────────────────────────────────────────────
// t1 — first call with a new postId → array becomes [postId]
// AC #17 t1
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-12 / addLocallyHiddenPost t1 — first call sets array (AC #17)', () => {
  it('addLocallyHiddenPost is exported from state/store', () => {
    expect(typeof addLocallyHiddenPost).toBe('function')
  })

  it('first call with new postId sets locallyHiddenPosts to [postId]', () => {
    addLocallyHiddenPost('post-alpha')

    const result = getLocallyHiddenPosts()
    expect(result).toEqual(['post-alpha'])
  })

  it('array length is 1 after first call', () => {
    addLocallyHiddenPost('post-beta')

    const result = getLocallyHiddenPosts()
    expect(result?.length).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t2 — calling twice with same postId is idempotent (duplicate guard)
// AC #17 t2
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-12 / addLocallyHiddenPost t2 — idempotent on duplicate (AC #17)', () => {
  it('calling twice with same postId keeps array as [postId] (no duplicate)', () => {
    addLocallyHiddenPost('post-gamma')
    addLocallyHiddenPost('post-gamma')

    const result = getLocallyHiddenPosts()
    expect(result).toEqual(['post-gamma'])
  })

  it('array length stays 1 after duplicate add', () => {
    addLocallyHiddenPost('post-delta')
    addLocallyHiddenPost('post-delta')
    addLocallyHiddenPost('post-delta')

    const result = getLocallyHiddenPosts()
    expect(result?.length).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t3 — two distinct postIds accumulate in insertion order
// AC #17 t3
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-12 / addLocallyHiddenPost t3 — multiple distinct ids in order (AC #17)', () => {
  it('adding two distinct ids produces ["a","b"] in insertion order', () => {
    addLocallyHiddenPost('a')
    addLocallyHiddenPost('b')

    const result = getLocallyHiddenPosts()
    expect(result).toEqual(['a', 'b'])
  })

  it('adding three distinct ids preserves insertion order', () => {
    addLocallyHiddenPost('first')
    addLocallyHiddenPost('second')
    addLocallyHiddenPost('third')

    const result = getLocallyHiddenPosts()
    expect(result).toEqual(['first', 'second', 'third'])
  })

  it('interleaved duplicate + new id is handled correctly', () => {
    addLocallyHiddenPost('a')
    addLocallyHiddenPost('b')
    addLocallyHiddenPost('a') // duplicate — should not re-add
    addLocallyHiddenPost('c')

    const result = getLocallyHiddenPosts()
    expect(result).toEqual(['a', 'b', 'c'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t4 — profile not yet initialized: ensureProfile runs without throwing
// AC #17 t4
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-12 / addLocallyHiddenPost t4 — initializes safely without profile (AC #17)', () => {
  it('does not throw when called with a valid postId', () => {
    expect(() => {
      addLocallyHiddenPost('safe-call-post')
    }).not.toThrow()
  })

  it('result is set after call even when starting from uninitialized state', () => {
    // Reset fully (simulate fresh cold start)
    resetLocallyHiddenPosts()

    addLocallyHiddenPost('cold-start-post')

    const result = getLocallyHiddenPosts()
    expect(Array.isArray(result)).toBe(true)
    expect(result).toContain('cold-start-post')
  })
})
