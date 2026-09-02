/**
 * vitest.globalSetup.mts — runs ONCE per `vitest` invocation, before any test
 * file is collected.
 *
 * Sole job: purge scratch migration fixtures that a previous INTERRUPTED run
 * (Ctrl-C, a killed CI job) left behind in the real `supabase/migrations/`
 * tree.
 *
 * Why this cannot live in the test file that plants them:
 * `lint-forward-only-migrations.e2e.test.ts` plants deliberately-invalid
 * migrations in the real tree to prove the linter rejects them, and cleans up
 * in `beforeAll`/`afterAll`. But OTHER files shell the same linter against the
 * whole tree and assert it exits 0 (e.g.
 * `operational-health-cron-migration.e2e.test.ts`). File execution order is not
 * guaranteed, so if a stray fixture survives an interrupt and the asserting
 * file runs FIRST, it lints a polluted tree and fails with a completely
 * unrelated-looking error. Purging once, globally, before anything runs closes
 * that window regardless of ordering.
 *
 * Fixtures are identified by a unique marker in the filename, so this can never
 * touch a real migration.
 */

import { readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

// Must match `FIXTURE_MARKER` in scripts/__tests__/lint-forward-only-migrations.e2e.test.ts.
const FIXTURE_MARKER = 'lint_fixture_scratch'
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, 'supabase/migrations')

export default function setup(): void {
  let entries: string[]
  try {
    entries = readdirSync(MIGRATIONS_DIR)
  } catch {
    // No migrations dir in this checkout — nothing to purge.
    return
  }

  for (const entry of entries) {
    if (entry.includes(FIXTURE_MARKER)) {
      rmSync(path.join(MIGRATIONS_DIR, entry), { force: true })
    }
  }
}
