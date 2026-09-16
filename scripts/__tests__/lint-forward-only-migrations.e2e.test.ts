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
 * Fixtures are planted as flat, timestamp-prefixed `*.sql` files in an
 * ISOLATED COPY of `supabase/migrations/` (a temp dir seeded with every real
 * migration), and the linter is pointed at it with `--migrations-dir`. They
 * are never written into the real directory: other test files spawn the
 * linter against the real tree, and Vitest runs files in parallel forks, so
 * a fixture planted there flaked those files. The far-future timestamp
 * prefix + `lint_fixture_scratch` marker keep fixtures unambiguous even in
 * the copy. The "real tree lints clean" test runs with no flag.
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
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const LINT_SCRIPT_REL = 'scripts/lint-forward-only-migrations.mjs'
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json')
const REAL_MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations')

// Far-future timestamp prefix + a distinctive marker so fixtures are never
// mistaken for real migrations and are trivially greppable for cleanup.
const FIXTURE_MARKER = 'lint_fixture_scratch'
const FIXTURE_TS = '20991231235959'

// Isolated scan root: every real migration copied in, fixtures planted here.
let scratchDir = ''

/** Lints the real tree (no flag) or, with `isolated`, the scratch copy. */
function runLint(opts: { isolated?: boolean } = {}): { status: number | null; output: string } {
  const args = opts.isolated ? [LINT_SCRIPT_REL, '--migrations-dir', scratchDir] : [LINT_SCRIPT_REL]
  const result = spawnSync('node', args, { cwd: ROOT, encoding: 'utf-8' })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function plantFixture(name: string, sql: string): { abs: string; rel: string } {
  const abs = path.join(scratchDir, `${FIXTURE_TS}_${FIXTURE_MARKER}_${name}.sql`)
  writeFileSync(abs, sql)
  return { abs, rel: path.relative(ROOT, abs) }
}

function cleanupFixtures(): void {
  for (const entry of readdirSync(scratchDir)) {
    if (entry.includes(FIXTURE_MARKER)) {
      rmSync(path.join(scratchDir, entry), { force: true })
    }
  }
}

beforeAll(() => {
  scratchDir = mkdtempSync(path.join(tmpdir(), 'rj-forward-only-lint-'))
  for (const entry of readdirSync(REAL_MIGRATIONS_DIR)) {
    if (entry.endsWith('.sql')) {
      cpSync(path.join(REAL_MIGRATIONS_DIR, entry), path.join(scratchDir, entry))
    }
  }
})

afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('scripts/lint-forward-only-migrations.mjs — exists, runnable, wired', () => {
  it('the script file exists', () => {
    expect(existsSync(path.join(ROOT, LINT_SCRIPT_REL))).toBe(true)
  })

  it('exits 0 on the real supabase/migrations/ tree (56 real, forward-only migrations)', () => {
    // Also guards the two known false-positive traps documented above: the
    // legitimate DROP CONSTRAINT migration and the prose "rollback" comment.
    const { status, output } = runLint({ isolated: false })
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
      const { status, output } = runLint({ isolated: true })
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
      const { status, output } = runLint({ isolated: true })
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
      const { status } = runLint({ isolated: true })
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
      const { status, output } = runLint({ isolated: true })
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
      const { status } = runLint({ isolated: true })
      expect(status).toBe(0)
    } finally {
      rmSync(path.join(ROOT, rel), { force: true })
    }
  })
})

describe('scripts/lint-forward-only-migrations.mjs — clean-run summary', () => {
  it('prints a one-line summary reporting files scanned and violations found on a clean run', () => {
    const { output, status } = runLint({ isolated: false })
    expect(status).toBe(0)
    expect(output).toMatch(/\d+/)
  })
})

// ─── Hardening: forms the original line-by-line, two-regex linter missed ─────

/**
 * Plants one fixture, runs the linter, removes the fixture, and returns the
 * result. Every case below is a real migration-time destruction vector (or a
 * legitimate look-alike that must NOT be flagged).
 */
function lintFixture(name: string, sql: string): { status: number | null; output: string } {
  const { rel } = plantFixture(name, sql)
  try {
    return runLint({ isolated: true })
  } finally {
    rmSync(path.join(ROOT, rel), { force: true })
  }
}

const HEADER = `-- Fixture used only by an automated test; not a real schema change.\n`

describe('scripts/lint-forward-only-migrations.mjs — evasions of the naive per-line regexes are rejected', () => {
  it('fails on DROP TABLE split across two lines', () => {
    const { status, output } = lintFixture(
      'multiline_drop',
      `${HEADER}DROP\n  TABLE public.__lint_fixture_scratch_table__;\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/\[drop-table\]/)
  })

  it('fails on DROP TABLE with a block comment between the keywords', () => {
    const { status, output } = lintFixture(
      'block_comment_drop',
      `${HEADER}DROP /* nothing to see */ TABLE public.__lint_fixture_scratch_table__;\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/\[drop-table\]/)
  })

  it('fails on DROP TABLE with a line comment between the keywords', () => {
    const { status, output } = lintFixture(
      'line_comment_drop',
      `${HEADER}DROP -- what could go wrong\n  TABLE public.__lint_fixture_scratch_table__;\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/\[drop-table\]/)
  })

  it('fails on ALTER TABLE ... DROP <col> without the optional COLUMN keyword', () => {
    const { status, output } = lintFixture(
      'drop_col_no_keyword',
      `${HEADER}ALTER TABLE public.__lint_fixture_scratch_table__ DROP __lint_fixture_scratch_col__;\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/\[drop-column\]/)
  })

  it('fails on ALTER TABLE ... DROP COLUMN IF EXISTS', () => {
    const { status, output } = lintFixture(
      'drop_col_if_exists',
      `${HEADER}ALTER TABLE public.__lint_fixture_scratch_table__ DROP COLUMN IF EXISTS __lint_fixture_scratch_col__;\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/\[drop-column\]/)
  })

  it('fails on a multi-action ALTER TABLE that hides a DROP COLUMN after a DROP CONSTRAINT', () => {
    const { status, output } = lintFixture(
      'drop_col_after_constraint',
      `${HEADER}ALTER TABLE public.__lint_fixture_scratch_table__\n  DROP CONSTRAINT IF EXISTS __c__,\n  DROP COLUMN __lint_fixture_scratch_col__;\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/\[drop-column\]/)
  })

  it('fails on TRUNCATE', () => {
    const { status, output } = lintFixture(
      'truncate',
      `${HEADER}TRUNCATE public.__lint_fixture_scratch_table__;\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/\[truncate\]/)
  })

  it('fails on DROP SCHEMA ... CASCADE', () => {
    const { status, output } = lintFixture(
      'drop_schema',
      `${HEADER}DROP SCHEMA IF EXISTS __lint_fixture_scratch__ CASCADE;\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/\[drop-schema\]/)
  })

  it('fails on a top-level DELETE FROM with no WHERE clause', () => {
    const { status, output } = lintFixture(
      'delete_all',
      `${HEADER}DELETE FROM public.__lint_fixture_scratch_table__;\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/\[delete-all\]/)
  })

  it('fails on a DO block that EXECUTEs a DROP TABLE hidden in a string literal', () => {
    const { status, output } = lintFixture(
      'do_execute_drop',
      `${HEADER}DO $$\nBEGIN\n  EXECUTE 'DROP TABLE public.__lint_fixture_scratch_table__';\nEND\n$$;\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/\[drop-table\]/)
    expect(output).toMatch(/\[dynamic-sql\]/)
  })

  it('fails on a DO block that EXECUTEs dynamic SQL the linter cannot see (format())', () => {
    const { status, output } = lintFixture(
      'do_execute_format',
      `${HEADER}DO $$\nBEGIN\n  EXECUTE format('%s %s %I', 'DR' || 'OP', 'TABLE', 'x');\nEND\n$$;\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/\[dynamic-sql\]/)
  })

  it('fails when a function defined in the file with a destructive body is called from the same file', () => {
    const { status, output } = lintFixture(
      'destructive_fn_called',
      `${HEADER}CREATE OR REPLACE FUNCTION __lint_fixture_scratch_fn__() RETURNS VOID LANGUAGE plpgsql AS $$\nBEGIN\n  TRUNCATE public.__lint_fixture_scratch_table__;\nEND\n$$;\nSELECT __lint_fixture_scratch_fn__();\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/\[destructive-function-call\]/)
  })
})

describe('scripts/lint-forward-only-migrations.mjs — legitimate look-alikes are NOT flagged', () => {
  it('ignores DROP TABLE inside a block comment', () => {
    const { status } = lintFixture(
      'drop_in_block_comment',
      `${HEADER}/* we considered DROP TABLE here but did not */\nCREATE TABLE public.__lint_fixture_scratch_table__ (id uuid primary key);\n`
    )
    expect(status).toBe(0)
  })

  it('ignores DROP TABLE inside a top-level string literal', () => {
    const { status } = lintFixture(
      'drop_in_string',
      `${HEADER}CREATE TABLE public.__lint_fixture_scratch_table__ (id uuid primary key);\nCOMMENT ON TABLE public.__lint_fixture_scratch_table__ IS 'never DROP TABLE this; it''s the audit log';\n`
    )
    expect(status).toBe(0)
  })

  it('ignores ALTER COLUMN ... DROP NOT NULL / DROP DEFAULT (matches a real baseline migration)', () => {
    const { status } = lintFixture(
      'drop_not_null',
      `${HEADER}ALTER TABLE public.__lint_fixture_scratch_table__\n  ALTER COLUMN __c__ DROP DEFAULT,\n  ALTER COLUMN __c__ DROP NOT NULL;\n`
    )
    expect(status).toBe(0)
  })

  it('ignores a DELETE FROM that has a WHERE clause', () => {
    const { status } = lintFixture(
      'delete_where',
      `${HEADER}DELETE FROM public.__lint_fixture_scratch_table__ WHERE created_at < NOW() - INTERVAL '1 day';\n`
    )
    expect(status).toBe(0)
  })

  it('ignores DELETE / DROP inside a function body that this file does not call (runs at call time, not apply time)', () => {
    const { status } = lintFixture(
      'fn_body_only',
      `${HEADER}CREATE OR REPLACE FUNCTION __lint_fixture_scratch_fn__(p_user_id UUID) RETURNS VOID LANGUAGE plpgsql AS $$\nBEGIN\n  DELETE FROM public.__lint_fixture_scratch_table__ WHERE user_id = p_user_id;\n  DROP TABLE IF EXISTS pg_temp.__scratch__;\nEND\n$$;\n`
    )
    expect(status).toBe(0)
  })

  it('ignores a DO block with no EXECUTE and no destructive statement (matches real baseline migrations)', () => {
    const { status } = lintFixture(
      'do_plain',
      `${HEADER}DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN\n    RAISE NOTICE 'skip';\n  END IF;\nEND\n$$;\n`
    )
    expect(status).toBe(0)
  })
})

describe('scripts/lint-forward-only-migrations.mjs — the annotated escape hatch for an owner-approved destructive change', () => {
  const ALLOW = `-- destructive-migration: allow drop-table because the table was replaced by a view in the previous migration and is empty\n`

  it('passes a DROP TABLE that carries a matching allowance with a real justification, and says so in the output', () => {
    const { status, output } = lintFixture(
      'allowed_drop',
      `${HEADER}${ALLOW}DROP TABLE public.__lint_fixture_scratch_table__;\n`
    )
    expect(status).toBe(0)
    expect(output).toMatch(/allowed by annotation/)
    expect(output).toMatch(/1 annotated allowance/)
  })

  it('an allowance covers only its own rule id — a DROP COLUMN in the same file still fails', () => {
    const { status, output } = lintFixture(
      'allowed_wrong_rule',
      `${HEADER}${ALLOW}DROP TABLE public.__lint_fixture_scratch_table__;\nALTER TABLE public.__other__ DROP COLUMN __c__;\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/\[drop-column\]/)
    expect(output).not.toMatch(/✗.*\[drop-table\]/)
  })

  it('an allowance covers only its own file — a DROP TABLE in another file still fails', () => {
    const a = plantFixture(
      'allowed_file_a',
      `${HEADER}${ALLOW}DROP TABLE public.__lint_fixture_scratch_table__;\n`
    )
    const b = plantFixture(
      'unallowed_file_b',
      `${HEADER}DROP TABLE public.__lint_fixture_scratch_table_b__;\n`
    )
    try {
      const { status, output } = runLint({ isolated: true })
      expect(status).toBe(1)
      expect(output).toMatch(/unallowed_file_b.*\[drop-table\]/)
      expect(output).not.toMatch(/✗.*allowed_file_a/)
    } finally {
      rmSync(a.abs, { force: true })
      rmSync(b.abs, { force: true })
    }
  })

  it('rejects an allowance whose justification is too short to mean anything', () => {
    const { status, output } = lintFixture(
      'allowed_short_reason',
      `${HEADER}-- destructive-migration: allow drop-table because ok\nDROP TABLE public.__lint_fixture_scratch_table__;\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/needs a real justification/)
  })

  it('rejects a stale allowance that nothing in the file triggers (no copy-paste rubber stamps)', () => {
    const { status, output } = lintFixture(
      'allowed_stale',
      `${HEADER}${ALLOW}CREATE TABLE public.__lint_fixture_scratch_table__ (id uuid primary key);\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/stale destructive-migration allowance/)
  })

  it('rejects an unknown rule id', () => {
    const { status, output } = lintFixture(
      'allowed_unknown',
      `${HEADER}-- destructive-migration: allow everything because I said so and this is long enough\nDROP TABLE public.__lint_fixture_scratch_table__;\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/unknown destructive-migration rule id/)
  })

  it('a down-migration marker can never be allowed', () => {
    const { status, output } = lintFixture(
      'allowed_down_marker',
      `${HEADER}-- destructive-migration: allow drop-table because this fixture also tries to allow a down marker\n-- +migrate Down\nDROP TABLE public.__lint_fixture_scratch_table__;\n`
    )
    expect(status).toBe(1)
    expect(output).toMatch(/down\/reverse migration marker/)
  })
})
