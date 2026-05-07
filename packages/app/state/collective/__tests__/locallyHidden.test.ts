/**
 * Story 3-12 — TDD red-phase unit tests for `state/collective/locallyHidden.ts`.
 *
 * Red-phase contract: every test MUST fail until Story 3-12's Task 2 creates
 * `packages/app/state/collective/locallyHidden.ts`.
 *
 * AC coverage (AC #16):
 *   t1 — returns empty Set when preference array is undefined
 *   t2 — returns Set with all ids when preference is a populated array
 *   t3 — boundary-rule exception is documented in source (D7 exception comment)
 *
 * Mock strategy: mock store$ observable's use$ resolution; mirror reactions.test.ts t5
 * pattern for boundary-rule source grep.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// ─── Path constants ───────────────────────────────────────────────────────────
const COLLECTIVE_STATE_DIR = path.resolve(__dirname, '..')
const LOCALLY_HIDDEN_PATH = path.join(COLLECTIVE_STATE_DIR, 'locallyHidden.ts')

// ─── Legend-State mock ────────────────────────────────────────────────────────
// We mock use$ to return a controlled value injected per-test.
let mockLocallyHiddenValue: string[] | undefined = undefined

vi.mock('@legendapp/state/react', () => ({
  use$: (obs: any) => {
    // obs is store$.profile.preferences.locallyHiddenPosts
    // Return the test-controlled value
    return mockLocallyHiddenValue
  },
}))

// ─── store mock ───────────────────────────────────────────────────────────────
vi.mock('app/state/store', () => ({
  store$: {
    profile: {
      preferences: {
        locallyHiddenPosts: {
          get: () => mockLocallyHiddenValue,
        },
      },
    },
  },
  addLocallyHiddenPost: vi.fn(),
  ensureProfile: vi.fn(),
}))

// ─── Import under test — will fail until locallyHidden.ts exists ──────────────
import { useLocallyHiddenPostIds } from '../locallyHidden'

// ─────────────────────────────────────────────────────────────────────────────
// Test lifecycle
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  mockLocallyHiddenValue = undefined
})

// ─────────────────────────────────────────────────────────────────────────────
// t1 — returns empty Set when preference is unset (undefined)
// AC #16 t1
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-12 / locallyHidden t1 — empty Set when preference is unset (AC #16)', () => {
  it('returns a Set when locallyHiddenPosts is undefined', () => {
    mockLocallyHiddenValue = undefined
    const result = useLocallyHiddenPostIds()
    expect(result).toBeInstanceOf(Set)
  })

  it('Set size is 0 when locallyHiddenPosts is undefined', () => {
    mockLocallyHiddenValue = undefined
    const result = useLocallyHiddenPostIds()
    expect(result.size).toBe(0)
  })

  it('returns empty Set when locallyHiddenPosts is empty array', () => {
    mockLocallyHiddenValue = []
    const result = useLocallyHiddenPostIds()
    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t2 — returns Set with all ids when preference is populated array
// AC #16 t2
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-12 / locallyHidden t2 — Set populated from array (AC #16)', () => {
  it('Set contains all ids from the array', () => {
    mockLocallyHiddenValue = ['p1', 'p2', 'p3']
    const result = useLocallyHiddenPostIds()
    expect(result.has('p1')).toBe(true)
    expect(result.has('p2')).toBe(true)
    expect(result.has('p3')).toBe(true)
  })

  it('Set size matches array length', () => {
    mockLocallyHiddenValue = ['p1', 'p2', 'p3']
    const result = useLocallyHiddenPostIds()
    expect(result.size).toBe(3)
  })

  it('Set does not contain ids that are not in the array', () => {
    mockLocallyHiddenValue = ['p1', 'p2']
    const result = useLocallyHiddenPostIds()
    expect(result.has('p3')).toBe(false)
    expect(result.has('p99')).toBe(false)
  })

  it('handles single-item array', () => {
    mockLocallyHiddenValue = ['single-post']
    const result = useLocallyHiddenPostIds()
    expect(result.size).toBe(1)
    expect(result.has('single-post')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t3 — boundary-rule exception is documented in source
// AC #16 t3
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-12 / locallyHidden t3 — D7 boundary exception documented (AC #16)', () => {
  it('locallyHidden.ts file exists on disk', () => {
    expect(existsSync(LOCALLY_HIDDEN_PATH)).toBe(true)
  })

  it('locallyHidden.ts contains the D7 boundary exception comment', () => {
    expect(existsSync(LOCALLY_HIDDEN_PATH)).toBe(true)
    const src = readFileSync(LOCALLY_HIDDEN_PATH, 'utf8')
    expect(src).toMatch(/Boundary rule.*exception|D7.*exception/i)
  })

  it('locallyHidden.ts imports use$ from @legendapp/state/react (exactly one Legend-State import)', () => {
    expect(existsSync(LOCALLY_HIDDEN_PATH)).toBe(true)
    const src = readFileSync(LOCALLY_HIDDEN_PATH, 'utf8')
    const allowed = /import\s*\{[^}]*use\$[^}]*\}\s*from\s*['"]@legendapp\/state\/react['"]/
    expect(src).toMatch(allowed)

    const legendLines = src.split('\n').filter((l) => /@legendapp\/state/.test(l))
    expect(legendLines.length).toBe(1)
  })

  it('locallyHidden.ts does NOT import @tanstack/react-query (D7 TQ-side clean)', () => {
    expect(existsSync(LOCALLY_HIDDEN_PATH)).toBe(true)
    const src = readFileSync(LOCALLY_HIDDEN_PATH, 'utf8')
    expect(src).not.toMatch(/@tanstack\/(react-query|query-[\w-]+)/)
  })

  it('locallyHidden.ts cites Story 3-12 ID in its exception comment', () => {
    expect(existsSync(LOCALLY_HIDDEN_PATH)).toBe(true)
    const src = readFileSync(LOCALLY_HIDDEN_PATH, 'utf8')
    expect(src).toMatch(/3-12|Story 3\.12/)
  })

  it('locallyHidden.ts exports useLocallyHiddenPostIds function', () => {
    expect(existsSync(LOCALLY_HIDDEN_PATH)).toBe(true)
    const src = readFileSync(LOCALLY_HIDDEN_PATH, 'utf8')
    expect(src).toMatch(/export.*useLocallyHiddenPostIds/)
  })
})
