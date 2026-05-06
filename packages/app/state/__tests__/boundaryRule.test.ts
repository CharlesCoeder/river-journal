/**
 * Boundary-rule grep test — Legend-State side.
 *
 * Asserts that `state/syncConfig.ts` and the canonical Legend-State observable
 * files do NOT import the TanStack Query package (or any of its subpaths)
 * via static `from`, dynamic `require()`, or dynamic `import()` forms.
 *
 * The single regex catches all three import shapes by matching the literal
 * package-string form. The boundary rule cares about the dependency, not the
 * syntax of the import — a future contributor lazy-loading TanStack Query
 * inside a Legend-State file via dynamic import would silently bypass a
 * static-only check.
 *
 * TODO: the symmetric assertion (`state/collective/**` must not import
 * `@legendapp/state` except for `feed.ts`'s narrow exception) lives in
 * `boundary-rule.test.ts` and is delivered alongside the TanStack Query
 * infrastructure surface.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const STATE_DIR = path.resolve(__dirname, '..')

// AC 13: these files (Legend-State side) must not pull in TanStack Query.
const LEGEND_FILES = [
  'syncConfig.ts',
  'store.ts',
  'flows.ts',
  'entries.ts',
  'encryptionSetup.ts',
  'initializeApp.ts',
  'persistConfig.ts',
] as const

// Catches:
//   import { ... } from '@tanstack/react-query'
//   import('@tanstack/react-query')
//   require('@tanstack/react-query')
// Covers the three quote styles and any @tanstack/* subpath.
const TQ_PATTERN = /['"`]@tanstack\/(react-query|query-[\w-]+)(?:\/[\w-]+)*['"`]/

describe('Boundary rule (Legend-State side) — Legend-State files do not import @tanstack/*', () => {
  for (const rel of LEGEND_FILES) {
    it(`${rel} contains no @tanstack/* import (static or dynamic)`, () => {
      const abs = path.join(STATE_DIR, rel)
      expect(existsSync(abs), `expected ${rel} to exist under packages/app/state/`).toBe(true)
      const src = readFileSync(abs, 'utf8')
      expect(src).not.toMatch(TQ_PATTERN)
    })
  }
})
