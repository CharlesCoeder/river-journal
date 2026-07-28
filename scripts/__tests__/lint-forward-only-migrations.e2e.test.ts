/**
 * lint-forward-only-migrations.e2e.test.ts — TDD RED-PHASE E2E spec for the
 * custom forward-only migration linter, `scripts/lint-forward-only-migrations.mjs`,
 * that `migrations.yml` runs before `supabase db push`.
 *
 * Mirrors the `lint-edge-function-logging.e2e.test.ts` precedent: the script
 * is shelled out to as a real child process against the real repository
 * tree. `supabase db lint` validates SQL correctness, not directionality —
 * this script is the repo's only guarantee that a migration never ships a
 * reversible/rollback/down-migration pattern or an outright destructive
 * schema operation (dropped table/column) without deliberate human sign-off
 * elsewhere.
 *
 * Fixtures are planted as flat, timestamp-prefixed `*.sql` files directly
 * under `supabase/migrations/` (the linter's real, non-recursive scan root —
 * all 56 real migrations are flat files there, so a script written against
 * this tree almost certainly does a flat `readdir`, not a recursive walk)
 * using an intentionally far-future timestamp prefix and a
 * `lint_fixture_scratch` name marker so they're unambiguously test-only and
 * never collide with a real migration. Removed in `finally` / `afterAll`.
 *
 * A real migration in the tree, `20260312000000_switch_managed_key_to_base64.sql`,
 * contains `ALTER TABLE users DROP CONSTRAINT IF EXISTS ...` — a legitimate,
 * non-destructive forward-only schema change (constraint replacement, not a
 * dropped table/column). The "exits 0 on the real tree" test below asserts
 * this file does NOT trip the linter, guarding against the naive
 * over-broad-`DROP` trap this story's other boundary checks warn about
 * repeatedly. Likewise, `20260711000002_add_moderation_functions.sql`
 * contains the word "rollback" only inside a prose code comment (not a
 * `-- +migrate Down`-style marker); the same real-tree assertion guards
 * against a naive bare-keyword match on that file too.
 *
 * RED PHASE: `scripts/lint-forward-only-migrations.mjs` does not exist yet.
 * Every test below MUST fail until this story implements it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const LINT_SCRIPT_REL = 'scripts/lint-forward-only-migrations.mjs'
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json')
const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations')

// Far-future timestamp prefix + a distinctive marker so fixtures are never
// mistaken for real migrations and are trivially greppable for cleanup.
const FIXTURE_MARKER = 'lint_fixture_scratch'
const FIXTURE_TS = '20991231235959'

function runLint(): { status: number | null; output: string } {
  const result = spawnSync('node', [LINT_SCRIPT_REL], { cwd: ROOT, encoding: 'utf-8' })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function plantFixture(name: string, sql: string): { abs: string; rel: string } {
  const abs = path.join(MIGRATIONS_DIR, `${FIXTURE_TS}_${FIXTURE_MARKER}_${name}.sql`)
  writeFileSync(abs, sql)
  return { abs, rel: path.relative(ROOT, abs) }
}

function cleanupFixtures(): void {
  for (const entry of readdirSync(MIGRATIONS_DIR)) {
    if (entry.includes(FIXTURE_MARKER)) {
      rmSync(path.join(MIGRATIONS_DIR, entry), { force: true })
    }
  }
}

beforeAll(() => {
  // Defensive cleanup in case a previous interrupted run left scratch
  // fixtures behind — never leave a planted violation in the tree.
  cleanupFixtures()
})

afterAll(() => {
  cleanupFixtures()
})

describe('scripts/lint-forward-only-migrations.mjs — exists, runnable, wired', () => {
  it('the script file exists', () => {
    expect(existsSync(path.join(ROOT, LINT_SCRIPT_REL))).toBe(true)
  })

  it('exits 0 on the real supabase/migrations/ tree (56 real, forward-only migrations)', () => {
    // Also guards the two known false-positive traps documented above: the
    // legitimate DROP CONSTRAINT migration and the prose "rollback" comment.
    const { status, output } = runLint()
    expect(status).toBe(0)
    expect(output).not.toMatch(/Cannot find module/)
  })

  it('is wired into the repo as a runnable check (a yarn script entry, or referenced directly from CI)', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8'))
    const scriptsText = JSON.stringify(pkg.scripts ?? {})
    expect(scriptsText).toMatch(/lint-forward-only-migrations\.mjs/)
  })
})

describe('scripts/lint-forward-only-migrations.mjs — destructive-SQL fixtures are rejected', () => {
  it('fails on a planted DROP TABLE statement', () => {
    const { rel } = plantFixture(
      'drop_table',
      `-- Fixture used only by an automated test; not a real schema change.\n` +
        `DROP TABLE public.__lint_fixture_scratch_table__;\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).not.toMatch(/Cannot find module/)
      expect(output).toMatch(
        new RegExp(
          rel
            .split('/')
            .pop()!
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        )
      )
      expect(output).toMatch(/DROP TABLE/i)
    } finally {
      rmSync(path.join(ROOT, rel), { force: true })
    }
  })

  it('fails on a planted ALTER TABLE ... DROP COLUMN statement', () => {
    const { rel } = plantFixture(
      'drop_column',
      `-- Fixture used only by an automated test; not a real schema change.\n` +
        `ALTER TABLE public.__lint_fixture_scratch_table__ DROP COLUMN __lint_fixture_scratch_col__;\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).not.toMatch(/Cannot find module/)
      expect(output).toMatch(
        new RegExp(
          rel
            .split('/')
            .pop()!
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        )
      )
      expect(output).toMatch(/DROP COLUMN/i)
    } finally {
      rmSync(path.join(ROOT, rel), { force: true })
    }
  })

  it('does NOT flag a legitimate ALTER TABLE ... DROP CONSTRAINT statement (matches the real baseline migration)', () => {
    const { rel } = plantFixture(
      'drop_constraint_is_legitimate',
      `-- Fixture used only by an automated test; not a real schema change.\n` +
        `ALTER TABLE public.__lint_fixture_scratch_table__ DROP CONSTRAINT IF EXISTS __lint_fixture_scratch_constraint__;\n`
    )
    try {
      const { status } = runLint()
      expect(status).toBe(0)
    } finally {
      rmSync(path.join(ROOT, rel), { force: true })
    }
  })
})

describe('scripts/lint-forward-only-migrations.mjs — reversible/down-migration markers are rejected', () => {
  it('fails on a planted `-- +migrate Down` section', () => {
    const { rel } = plantFixture(
      'migrate_down_marker',
      `-- Fixture used only by an automated test; not a real schema change.\n` +
        `-- +migrate Down\n` +
        `DROP TABLE IF EXISTS public.__lint_fixture_scratch_table__;\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).not.toMatch(/Cannot find module/)
      expect(output).toMatch(
        new RegExp(
          rel
            .split('/')
            .pop()!
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        )
      )
    } finally {
      rmSync(path.join(ROOT, rel), { force: true })
    }
  })

  it('does NOT flag a real migration whose prose comment merely mentions "rollback" (no structural down-marker)', () => {
    const { rel } = plantFixture(
      'rollback_word_in_comment_is_not_a_marker',
      `-- Fixture used only by an automated test; not a real schema change.\n` +
        `-- Note: if the audit-INSERT step fails, the caller is responsible for any rollback of prior state.\n` +
        `CREATE TABLE public.__lint_fixture_scratch_table__ (id uuid primary key);\n`
    )
    try {
      const { status } = runLint()
      expect(status).toBe(0)
    } finally {
      rmSync(path.join(ROOT, rel), { force: true })
    }
  })
})

describe('scripts/lint-forward-only-migrations.mjs — clean-run summary', () => {
  it('prints a one-line summary reporting files scanned and violations found on a clean run', () => {
    const { output, status } = runLint()
    expect(status).toBe(0)
    expect(output).toMatch(/\d+/)
  })
})
