/**
 * lintPosthogAbsence.e2e.test.ts — E2E spec for the inverted CI guard,
 * `scripts/lint-posthog-events.mjs`.
 *
 * The script used to validate captureEvent call sites against the analytics
 * event allowlist; with product analytics removed entirely, it now asserts the
 * NO-ANALYTICS guarantee: no posthog dependency, import, call site, or config
 * token anywhere in the tree. This is a true end-to-end test of the script AS
 * CI runs it: `node scripts/lint-posthog-events.mjs` is shelled out to as a
 * real child process against the real repository tree. Fixture `.fixture.ts`
 * files that intentionally violate the guarantee are planted immediately
 * before each test under a scratch directory INSIDE the scanner's scan scope
 * and are ALWAYS removed in a finally/afterAll block — never left behind.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const LINT_SCRIPT_REL = 'scripts/lint-posthog-events.mjs'

// Scratch dir lives INSIDE packages/ so planted fixtures are inside the lint
// script's real scan scope. Fixtures are named `*.fixture.ts`, never
// `*.test.ts`, so Vitest never collects them as tests.
const FIXTURES_DIR = path.join(ROOT, 'packages/app/utils/telemetry/__lint_fixture_scratch__')

function runLint(): { status: number | null; output: string } {
  const result = spawnSync('node', [LINT_SCRIPT_REL], { cwd: ROOT, encoding: 'utf-8' })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function plantFixture(name: string, contents: string): string {
  mkdirSync(FIXTURES_DIR, { recursive: true })
  const abs = path.join(FIXTURES_DIR, name)
  writeFileSync(abs, contents)
  return abs
}

beforeAll(() => {
  rmSync(FIXTURES_DIR, { recursive: true, force: true })
})

afterAll(() => {
  rmSync(FIXTURES_DIR, { recursive: true, force: true })
})

describe('scripts/lint-posthog-events.mjs — the no-analytics guard', () => {
  it('the script file exists', () => {
    expect(existsSync(path.join(ROOT, LINT_SCRIPT_REL))).toBe(true)
  })

  it('exits 0 on the real, analytics-free tree', () => {
    const { status, output } = runLint()
    expect(output).toContain('clean')
    expect(status).toBe(0)
  })

  it('fails when a posthog import reappears in source', () => {
    try {
      plantFixture(
        'sneakyImport.fixture.ts',
        "import posthog from 'posthog-js'\nexport { posthog }\n"
      )
      const { status, output } = runLint()
      expect(status).toBe(1)
      expect(output).toContain('sneakyImport.fixture.ts')
    } finally {
      rmSync(FIXTURES_DIR, { recursive: true, force: true })
    }
  })

  it('fails when a captureEvent( call shape reappears (outside comments/strings)', () => {
    try {
      plantFixture(
        'sneakyCall.fixture.ts',
        'declare function captureEvent(e: string): void\nexport function f() {\n  captureEvent("flow_started")\n}\n'
      )
      const { status, output } = runLint()
      expect(status).toBe(1)
      expect(output).toContain('sneakyCall.fixture.ts')
    } finally {
      rmSync(FIXTURES_DIR, { recursive: true, force: true })
    }
  })

  it('fails when an emitServerEvent( call shape reappears', () => {
    try {
      plantFixture(
        'sneakyServerCall.fixture.ts',
        'declare function emitServerEvent(e: string): void\nexport function f() {\n  emitServerEvent("x")\n}\n'
      )
      const { status } = runLint()
      expect(status).toBe(1)
    } finally {
      rmSync(FIXTURES_DIR, { recursive: true, force: true })
    }
  })

  it('fails when a POSTHOG config token reappears in source', () => {
    try {
      plantFixture(
        'sneakyEnv.fixture.ts',
        'export const key = process.env.NEXT_PUBLIC_POSTHOG_KEY\n'
      )
      const { status } = runLint()
      expect(status).toBe(1)
    } finally {
      rmSync(FIXTURES_DIR, { recursive: true, force: true })
    }
  })

  it('does NOT fail on a comment or string merely naming the banned call (no false positives)', () => {
    try {
      plantFixture(
        'benignMention.fixture.ts',
        "// captureEvent( used to live here; emitServerEvent( too\nexport const note = 'captureEvent(x) is gone'\n"
      )
      const { status } = runLint()
      expect(status).toBe(0)
    } finally {
      rmSync(FIXTURES_DIR, { recursive: true, force: true })
    }
  })

  it('fails when a posthog package sneaks into a package.json dependency map', () => {
    const pkgDir = path.join(FIXTURES_DIR, 'sneaky-pkg')
    try {
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'sneaky-pkg', dependencies: { 'posthog-js': '1.0.0' } })
      )
      const { status, output } = runLint()
      expect(status).toBe(1)
      expect(output).toContain('posthog-js')
    } finally {
      rmSync(FIXTURES_DIR, { recursive: true, force: true })
    }
  })
})
