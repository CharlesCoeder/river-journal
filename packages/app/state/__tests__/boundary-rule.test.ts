/**
 * Story 3-2 — TDD red-phase boundary-rule grep test (AC #12, #13, #14).
 *
 * Programmatic enforcement of the v2 D7 Boundary Rule: TanStack-Query files
 * must not import @legendapp/state, and Legend-State files must not import
 * @tanstack/react-query (or any TanStack subpath). This is the durable line
 * of defense against future drift — it runs on every `yarn test`.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const STATE_DIR = path.resolve(__dirname, '..')

// AC #12: TQ-side files MUST NOT import @legendapp/state (any subpath).
const TQ_FILES = [
  'queryClient.ts',
  'queryClient.native.ts',
  'queryStorage.ts',
  'queryStorage.native.ts',
  'collective/mutations.ts',
] as const

const LEGEND_PATTERN = /@legendapp\/state(?:\/[\w-]+(?:\/[\w-]+)?)?/

// AC #13: Legend-State-side files MUST NOT import @tanstack/react-query
// (or @tanstack/query-* subpaths).
const LEGEND_FILES = [
  'store.ts',
  'flows.ts',
  'entries.ts',
  'syncConfig.ts',
  'encryptionSetup.ts',
  'initializeApp.ts',
  'persistConfig.ts',
  'persistConfig.native.ts',
] as const

const TQ_PATTERN = /@tanstack\/(react-query|query-[\w-]+)/

function readIfExists(rel: string): string | null {
  const abs = path.join(STATE_DIR, rel)
  if (!existsSync(abs)) return null
  return readFileSync(abs, 'utf8')
}

describe('Story 3-2 / Boundary rule D7 — TQ files do not import @legendapp/state (AC #12)', () => {
  for (const rel of TQ_FILES) {
    it(`${rel} exists and is free of @legendapp/state imports`, () => {
      const contents = readIfExists(rel)
      // The file MUST exist (Story 3-2 lands all five TQ-side files). A
      // missing file fails the red-phase test before implementation.
      expect(contents, `expected ${rel} to exist under packages/app/state/`).not.toBeNull()
      expect(contents).not.toMatch(LEGEND_PATTERN)
    })
  }
})

describe('Story 3-2 / Boundary rule D7 — Legend-State files do not import @tanstack/* (AC #13)', () => {
  for (const rel of LEGEND_FILES) {
    it(`${rel} is free of @tanstack/(react-query|query-*) imports`, () => {
      const contents = readIfExists(rel)
      // These files all already exist in v1; if any are missing, that's a
      // separate regression — fail loudly.
      expect(contents, `expected ${rel} to exist under packages/app/state/`).not.toBeNull()
      expect(contents).not.toMatch(TQ_PATTERN)
    })
  }
})

describe('Story 3-2 / Eager-import ordering grep (AC #7, #8, #9)', () => {
  // The eager-import discipline lives in 4 files. Regression: if the eager
  // import is missing from any of them, the persisted-mutation replay can
  // silently drop offline-queued posts. We grep for the literal import path.
  const EAGER_IMPORT_RE = /import\s+['"]app\/state\/collective\/mutations['"]/

  const ROOT = path.resolve(__dirname, '../../../..')

  const ENTRY_FILES = [
    'apps/web/app/layout.tsx',
    'apps/desktop/app/layout.tsx',
    'apps/mobile/app/_layout.tsx',
    'packages/app/provider/index.tsx',
  ] as const

  for (const rel of ENTRY_FILES) {
    it(`${rel} contains the eager 'app/state/collective/mutations' import`, () => {
      const abs = path.join(ROOT, rel)
      expect(existsSync(abs), `expected ${rel} to exist`).toBe(true)
      const src = readFileSync(abs, 'utf8')
      expect(src, `expected ${rel} to import 'app/state/collective/mutations'`).toMatch(
        EAGER_IMPORT_RE
      )
    })
  }

  it('apps/web and apps/desktop layout.tsx remain byte-identical (AC #8)', () => {
    const web = readFileSync(path.join(ROOT, 'apps/web/app/layout.tsx'), 'utf8')
    const desktop = readFileSync(path.join(ROOT, 'apps/desktop/app/layout.tsx'), 'utf8')
    expect(web).toBe(desktop)
  })

  it('eager mutations import is the FIRST non-React import in provider/index.tsx (AC #7)', () => {
    const src = readFileSync(path.join(ROOT, 'packages/app/provider/index.tsx'), 'utf8')
    // Strip blank lines and comment-only lines, then find the first `import` line.
    const lines = src.split('\n')
    const firstImportIdx = lines.findIndex((l) => /^\s*import\b/.test(l))
    expect(firstImportIdx).toBeGreaterThanOrEqual(0)
    // The very first import must be the eager mutations side-effect import.
    expect(lines[firstImportIdx]).toMatch(EAGER_IMPORT_RE)
  })
})

describe('Story 3-2 / packages/app/package.json sideEffects + deps (AC #1, #6)', () => {
  const pkgPath = path.resolve(__dirname, '../../package.json')

  it('declares ./state/collective/mutations.ts as a side-effect', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      sideEffects?: string[]
    }
    expect(pkg.sideEffects).toBeDefined()
    expect(pkg.sideEffects).toContain('./state/collective/mutations.ts')
  })

  it('declares the four TanStack Query packages', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps = pkg.dependencies ?? {}
    const devDeps = pkg.devDependencies ?? {}

    // Runtime deps.
    expect(deps['@tanstack/react-query'], '@tanstack/react-query in deps').toBeDefined()
    expect(
      deps['@tanstack/query-async-storage-persister'],
      '@tanstack/query-async-storage-persister in deps'
    ).toBeDefined()
    expect(
      deps['@tanstack/react-query-persist-client'],
      '@tanstack/react-query-persist-client in deps'
    ).toBeDefined()

    // Dev-only — devtools must NOT live in production deps (AC #11).
    expect(
      devDeps['@tanstack/react-query-devtools'],
      '@tanstack/react-query-devtools in devDependencies'
    ).toBeDefined()
    expect(
      deps['@tanstack/react-query-devtools'],
      '@tanstack/react-query-devtools must NOT be in production deps'
    ).toBeUndefined()
  })

  it('@tanstack/react-query is pinned to ^5', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const range = pkg.dependencies?.['@tanstack/react-query']
    expect(range, '@tanstack/react-query missing').toBeDefined()
    expect(range).toMatch(/^\^5(\.|$)/)
  })
})

describe('Boundary rule D7 — feed.ts narrow exception (single observe import)', () => {
  const FEED_REL = 'collective/feed.ts'
  const FEED_ABS = path.join(STATE_DIR, FEED_REL)

  it('feed.ts exists on disk (vacuous-pass guard)', () => {
    expect(existsSync(FEED_ABS)).toBe(true)
  })

  it('feed.ts imports ONLY `observe` from `@legendapp/state`', () => {
    expect(existsSync(FEED_ABS)).toBe(true)
    const src = readFileSync(FEED_ABS, 'utf8')
    const allowed = /import\s*\{\s*observe\s*\}\s*from\s*['"]@legendapp\/state['"]/
    expect(src).toMatch(allowed)
    const lines = src.split('\n').filter((l) => /@legendapp\/state/.test(l))
    expect(lines.length).toBe(1)
    expect(lines[0]).toMatch(allowed)
    expect(src).not.toMatch(/@legendapp\/state\/react/)
    expect(src).not.toMatch(/@legendapp\/state\/sync/)
    expect(src).not.toMatch(/use\$\s*\(/)
  })
})

describe('Story 3-2 / persistConfig DB_VERSION + tanstack-query table (AC #2)', () => {
  it('persistConfig.ts bumps DB_VERSION to 6 and includes tanstack-query table', () => {
    const src = readIfExists('persistConfig.ts')
    expect(src).not.toBeNull()
    // DB_VERSION must be 6 or greater (the bump from 5 → 6 is what creates
    // the new IndexedDB object store on existing-user upgrades).
    const versionMatch = src!.match(/DB_VERSION\s*=\s*(\d+)/)
    expect(versionMatch, 'DB_VERSION constant not found').not.toBeNull()
    const version = Number(versionMatch![1])
    expect(version).toBeGreaterThanOrEqual(6)
    // The new table name must be in the TABLE_NAMES array.
    expect(src).toMatch(/['"]tanstack-query['"]/)
  })
})
