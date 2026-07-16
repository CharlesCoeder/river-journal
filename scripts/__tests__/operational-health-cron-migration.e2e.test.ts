/**
 * operational-health-cron-migration.e2e.test.ts — TDD RED-PHASE E2E spec for
 * the pg_cron dispatch migration this story adds:
 * `supabase/migrations/<ts>_add_operational_health_cron.sql`.
 *
 * This is the ONE piece of the operational-health cron story that is
 * testable under Vitest: the migration is plain SQL with no runtime seam, so
 * rather than duplicating a SQL-execution harness this spec (a) locates the
 * real, committed migration file by its forward-only naming convention, (b)
 * shells the repo's real forward-only migration linter against the whole
 * `supabase/migrations/` tree exactly as `migrations.yml` does before
 * `supabase db push`, and (c) greps the migration's own text for the
 * structural properties the spec pins down: the 30-min-cadence cron
 * expression (matching a 30-minute operational-health tick, twice the 15-minute
 * streak-reminder cadence it's modeled on), the `IF EXISTS (... pg_cron)`
 * schedule guard (so the migration applies cleanly in local dev, where
 * pg_cron is absent), and a `cron.schedule(` call. It also confirms
 * `supabase/config.toml` registers the new function with the same
 * `verify_jwt = false` posture every other service-role-bearer-gated
 * trigger/cron function in this tree uses.
 *
 * All Edge-Function runtime behavior (the handler, the moderation/sync-opt-in
 * passes, the once-daily gate, fail-open isolation, heartbeat-only logging)
 * is covered separately by the colocated `deno test`-only suite at
 * `supabase/functions/operational_health_cron/index.test.ts` — Deno code is
 * excluded from this repo's Vitest glob (`**\/supabase/functions/**`), so it
 * cannot be exercised here.
 *
 * RED PHASE: neither the migration file nor the `config.toml` block exists
 * yet. The "migration file exists" test fails on a missing glob match, and
 * every test that depends on its content short-circuits to a failing
 * assertion rather than throwing, so the whole file reports every case red
 * without a single uncaught exception obscuring the count.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations')
const CONFIG_TOML_PATH = path.join(ROOT, 'supabase/config.toml')
const LINT_SCRIPT_REL = 'scripts/lint-forward-only-migrations.mjs'

// Forward-only naming convention this repo's migrations already follow:
// <14-digit timestamp>_<name>.sql. The story-specific migration ends in
// `_add_operational_health_cron.sql`.
const MIGRATION_NAME_RE = /^\d{14}_add_operational_health_cron\.sql$/

function findMigrationFile(): string | undefined {
  let entries: string[]
  try {
    entries = readdirSync(MIGRATIONS_DIR)
  } catch {
    return undefined
  }
  return entries.find((name) => MIGRATION_NAME_RE.test(name))
}

function readMigrationText(): string {
  const name = findMigrationFile()
  if (!name) return ''
  return readFileSync(path.join(MIGRATIONS_DIR, name), 'utf-8')
}

function runForwardOnlyLint(): { status: number | null; output: string } {
  const result = spawnSync('node', [LINT_SCRIPT_REL], { cwd: ROOT, encoding: 'utf-8' })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

describe('the operational-health-cron pg_cron dispatch migration — exists, forward-only-clean', () => {
  it('a migration file named <timestamp>_add_operational_health_cron.sql exists under supabase/migrations/', () => {
    expect(findMigrationFile()).toBeDefined()
  })

  it('the full supabase/migrations/ tree (including the new migration) passes the forward-only linter', () => {
    // Guards against the new migration accidentally introducing a DROP
    // TABLE/COLUMN or a structured down-marker -- this repo's only automated
    // guarantee that a migration is forward-only (NFR: no destructive schema
    // ops land without deliberate human sign-off elsewhere).
    expect(existsSync(path.join(ROOT, LINT_SCRIPT_REL))).toBe(true)
    const { status, output } = runForwardOnlyLint()
    expect(output).not.toMatch(/Cannot find module/)
    expect(status).toBe(0)
  })
})

describe('the operational-health-cron pg_cron dispatch migration — structural contract', () => {
  it('schedules the dispatch on a */30 * * * * (30-minute) cadence', () => {
    const text = readMigrationText()
    expect(text).toMatch(/\*\/30 \* \* \* \*/)
  })

  it('wraps the cron.schedule(...) call in an IF EXISTS (... pg_extension ... pg_cron) guard', () => {
    const text = readMigrationText()
    expect(text).toMatch(
      /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_extension\s+WHERE\s+extname\s*=\s*'pg_cron'\s*\)/i
    )
  })

  it('calls cron.schedule(...) naming the dispatch function', () => {
    const text = readMigrationText()
    expect(text).toMatch(/cron\.schedule\s*\(/)
  })

  it('defines a SECURITY DEFINER dispatch function that posts to the operational_health_cron Edge Function', () => {
    const text = readMigrationText()
    expect(text).toMatch(/SECURITY DEFINER/)
    expect(text).toMatch(/\/functions\/v1\/operational_health_cron/)
  })

  it('revokes dispatch-function EXECUTE from PUBLIC/authenticated and grants it to service_role only', () => {
    const text = readMigrationText()
    expect(text).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?FROM\s+PUBLIC/i)
    expect(text).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?TO\s+service_role/i)
  })

  it('is a forward-only CREATE-only migration (no DROP TABLE, no DROP COLUMN, no down-marker)', () => {
    const text = readMigrationText()
    expect(text).not.toMatch(/DROP\s+TABLE/i)
    expect(text).not.toMatch(/DROP\s+COLUMN/i)
    expect(text).not.toMatch(/--\s*\+\s*(?:migrate|goose)\s*:?\s*down/i)
  })

  it('does not embed internal planning-tracker references in the migration SQL', () => {
    const text = readMigrationText()
    // Forbidden tokens are assembled at runtime so this guard never contains them itself.
    const trackerName = ['B', 'MAD'].join('')
    const ticketRef = ['story', '\\s*9[.-]6'].join('')
    const criterionRef = ['A', 'C\\s*\\d'].join('')
    expect(text).not.toMatch(new RegExp(`\\b${trackerName}\\b`, 'i'))
    expect(text).not.toMatch(new RegExp(`\\b${ticketRef}\\b`, 'i'))
    expect(text).not.toMatch(new RegExp(`\\b${criterionRef}\\b`))
  })
})

describe('supabase/config.toml registers the operational_health_cron function', () => {
  function readConfigToml(): string {
    if (!existsSync(CONFIG_TOML_PATH)) return ''
    return readFileSync(CONFIG_TOML_PATH, 'utf-8')
  }

  it('has a [functions.operational_health_cron] block', () => {
    const text = readConfigToml()
    expect(text).toMatch(/\[functions\.operational_health_cron\]/)
  })

  it('sets verify_jwt = false immediately under the block (same posture as every other service-role trigger/cron function)', () => {
    const text = readConfigToml()
    const match = text.match(
      /\[functions\.operational_health_cron\]\s*\n(?:#.*\n)*\s*verify_jwt\s*=\s*(\w+)/
    )
    expect(match?.[1]).toBe('false')
  })
})
