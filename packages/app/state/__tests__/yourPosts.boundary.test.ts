/**
 * Story 3-5 — TDD red-phase boundary-rule regression test (AC #14, #15, #18).
 *
 * Two enforcement layers are asserted here. Both fail in red phase:
 *   1. The file `state/collective/yourPosts.ts` does not exist yet.
 *   2. Once it exists, it MUST NOT import @legendapp/state (any subpath) and
 *      MUST NOT call `use$()` or import from `@legendapp/state/react`.
 *
 * This complements the existing `boundary-rule.test.ts` TQ_FILES iteration
 * (which Story 3-5 also extends additively in AC #18). Keeping a dedicated
 * file here makes the story's red-phase signal sharp: a missing module or a
 * stray Legend-State import surfaces in this file's dedicated `describe`
 * block rather than getting buried in the multi-story TQ_FILES sweep.
 *
 * Boundary-rule rationale (D7): `state/collective/yourPosts.ts` lives on the
 * TanStack Query side of the v2 architecture split. The narrow Legend-State
 * `observe()` exception documented in epic-3-context.md applies only to
 * `state/collective/feed.ts` (cache invalidation on streak crossings). Own-
 * posts visibility is unaffected by today's word count -- no exception here.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const STATE_DIR = path.resolve(__dirname, '..')
const YOUR_POSTS_REL = 'collective/yourPosts.ts'
const YOUR_POSTS_ABS = path.join(STATE_DIR, YOUR_POSTS_REL)

const LEGEND_PATTERN = /@legendapp\/state(?:\/[\w-]+(?:\/[\w-]+)?)?/
const USE_DOLLAR_PATTERN = /\buse\$\s*\(/

describe('Story 3-5 / Boundary rule D7 -- yourPosts.ts is a TQ-side file (AC #14, #15)', () => {
  it('packages/app/state/collective/yourPosts.ts exists', () => {
    expect(existsSync(YOUR_POSTS_ABS), `expected ${YOUR_POSTS_REL} to exist`).toBe(true)
  })

  it('does NOT import @legendapp/state (any subpath) (AC #14)', () => {
    if (!existsSync(YOUR_POSTS_ABS)) {
      // Red-phase: file does not exist. We still want this assertion to fail
      // loudly (the previous test surfaces the missing-file root cause).
      expect.fail(`${YOUR_POSTS_REL} does not exist; cannot grep for imports`)
    }
    const src = readFileSync(YOUR_POSTS_ABS, 'utf8')
    expect(src).not.toMatch(LEGEND_PATTERN)
  })

  it('does NOT call use$() (AC #15)', () => {
    if (!existsSync(YOUR_POSTS_ABS)) {
      expect.fail(`${YOUR_POSTS_REL} does not exist; cannot grep for use$()`)
    }
    const src = readFileSync(YOUR_POSTS_ABS, 'utf8')
    expect(src).not.toMatch(USE_DOLLAR_PATTERN)
  })
})

describe('Story 3-5 / boundary-rule.test.ts TQ_FILES extension (AC #18)', () => {
  it('TQ_FILES array in boundary-rule.test.ts contains "collective/yourPosts.ts"', () => {
    const boundaryTestPath = path.join(STATE_DIR, '__tests__', 'boundary-rule.test.ts')
    expect(existsSync(boundaryTestPath), 'boundary-rule.test.ts must exist').toBe(true)
    const src = readFileSync(boundaryTestPath, 'utf8')
    // The TQ_FILES array is a literal `as const` tuple of string filenames.
    // We grep for the exact entry rather than parse the array.
    expect(src).toMatch(/['"]collective\/yourPosts\.ts['"]/)
  })
})

describe('Story 3-5 / database.ts type entry (AC #16)', () => {
  it('packages/app/types/database.ts declares collective_your_posts_page in the Functions block', () => {
    const dbTypesPath = path.resolve(STATE_DIR, '../types/database.ts')
    expect(existsSync(dbTypesPath), 'types/database.ts must exist').toBe(true)
    const src = readFileSync(dbTypesPath, 'utf8')
    expect(src).toMatch(/collective_your_posts_page\s*:/)
  })
})

describe('Story 3-5 / migration file presence (AC #1)', () => {
  it('a migration file matching *_add_collective_your_posts_rpc.sql exists under supabase/migrations/', () => {
    const repoRoot = path.resolve(STATE_DIR, '../../..')
    const migrationsDir = path.join(repoRoot, 'supabase', 'migrations')
    expect(existsSync(migrationsDir), 'supabase/migrations/ must exist').toBe(true)
    const fs = require('node:fs') as typeof import('node:fs')
    const files = fs.readdirSync(migrationsDir)
    const match = files.find((f) => /_add_collective_your_posts_rpc\.sql$/.test(f))
    expect(match, 'expected a *_add_collective_your_posts_rpc.sql migration').toBeDefined()
  })

  it('the migration filename timestamp prefix is strictly later than 20260506000007', () => {
    const repoRoot = path.resolve(STATE_DIR, '../../..')
    const migrationsDir = path.join(repoRoot, 'supabase', 'migrations')
    if (!existsSync(migrationsDir)) {
      expect.fail('migrations directory missing')
    }
    const fs = require('node:fs') as typeof import('node:fs')
    const files = fs.readdirSync(migrationsDir)
    const match = files.find((f) => /_add_collective_your_posts_rpc\.sql$/.test(f))
    if (!match) {
      // Caught by the prior assertion; bail to avoid a noisy second failure.
      return
    }
    const timestamp = match.split('_')[0]
    expect(timestamp.length).toBe(14)
    expect(Number(timestamp)).toBeGreaterThan(20260506000007)
  })
})
