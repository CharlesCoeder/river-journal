#!/usr/bin/env node
/**
 * lint-forward-only-migrations.mjs — the custom forward-only migration linter
 * that migrations.yml runs BEFORE `supabase db push`, as the repo's only
 * structural guarantee (NFR37) that a migration never ships a reversible /
 * down-migration section or an outright destructive schema operation without
 * deliberate human sign-off.
 *
 * `supabase db lint` validates SQL correctness, NOT directionality — this
 * check is orthogonal to it. Repo convention: migrations are
 * `<YYYYMMDDHHMMSS>_<name>.sql`, forward-only, and "reversals are new forward
 * migrations." This linter fails closed on:
 *
 *   1. A structured DOWN / REVERSE migration marker (`-- +migrate Down`,
 *      `-- +goose Down`, `-- +migrate:down`, …). These are directional
 *      section markers, not prose — a comment merely containing the word
 *      "rollback" is deliberately NOT matched.
 *   2. A destructive `DROP TABLE` or `ALTER TABLE ... DROP COLUMN` statement
 *      (data loss). A legitimate `DROP CONSTRAINT` / `DROP CONSTRAINT IF
 *      EXISTS` (constraint replacement, forward-only) is deliberately NOT
 *      matched.
 *
 * Scan root is the FLAT `supabase/migrations/` directory (all real migrations
 * are flat, timestamp-prefixed `*.sql` files). Fails closed (exit 2) if the
 * migrations directory is missing/empty rather than passing vacuously.
 *
 * Exit code 0 when clean, 1 on any violation, 2 on a crash / empty input.
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')
const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations')

// Structured directional DOWN markers (goose / sql-migrate style). The leading
// `+` is required so ordinary prose comments mentioning "down" or "rollback"
// are not matched. Runs against RAW lines (the marker IS itself a comment).
const DOWN_MARKER_RE = /--\s*\+\s*(?:migrate|goose)\s*:?\s*down\b/i

// Destructive schema ops (run against comment/string-stripped code). DROP
// TABLE and DROP COLUMN destroy data; DROP CONSTRAINT does not and is allowed.
const DROP_TABLE_RE = /\bDROP\s+TABLE\b/i
const DROP_COLUMN_RE = /\bDROP\s+COLUMN\b/i

function toPosix(p) {
  return p.split(path.sep).join('/')
}

/**
 * Strip `--` line comments (outside string literals) and blank string-literal
 * contents, so the destructive-op checks never trip on a DROP mentioned in a
 * comment or a quoted string. Conservative single-line neutralizer.
 */
function stripSqlLine(line) {
  let code = ''
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === '-' && line[i + 1] === '-') {
      break // rest of the line is a SQL comment
    }
    code += ch
  }
  return code
}

function main() {
  let entries
  try {
    entries = readdirSync(MIGRATIONS_DIR)
  } catch {
    // eslint-disable-next-line no-console
    console.error(
      `lint:forward-only-migrations FAILED — cannot read migrations directory ` +
        `${toPosix(path.relative(ROOT, MIGRATIONS_DIR))} (fail-closed).`
    )
    process.exit(2)
  }

  const sqlFiles = entries.filter((n) => n.endsWith('.sql')).sort()

  if (sqlFiles.length === 0) {
    // eslint-disable-next-line no-console
    console.error(
      `lint:forward-only-migrations FAILED — no *.sql migrations found under ` +
        `supabase/migrations/ (fail-closed; refusing to pass on empty input).`
    )
    process.exit(2)
  }

  const violations = []

  for (const name of sqlFiles) {
    const abs = path.join(MIGRATIONS_DIR, name)
    let text
    try {
      text = readFileSync(abs, 'utf-8')
    } catch {
      continue
    }
    const rel = `supabase/migrations/${name}`
    const lines = text.split(/\r?\n/)

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      const lineNo = i + 1

      if (DOWN_MARKER_RE.test(raw)) {
        violations.push(
          `${rel}:${lineNo}: forward-only violation — a down/reverse migration marker ` +
            `is not allowed. Reversals must be new forward migrations.`
        )
      }

      const code = stripSqlLine(raw)
      if (DROP_TABLE_RE.test(code)) {
        violations.push(
          `${rel}:${lineNo}: destructive DROP TABLE is not allowed in an automatic ` +
            `forward-only apply — it destroys data. Requires deliberate human sign-off.`
        )
      }
      if (DROP_COLUMN_RE.test(code)) {
        violations.push(
          `${rel}:${lineNo}: destructive DROP COLUMN is not allowed in an automatic ` +
            `forward-only apply — it destroys data. Requires deliberate human sign-off.`
        )
      }
    }
  }

  if (violations.length > 0) {
    for (const v of violations) {
      // eslint-disable-next-line no-console
      console.error(`✗ ${v}`)
    }
    // eslint-disable-next-line no-console
    console.error(
      `\nlint:forward-only-migrations FAILED — ${violations.length} violation(s) ` +
        `across ${sqlFiles.length} migration file(s).`
    )
    process.exit(1)
  }

  // eslint-disable-next-line no-console
  console.log(
    `lint:forward-only-migrations OK — scanned ${sqlFiles.length} migration ` +
      `file(s); 0 violations.`
  )
  process.exit(0)
}

try {
  main()
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('lint:forward-only-migrations crashed:', err)
  process.exit(2)
}
