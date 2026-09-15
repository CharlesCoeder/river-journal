#!/usr/bin/env node
/**
 * lint-forward-only-migrations.mjs — the custom forward-only migration linter
 * that migrations.yml runs BEFORE `supabase db push`, as the repo's only
 * structural guarantee that a migration never ships a reversible /
 * down-migration section or a destructive operation without deliberate,
 * visible human sign-off.
 *
 * `supabase db lint` validates SQL correctness, NOT directionality — this
 * check is orthogonal to it. Repo convention: migrations are
 * `<YYYYMMDDHHMMSS>_<name>.sql`, forward-only, and "reversals are new forward
 * migrations."
 *
 * WHAT IS REJECTED
 *
 *   1. A structured DOWN / REVERSE migration marker (`-- +migrate Down`,
 *      `-- +goose Down`, `-- +migrate:down`, …). Directional section markers
 *      only — prose merely containing "rollback" is deliberately NOT matched.
 *      Never allowable.
 *   2. Destructive migration-time SQL, by rule id:
 *        drop-table                 DROP TABLE
 *        drop-column                ALTER TABLE … DROP [COLUMN] [IF EXISTS] col
 *                                   (DROP CONSTRAINT / NOT NULL / DEFAULT /
 *                                   IDENTITY / EXPRESSION are not data loss and
 *                                   are not matched)
 *        drop-schema                DROP SCHEMA / DROP DATABASE
 *        drop-owned                 DROP OWNED BY
 *        truncate                   TRUNCATE
 *        delete-all                 a top-level DELETE FROM with no WHERE/USING
 *        dynamic-sql                EXECUTE inside a top-level DO block (the
 *                                   SQL it runs is opaque to this linter, so
 *                                   it must be signed off explicitly)
 *        destructive-function-call  a top-level SELECT/PERFORM/CALL of a
 *                                   function DEFINED IN THE SAME FILE whose
 *                                   body contains one of the patterns above
 *
 * HOW IT SCANS
 *
 *   The whole file is tokenized (not line-by-line): `--` and nested block
 *   comments are blanked, `'…'` / `"…"` literal contents are blanked, and
 *   `$tag$ … $tag$` bodies are lifted out. Statements are then matched on
 *   the remaining top-level code with whitespace-tolerant patterns, so a
 *   `DROP` split across lines or around a comment is still caught, and a
 *   `DROP TABLE` mentioned in a comment or string is not.
 *
 *   Dollar-quoted bodies are classified by what precedes them: a `DO` block
 *   runs at migration time, so its body is scanned with string contents KEPT
 *   (so `EXECUTE 'DROP TABLE x'` is visible) plus the dynamic-sql rule. A
 *   CREATE FUNCTION / PROCEDURE body runs later, at call time, and is only a
 *   migration-time hazard if this same file calls it — which is what
 *   destructive-function-call covers. A function defined here and called by
 *   a LATER migration, or from outside SQL, is out of scope by design.
 *
 * THE ESCAPE HATCH — an owner-approved destructive change
 *
 *   The gate scans the full migration history on every run (applied files
 *   are immutable, and the scan is cheap), so without an escape hatch an
 *   approved destructive migration would block the gate forever. The
 *   allowance is an in-file annotation, one line per rule id needed:
 *
 *     -- destructive-migration: allow <rule-id> because <justification>
 *
 *   Rules that keep this from becoming a rubber stamp:
 *     - the justification must be at least 20 characters of real text;
 *     - each allowance must actually be exercised in that file — an
 *       allowance for a rule that never fires is an error (stale or
 *       copy-pasted annotations fail the gate);
 *     - an unknown rule id is an error; down-markers cannot be allowed;
 *     - an allowance covers ONLY its own file and ONLY that rule id.
 *   The annotation is part of the reviewed diff, and migrations.yml still
 *   requires a human Environment approval before the apply runs, so the
 *   sign-off is visible in both places.
 *
 * Scan root is the FLAT `supabase/migrations/` directory. Fails closed (exit
 * 2) if it is missing/empty rather than passing vacuously.
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

// `-- destructive-migration: allow <rule-id> because <justification>`
const ALLOW_RE = /^\s*--\s*destructive-migration:\s*allow\s+([a-z][a-z-]*)\s+because\s+(.*)$/i
const MIN_JUSTIFICATION_CHARS = 20

// Pattern rules run against code with comments and string contents removed.
// Every regex is global + whitespace-tolerant so a keyword split across lines
// (or around a comment, which is blanked to spaces) still matches.
const PATTERN_RULES = [
  {
    id: 'drop-table',
    re: /\bDROP\s+TABLE\b/gi,
    message: 'destructive DROP TABLE destroys data',
  },
  {
    id: 'drop-column',
    // `[^;]*?` keeps the match inside one statement. The negative lookahead
    // excludes the non-destructive ALTER TABLE ... DROP forms.
    re: /\bALTER\s+TABLE\b[^;]*?\bDROP\s+(?:COLUMN\s+)?(?!CONSTRAINT\b|NOT\b|DEFAULT\b|IDENTITY\b|EXPRESSION\b)(?:IF\s+EXISTS\s+)?["\w]/gi,
    anchor: /\bDROP\b/i,
    message: 'destructive ALTER TABLE ... DROP COLUMN destroys data',
  },
  {
    id: 'drop-schema',
    re: /\bDROP\s+(?:SCHEMA|DATABASE)\b/gi,
    message: 'destructive DROP SCHEMA / DROP DATABASE destroys data',
  },
  {
    id: 'drop-owned',
    re: /\bDROP\s+OWNED\s+BY\b/gi,
    message: 'destructive DROP OWNED BY drops every object the role owns',
  },
  {
    id: 'truncate',
    re: /\bTRUNCATE\b/gi,
    message: 'destructive TRUNCATE destroys data',
  },
]

const RULE_IDS = new Set([
  ...PATTERN_RULES.map((r) => r.id),
  'delete-all',
  'dynamic-sql',
  'destructive-function-call',
])

function toPosix(p) {
  return p.split(path.sep).join('/')
}

function lineAt(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++
  }
  return line
}

/**
 * Tokenize SQL into (a) `code`: the input with comments, string-literal
 * contents and dollar-quoted bodies blanked to spaces — same length, newlines
 * preserved, so any index maps to the original line — and (b) the list of
 * dollar-quoted bodies lifted out, with their offsets.
 *
 * `keepStrings` leaves `'…'` / `"…"` contents in place (used when scanning a
 * DO body, where a string IS the SQL that will run).
 */
function tokenize(text, { keepStrings = false } = {}) {
  const n = text.length
  const out = new Array(n)
  const dollarBodies = []
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) out[k] = text[k] === '\n' ? '\n' : ' '
  }

  let i = 0
  while (i < n) {
    const ch = text[i]
    const nx = text[i + 1]

    if (ch === '-' && nx === '-') {
      const nl = text.indexOf('\n', i)
      const stop = nl === -1 ? n : nl
      blank(i, stop)
      i = stop
      continue
    }

    if (ch === '/' && nx === '*') {
      let depth = 1
      let j = i + 2
      while (j < n && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') {
          depth++
          j += 2
        } else if (text[j] === '*' && text[j + 1] === '/') {
          depth--
          j += 2
        } else {
          j++
        }
      }
      blank(i, j)
      i = j
      continue
    }

    if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < n) {
        if (text[j] === ch) {
          if (text[j + 1] === ch) {
            j += 2
            continue
          }
          break
        }
        j++
      }
      const close = Math.min(j, n - 1)
      if (keepStrings) {
        for (let k = i; k <= close; k++) out[k] = text[k]
      } else {
        out[i] = ch
        blank(i + 1, close)
        out[close] = text[close] === '\n' ? '\n' : ch
      }
      i = close + 1
      continue
    }

    if (ch === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64))
      if (m) {
        const tag = m[0]
        const bodyStart = i + tag.length
        const close = text.indexOf(tag, bodyStart)
        const bodyEnd = close === -1 ? n : close
        const end = close === -1 ? n : close + tag.length
        dollarBodies.push({ start: i, bodyStart, bodyEnd, end })
        if (keepStrings) {
          for (let k = i; k < end; k++) out[k] = text[k]
        } else {
          blank(i, end)
        }
        i = end
        continue
      }
    }

    out[i] = ch
    i++
  }

  return { code: out.join(''), dollarBodies }
}

/** Runs the pattern rules over `code`; returns [{ id, index, message }]. */
function findPatternHits(code) {
  const hits = []
  for (const rule of PATTERN_RULES) {
    rule.re.lastIndex = 0
    let m
    while ((m = rule.re.exec(code)) !== null) {
      let index = m.index
      if (rule.anchor) {
        const inner = rule.anchor.exec(m[0])
        if (inner) index += inner.index
      }
      hits.push({ id: rule.id, index, message: rule.message })
      if (m[0].length === 0) rule.re.lastIndex++
    }
  }
  return hits
}

/** Top-level statements of `code` as [{ index, text }], split on `;`. */
function splitStatements(code) {
  const statements = []
  let start = 0
  for (let i = 0; i <= code.length; i++) {
    if (i === code.length || code[i] === ';') {
      const raw = code.slice(start, i)
      const lead = raw.length - raw.trimStart().length
      const text = raw.trim()
      if (text.length > 0) statements.push({ index: start + lead, text })
      start = i + 1
    }
  }
  return statements
}

/** Classifies a dollar-quoted body by the top-level code preceding it. */
function classifyDollarBody(code, body) {
  const before = code.slice(Math.max(0, body.start - 600), body.start)
  if (/\bDO\s*(?:LANGUAGE\s+\w+\s*)?$/i.test(before)) {
    return { kind: 'do' }
  }
  const fn = [
    ...before.matchAll(
      /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(?:[\w]+\.)?"?(\w+)"?/gi
    ),
  ].pop()
  if (fn) return { kind: 'function', name: fn[1].toLowerCase() }
  return { kind: 'other' }
}

function lintFile(text) {
  const violations = [] // { id, line, message }
  const errors = [] // annotation misuse — never allowable
  const allowed = new Map() // rule id → { line, used }
  const lines = text.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const lineNo = i + 1

    if (DOWN_MARKER_RE.test(raw)) {
      errors.push(
        `${lineNo}: forward-only violation — a down/reverse migration marker is not allowed ` +
          `(and cannot be annotated away). Reversals must be new forward migrations.`
      )
    }

    const allow = ALLOW_RE.exec(raw)
    if (allow) {
      const id = allow[1].toLowerCase()
      const justification = allow[2].trim()
      if (!RULE_IDS.has(id)) {
        errors.push(
          `${lineNo}: unknown destructive-migration rule id "${id}" — known ids: ` +
            `${[...RULE_IDS].join(', ')}.`
        )
        continue
      }
      if (justification.length < MIN_JUSTIFICATION_CHARS) {
        errors.push(
          `${lineNo}: destructive-migration allowance for "${id}" needs a real justification ` +
            `(at least ${MIN_JUSTIFICATION_CHARS} characters after "because").`
        )
        continue
      }
      if (!allowed.has(id)) allowed.set(id, { line: lineNo, used: false })
    }
  }

  const { code, dollarBodies } = tokenize(text)

  // Top-level pattern rules.
  for (const hit of findPatternHits(code)) {
    violations.push({ id: hit.id, line: lineAt(code, hit.index), message: hit.message })
  }

  // Top-level unfiltered DELETE.
  for (const stmt of splitStatements(code)) {
    if (
      /^DELETE\s+FROM\b/i.test(stmt.text) &&
      !/\bWHERE\b/i.test(stmt.text) &&
      !/\bUSING\b/i.test(stmt.text)
    ) {
      violations.push({
        id: 'delete-all',
        line: lineAt(code, stmt.index),
        message: 'destructive DELETE FROM with no WHERE clause destroys every row',
      })
    }
  }

  // Dollar-quoted bodies: DO blocks run now; function bodies run when called.
  const destructiveFunctions = new Set()
  for (const body of dollarBodies) {
    const kind = classifyDollarBody(code, body)
    const bodyText = text.slice(body.bodyStart, body.bodyEnd)
    const { code: bodyCode } = tokenize(bodyText, { keepStrings: true })
    const bodyHits = findPatternHits(bodyCode)

    if (kind.kind === 'do') {
      for (const hit of bodyHits) {
        violations.push({
          id: hit.id,
          line: lineAt(text, body.bodyStart + hit.index),
          message: `${hit.message} (inside a DO block)`,
        })
      }
      const exec = /\bEXECUTE\b/i.exec(bodyCode)
      if (exec) {
        violations.push({
          id: 'dynamic-sql',
          line: lineAt(text, body.bodyStart + exec.index),
          message: 'EXECUTE inside a DO block runs SQL this linter cannot see at migration time',
        })
      }
    } else if (kind.kind === 'function' && bodyHits.length > 0) {
      destructiveFunctions.add(kind.name)
    }
  }

  // A function defined here with destructive SQL, called from this same file.
  if (destructiveFunctions.size > 0) {
    const callRe = /\b(?:SELECT|PERFORM|CALL)\s+(?:[\w]+\.)?"?(\w+)"?\s*\(/gi
    let m
    while ((m = callRe.exec(code)) !== null) {
      const name = m[1].toLowerCase()
      if (destructiveFunctions.has(name)) {
        violations.push({
          id: 'destructive-function-call',
          line: lineAt(code, m.index),
          message:
            `calls ${name}(), defined in this file with destructive SQL in its body, ` +
            'so the destruction runs at migration time',
        })
      }
    }
  }

  // Apply allowances.
  const remaining = []
  const suppressed = []
  for (const v of violations) {
    const allowance = allowed.get(v.id)
    if (allowance) {
      allowance.used = true
      suppressed.push(v)
    } else {
      remaining.push(v)
    }
  }
  for (const [id, allowance] of allowed) {
    if (!allowance.used) {
      errors.push(
        `${allowance.line}: stale destructive-migration allowance — "${id}" is allowed here ` +
          `but nothing in this file triggers it. Remove the annotation.`
      )
    }
  }

  return { violations: remaining, suppressed, errors }
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

  const problems = []
  const allowances = []

  for (const name of sqlFiles) {
    const abs = path.join(MIGRATIONS_DIR, name)
    let text
    try {
      text = readFileSync(abs, 'utf-8')
    } catch {
      continue
    }
    const rel = `supabase/migrations/${name}`
    const { violations, suppressed, errors } = lintFile(text)

    for (const e of errors) problems.push(`${rel}:${e}`)
    for (const v of violations) {
      problems.push(
        `${rel}:${v.line}: ${v.message} [${v.id}] — not allowed in an automatic forward-only ` +
          `apply. If this is deliberate and owner-approved, annotate the file with ` +
          `"-- destructive-migration: allow ${v.id} because <justification>".`
      )
    }
    for (const v of suppressed) {
      allowances.push(`${rel}:${v.line}: ${v.message} [${v.id}] — allowed by annotation`)
    }
  }

  for (const a of allowances) {
    // eslint-disable-next-line no-console
    console.log(`⚠ ${a}`)
  }

  if (problems.length > 0) {
    for (const p of problems) {
      // eslint-disable-next-line no-console
      console.error(`✗ ${p}`)
    }
    // eslint-disable-next-line no-console
    console.error(
      `\nlint:forward-only-migrations FAILED — ${problems.length} violation(s) ` +
        `across ${sqlFiles.length} migration file(s).`
    )
    process.exit(1)
  }

  // eslint-disable-next-line no-console
  console.log(
    `lint:forward-only-migrations OK — scanned ${sqlFiles.length} migration ` +
      `file(s); 0 violations` +
      (allowances.length > 0 ? `; ${allowances.length} annotated allowance(s).` : '.')
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
