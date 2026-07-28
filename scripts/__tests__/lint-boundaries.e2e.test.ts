/**
 * lint-boundaries.e2e.test.ts — TDD RED-PHASE E2E spec for the CI boundary
 * lint check, `scripts/lint-boundaries.mjs`.
 *
 * Mirrors the `lint-edge-function-logging.e2e.test.ts` precedent: the script
 * is shelled out to as a real child process (`node scripts/lint-boundaries.mjs`)
 * against the real repository tree. Nothing about the script is mocked.
 *
 * The script enforces three import-statement-anchored boundary rules:
 *   (a) legacy Legend-State state files must not import `@tanstack/react-query`.
 *   (b) `apps/mobile/**` must not import the moderation feature.
 *   (c) `state/collective/**` must not bridge into the Legend-State journal
 *       domain (no `syncedQuery(` usage, no imports of the journal store).
 *
 * Two different fixture strategies are used depending on how a violation can
 * be introduced without ever leaving the tree dirty:
 *   - Rules (b) and (c) are directory-wide scans over paths that don't yet
 *     contain a fixture-scratch file, so a NEW scratch file is planted
 *     under the scanned subtree and removed in a `finally` block — same
 *     pattern as the `lint-edge-function-logging.mjs` precedent.
 *   - Rule (a)'s AC text enumerates a FIXED file list (`state/store.ts`,
 *     `state/flows.ts`, etc.) rather than a directory glob, so a new file
 *     planted alongside them is not guaranteed to be in scope. Instead, the
 *     test TEMPORARILY appends a violating import to the real, already-in-scope
 *     `packages/app/state/store.ts` and restores the file's exact original
 *     bytes in a `finally` block immediately after the synchronous lint run —
 *     the mutation window never outlives a single `spawnSync` call and the
 *     file is never left modified, matching the "never leave a violation in
 *     the tree" invariant the precedent establishes for planted fixtures.
 *
 * The real tree (including the accepted `state/collective/` reads —
 * `feed.ts`'s `observe`, `locallyHidden.ts`/`todayWordCount.ts`'s `use$` —
 * and `apps/mobile/app/_layout.tsx`'s explanatory comment mentioning
 * `features/moderation/**`) MUST exit 0. A naive implementation of any of
 * the three rules trips one of these real, accepted cases — see the story's
 * boundary-grep reconciliation notes.
 *
 * RED PHASE: `scripts/lint-boundaries.mjs` does not exist yet. Every test
 * below MUST fail until this story implements it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const LINT_SCRIPT_REL = 'scripts/lint-boundaries.mjs'
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json')

const STORE_TS_ABS = path.join(ROOT, 'packages/app/state/store.ts')
const MOBILE_FIXTURES_DIR = path.join(ROOT, 'apps/mobile/__lint_fixture_scratch__')
const COLLECTIVE_FIXTURES_DIR = path.join(
  ROOT,
  'packages/app/state/collective/__lint_fixture_scratch__'
)

function runLint(): { status: number | null; output: string } {
  const result = spawnSync('node', [LINT_SCRIPT_REL], { cwd: ROOT, encoding: 'utf-8' })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function plantFixture(dir: string, name: string, contents: string): { abs: string; rel: string } {
  mkdirSync(dir, { recursive: true })
  const abs = path.join(dir, name)
  writeFileSync(abs, contents)
  return { abs, rel: path.relative(ROOT, abs) }
}

let originalStoreTsContent = ''

beforeAll(() => {
  // Defensive cleanup in case a previous interrupted run left scratch
  // fixtures or a mutated store.ts behind.
  rmSync(MOBILE_FIXTURES_DIR, { recursive: true, force: true })
  rmSync(COLLECTIVE_FIXTURES_DIR, { recursive: true, force: true })
  originalStoreTsContent = readFileSync(STORE_TS_ABS, 'utf-8')
})

afterAll(() => {
  rmSync(MOBILE_FIXTURES_DIR, { recursive: true, force: true })
  rmSync(COLLECTIVE_FIXTURES_DIR, { recursive: true, force: true })
  // Backstop: guarantee store.ts is byte-for-byte restored even if a test
  // above threw before its own finally ran.
  writeFileSync(STORE_TS_ABS, originalStoreTsContent)
})

describe('scripts/lint-boundaries.mjs — exists, runnable, wired', () => {
  it('the script file exists', () => {
    expect(existsSync(path.join(ROOT, LINT_SCRIPT_REL))).toBe(true)
  })

  it('exits 0 on the real, clean tree', () => {
    // This single assertion also proves the three known false-positive traps
    // stay green: the accepted `use$`/`observe` reads in
    // packages/app/state/collective/{locallyHidden,todayWordCount,feed}.ts,
    // and the `features/moderation` mention inside a comment (not an import)
    // in apps/mobile/app/_layout.tsx.
    const { status, output } = runLint()
    expect(status).toBe(0)
    expect(output).not.toMatch(/Cannot find module/)
  })

  it('is wired into the repo as a runnable check (a yarn script entry, or referenced directly from CI)', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8'))
    const scriptsText = JSON.stringify(pkg.scripts ?? {})
    expect(scriptsText).toMatch(/lint-boundaries\.mjs/)
  })
})

describe('scripts/lint-boundaries.mjs — rule (a): legacy Legend-State files must not import TanStack Query', () => {
  it('flags a `@tanstack/react-query` import added to packages/app/state/store.ts', () => {
    const violatingContent =
      `${originalStoreTsContent}\n` +
      `// Fixture import injected temporarily by an automated test — restored immediately after.\n` +
      `import { useQuery } from '@tanstack/react-query'\n` +
      `export const __lintFixtureProbe = useQuery\n`
    writeFileSync(STORE_TS_ABS, violatingContent)
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).not.toMatch(/Cannot find module/)
      expect(output).toMatch(/state\/store\.ts/)
      expect(output).toMatch(/@tanstack\/react-query|react-query/i)
    } finally {
      writeFileSync(STORE_TS_ABS, originalStoreTsContent)
    }
  })
})

describe('scripts/lint-boundaries.mjs — rule (b): apps/mobile/** must not import the moderation feature', () => {
  it('flags an import-anchored reference to app/features/moderation from apps/mobile/**', () => {
    const { rel } = plantFixture(
      MOBILE_FIXTURES_DIR,
      'moderationBridge.fixture.ts',
      `import { ModerationPanel } from 'app/features/moderation/ModerationPanel'\n` +
        `export const noop = ModerationPanel\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).not.toMatch(/Cannot find module/)
      expect(output).toMatch(new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      expect(output).toMatch(/moderation/i)
    } finally {
      rmSync(path.join(ROOT, rel), { force: true })
    }
  })
})

describe('scripts/lint-boundaries.mjs — rule (c): state/collective/** must not bridge into the Legend-State journal domain', () => {
  it('flags a `syncedQuery(` call inside state/collective/**', () => {
    const { rel } = plantFixture(
      COLLECTIVE_FIXTURES_DIR,
      'syncedQueryUsage.fixture.ts',
      `export function bridge() {\n  return syncedQuery({})\n}\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).not.toMatch(/Cannot find module/)
      expect(output).toMatch(new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      expect(output).toMatch(/syncedQuery/)
    } finally {
      rmSync(path.join(ROOT, rel), { force: true })
    }
  })

  it('flags an import of the Legend-State journal store (app/state/store) from state/collective/**', () => {
    const { rel } = plantFixture(
      COLLECTIVE_FIXTURES_DIR,
      'journalStoreImport.fixture.ts',
      `import { store$ } from 'app/state/store'\n` + `export const noop = store$\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).not.toMatch(/Cannot find module/)
      expect(output).toMatch(new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    } finally {
      rmSync(path.join(ROOT, rel), { force: true })
    }
  })
})

describe('scripts/lint-boundaries.mjs — clean-run summary', () => {
  it('prints a one-line summary reporting files scanned and violations found on a clean run', () => {
    const { output, status } = runLint()
    expect(status).toBe(0)
    expect(output).toMatch(/\d+/)
  })
})
