/**
 * lint-edge-function-logging.e2e.test.ts — TDD RED-PHASE E2E spec for the CI
 * lint check, `scripts/lint-edge-function-logging.mjs`.
 *
 * This is a true end-to-end test of the script AS an operator/CI would run
 * it: `node scripts/lint-edge-function-logging.mjs` is shelled out to as a
 * real child process against the real repository tree (mirroring the
 * `lint-posthog-events.mjs` precedent, `lintPosthogEvents.e2e.test.ts`).
 * Nothing about the lint script itself is mocked. Fixture `.fixture.ts`
 * files that intentionally violate the rules are planted immediately before
 * each test under a scratch directory INSIDE `supabase/functions/` (the
 * lint script's real scan scope) and are ALWAYS removed in a `finally` /
 * `afterAll` block — never left behind in the tree.
 *
 * Placement note: `vitest.config.mts` excludes `**\/supabase/functions/**`
 * from Vitest's test collection entirely (that whole tree is Deno code owned
 * by `deno test`). This spec file itself therefore lives under
 * `scripts/__tests__/`, NOT colocated under `supabase/functions/**`, so
 * Vitest actually collects and runs it. The scratch *fixtures* the tests
 * plant DO need to sit under `supabase/functions/` (that is what the lint
 * script scans) — that is fine and unrelated to the Vitest-collection
 * exclude because the fixtures are named `*.fixture.ts`, never `*.test.ts`,
 * so Vitest never tries to collect them as tests regardless of location.
 *
 * RED PHASE: `scripts/lint-edge-function-logging.mjs` does not exist yet.
 * Every test below MUST fail until this story is implemented — most because
 * `node` exits non-zero with a "Cannot find module" error (which still
 * satisfies "the lint fails" for tests asserting non-zero exit, but FAILS
 * the tests asserting the exact expected violation text / message content
 * and the "exits 0 on a clean tree" test, as intended).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const LINT_SCRIPT_REL = 'scripts/lint-edge-function-logging.mjs'
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json')

// Scratch dir lives INSIDE supabase/functions/_shared/ so planted fixtures
// are inside the lint script's real scan scope. `__lint_fixture_scratch__`
// is not a real shared module — it never gets imported by any function.
const FIXTURES_DIR = path.join(ROOT, 'supabase/functions/_shared/__lint_fixture_scratch__')

function runLint(): { status: number | null; output: string } {
  const result = spawnSync('node', [LINT_SCRIPT_REL], { cwd: ROOT, encoding: 'utf-8' })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/** Writes a scratch fixture file inside the scanner's scan scope and returns its absolute + repo-relative path. */
function plantFixture(name: string, contents: string): { abs: string; rel: string } {
  mkdirSync(FIXTURES_DIR, { recursive: true })
  const abs = path.join(FIXTURES_DIR, name)
  writeFileSync(abs, contents)
  return { abs, rel: path.relative(ROOT, abs) }
}

beforeAll(() => {
  // Defensive cleanup in case a previous interrupted run left scratch files
  // behind — never leave a planted violation in the tree.
  rmSync(FIXTURES_DIR, { recursive: true, force: true })
})

afterAll(() => {
  rmSync(FIXTURES_DIR, { recursive: true, force: true })
})

describe('scripts/lint-edge-function-logging.mjs — exists and is runnable', () => {
  it('the script file exists', () => {
    expect(existsSync(path.join(ROOT, LINT_SCRIPT_REL))).toBe(true)
  })

  it('exits 0 on the real, clean supabase/functions/ tree (all 7 functions + expoPush.ts already log safely)', () => {
    const { status } = runLint()
    expect(status).toBe(0)
  })
})

describe('scripts/lint-edge-function-logging.mjs — root package.json wires the yarn entry', () => {
  it('has a "lint:edge-logging" script that runs this script via node', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8'))
    expect(pkg.scripts).toBeDefined()
    expect(pkg.scripts['lint:edge-logging']).toBeDefined()
    expect(pkg.scripts['lint:edge-logging']).toContain(LINT_SCRIPT_REL)
  })
})

describe('scripts/lint-edge-function-logging.mjs — planted console.* is flagged', () => {
  it('fails with a message naming the file, the line, and the fix ("log through logInfo/logError from _shared/logging.ts")', () => {
    const { rel } = plantFixture(
      'consoleLog.fixture.ts',
      `// A fixture that intentionally violates the console.* ban.\nexport function leak(): void {\n  console.log('leak')\n}\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).not.toMatch(/Cannot find module/)
      // file:line locator for the violation.
      expect(output).toMatch(new RegExp(`${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:3`))
      // Actionable fix guidance naming the sanctioned wrappers + their home.
      expect(output).toMatch(/logInfo/)
      expect(output).toMatch(/logError/)
      expect(output).toMatch(/_shared\/logging\.ts/)
    } finally {
      rmSync(path.join(ROOT, rel), { force: true })
    }
  })

  it('flags console.error / console.warn / console.info / console.debug just like console.log', () => {
    const { rel } = plantFixture(
      'consoleVariants.fixture.ts',
      [
        'export function a(): void { console.error("x") }',
        'export function b(): void { console.warn("x") }',
        'export function c(): void { console.info("x") }',
        'export function d(): void { console.debug("x") }',
        '',
      ].join('\n')
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).not.toMatch(/Cannot find module/)
    } finally {
      rmSync(path.join(ROOT, rel), { force: true })
    }
  })
})

describe('scripts/lint-edge-function-logging.mjs — planted encryption import is flagged', () => {
  it('fails with a message naming the file, the line, and Boundary 1 guidance ("Edge Functions must never import encryption utilities")', () => {
    const { rel } = plantFixture(
      'encryptionImport.fixture.ts',
      `import { decrypt } from './utils/encryption.ts'\n\nexport function leak(): string {\n  return decrypt('x')\n}\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).not.toMatch(/Cannot find module/)
      expect(output).toMatch(new RegExp(`${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:1`))
      expect(output).toMatch(/encryption/i)
      expect(output).toMatch(/never (decrypt|import encryption)/i)
    } finally {
      rmSync(path.join(ROOT, rel), { force: true })
    }
  })

  it('also flags an encryption import with no named bindings (bare side-effect import)', () => {
    const { rel } = plantFixture(
      'encryptionSideEffectImport.fixture.ts',
      `import '../encryption.ts'\n\nexport const noop = true\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).not.toMatch(/Cannot find module/)
    } finally {
      rmSync(path.join(ROOT, rel), { force: true })
    }
  })
})

describe('scripts/lint-edge-function-logging.mjs — the exemption is exactly one file (_shared/logging.ts)', () => {
  it('a console.* call in ANY other _shared/*.ts file is still flagged (the exemption is not directory-wide)', () => {
    // Planted directly under _shared/ (sibling of the real logging.ts), not
    // inside the __lint_fixture_scratch__ subdirectory, to prove the
    // exemption is scoped to the single file "_shared/logging.ts" and not
    // to the whole _shared/ directory.
    const abs = path.join(
      ROOT,
      'supabase/functions/_shared/__lint_fixture_scratch_sibling__.fixture.ts'
    )
    writeFileSync(
      abs,
      `export function leak(): void {\n  console.log('leak from a decoy _shared file')\n}\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).not.toMatch(/Cannot find module/)
    } finally {
      rmSync(abs, { force: true })
    }
  })
})

describe('scripts/lint-edge-function-logging.mjs — false-positive guards (comments/strings) and test-file exclusion', () => {
  it('a console.*-looking occurrence inside a comment or string literal is not treated as a real violation', () => {
    const { rel } = plantFixture(
      'commentedOutConsole.fixture.ts',
      `// console.log('not a real call — just a decoy comment')\nconst note = "console.error('also not real — a decoy string')"\nexport const noop = note\n`
    )
    try {
      const { status } = runLint()
      expect(status).toBe(0)
    } finally {
      rmSync(path.join(ROOT, rel), { force: true })
    }
  })

  it('a *.test.ts file with a real console.log is excluded from the scan (test files intentionally spy on console)', () => {
    const { rel } = plantFixture(
      'decoy.test.ts',
      `export function spyDemo(): void {\n  console.log('this would be flagged in a non-test file')\n}\n`
    )
    try {
      const { status } = runLint()
      expect(status).toBe(0)
    } finally {
      rmSync(path.join(ROOT, rel), { force: true })
    }
  })
})

describe('scripts/lint-edge-function-logging.mjs — clean-run summary', () => {
  it('prints a one-line summary reporting files scanned and violations found on a clean run', () => {
    const { output, status } = runLint()
    expect(status).toBe(0)
    expect(output).toMatch(/\d+/)
  })
})
