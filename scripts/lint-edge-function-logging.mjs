#!/usr/bin/env node
/**
 * lint-edge-function-logging.mjs — the CI lint that structurally enforces two
 * server-side invariants across every Edge Function (Boundary 1):
 *
 *  1. NO RAW CONSOLE LOGGING. Content redaction lives in the shared logger's
 *     `logInfo` / `logError` wrappers. A raw `console.*` call bypasses that
 *     redactor and can leak user content into a log line. Every scanned file is
 *     rejected if it contains `console.log/error/warn/info/debug/...` — the ONE
 *     exempt file is `_shared/logging.ts`, which IS the wrapper implementation
 *     (its single `console[method]` call is the sanctioned log sink).
 *
 *  2. NO ENCRYPTION IMPORT. Edge Functions never decrypt — they never hold user
 *     encryption keys (encryption is client-only, Boundary 1). Any import whose
 *     module specifier is an `encryption` module is rejected in EVERY file (no
 *     exemption).
 *
 * This is a RAW-SOURCE line scanner (mirroring `lint-posthog-events.mjs`'s
 * SKIP_DIRS / collectFiles / fail-closed conventions) — it greps banned tokens,
 * so no esbuild/TS-AST is needed. To avoid false positives it strips `//` line
 * comments and obvious string literals before matching, and only matches the
 * `console.method(` CALL shape (not the bare word "console").
 *
 * Exit code 0 when clean, non-zero (1) on any violation, 2 on a crash.
 *
 * NOTE: the workflow that wires `yarn lint:edge-logging` into CI as a required
 * check is a later story; this script + the yarn entry are what land here.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')

// Only this subtree is scanned — the Edge Function (Deno) code.
const SCAN_ROOT = path.join(ROOT, 'supabase/functions')

// Directories the scanner never descends into.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage'])

// The single file exempt from the console rule: the wrapper implementation
// itself. Compared as a repo-relative POSIX path.
const CONSOLE_EXEMPT_REL = 'supabase/functions/_shared/logging.ts'

// Match a real `console.method(` CALL — not the bare word "console" in prose.
const CONSOLE_CALL_RE =
  /console\s*\.\s*(log|error|warn|info|debug|trace|dir|table|group|groupEnd|assert)\s*\(/
// Match an import/require/dynamic-import whose module specifier is an
// `encryption` module (…/encryption or …/encryption.ts), with any (or no)
// bindings — covers `import x from`, `import {…} from`, bare `import '…'`,
// `export … from`, and `require('…')`.
const ENCRYPTION_SPECIFIER_RE =
  /(?:from\s*|import\s*|require\s*\(\s*)['"][^'"]*\bencryption(?:\.ts)?['"]/

/** A .ts/.tsx/.mts/.js source file that is NOT a test file. */
function isScannable(rel) {
  if (!/\.(m?tsx?|m?jsx?)$/.test(rel)) return false
  if (rel.endsWith('.d.ts')) return false
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(rel)) return false
  return true
}

/** Recursively collect scannable files under an absolute dir. */
function collectFiles(absDir, out) {
  let entries
  try {
    entries = readdirSync(absDir)
  } catch {
    return
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const abs = path.join(absDir, name)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      collectFiles(abs, out)
    } else if (st.isFile()) {
      const rel = toPosix(path.relative(ROOT, abs))
      if (isScannable(rel)) out.push(abs)
    }
  }
}

function toPosix(p) {
  return p.split(path.sep).join('/')
}

/**
 * Neutralize a single source line for the false-positive guards. Cheap and
 * deliberately conservative — not a full tokenizer, but sufficient for a
 * banned-token grep. Returns two variants of the line, both with `//` line
 * comments (outside string literals) truncated away:
 *   - `code`: string-literal CONTENTS also blanked out, so a
 *     `console.error(...)`-looking token INSIDE a string is not a false
 *     positive. Used for the console-call check.
 *   - `withStrings`: string-literal contents PRESERVED, so an import's quoted
 *     module specifier (`'.../encryption.ts'`) is still visible. Used for the
 *     encryption-import check (which only matches an `import/require ... 'spec'`
 *     shape, so a bare mention of the word in a string is not a false positive).
 */
function stripLine(line) {
  let code = ''
  let withStrings = ''
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      withStrings += ch
      if (ch === '\\') {
        // preserve the escaped char in withStrings; drop from code
        if (i + 1 < line.length) withStrings += line[i + 1]
        i++
        continue
      }
      if (ch === quote) quote = null
      continue // drop string contents from `code`
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      withStrings += ch
      continue
    }
    if (ch === '/' && line[i + 1] === '/') {
      break // rest of the line is a comment (outside a string)
    }
    code += ch
    withStrings += ch
  }
  return { code, withStrings }
}

function main() {
  const files = []
  collectFiles(SCAN_ROOT, files)

  const violations = []

  for (const abs of files) {
    const rel = toPosix(path.relative(ROOT, abs))
    let text
    try {
      text = readFileSync(abs, 'utf-8')
    } catch {
      continue
    }
    const isConsoleExempt = rel === CONSOLE_EXEMPT_REL
    const lines = text.split(/\r?\n/)

    for (let i = 0; i < lines.length; i++) {
      const { code, withStrings } = stripLine(lines[i])
      const lineNo = i + 1

      if (!isConsoleExempt && CONSOLE_CALL_RE.test(code)) {
        violations.push(
          `${rel}:${lineNo}: raw console.* call is banned — log through ` +
            `logInfo / logError from _shared/logging.ts (they redact user content).`
        )
      }
      if (ENCRYPTION_SPECIFIER_RE.test(withStrings)) {
        violations.push(
          `${rel}:${lineNo}: importing an encryption module is banned — Edge ` +
            `Functions must never import encryption utilities; they never decrypt (client-only, Boundary 1).`
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
      `\nlint:edge-logging FAILED — ${violations.length} violation(s) across ` +
        `${files.length} scanned file(s) under supabase/functions/.`
    )
    process.exit(1)
  }

  // eslint-disable-next-line no-console
  console.log(
    `lint:edge-logging OK — scanned ${files.length} file(s) under ` +
      `supabase/functions/; 0 violations.`
  )
  process.exit(0)
}

try {
  main()
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('lint:edge-logging crashed:', err)
  process.exit(2)
}
