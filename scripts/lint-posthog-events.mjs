#!/usr/bin/env node
/**
 * lint-posthog-events.mjs — the CI lint that statically enforces the app's
 * NO-ANALYTICS guarantee.
 *
 * HISTORY: this script used to validate every `captureEvent(...)` call site
 * against the PostHog event allowlist. Product analytics was then removed
 * entirely (client + server) — the app's privacy posture is now "no analytics
 * anywhere, verifiable from a network tab" — so the guard is INVERTED: instead
 * of validating analytics calls, it asserts they cannot reappear. Kept wired
 * into CI (`yarn lint:posthog`) so a future dependency bump or copy-pasted
 * call site fails the build rather than silently reintroducing a tracker.
 *
 * WHAT IT ASSERTS
 *  1. No `posthog*` package in any package.json's dependencies /
 *     devDependencies / peerDependencies / resolutions.
 *  2. No import/require of a posthog module specifier in any source file.
 *  3. No `captureEvent(` / `emitServerEvent(` call shape anywhere in source —
 *     the two removed analytics entry points must stay removed.
 *  4. No `POSTHOG` config token (env var names, keys, hosts) in source or in
 *     the app config files (eas.json) that used to carry them.
 *
 * This is a RAW-SOURCE line scanner (mirroring `lint-edge-function-logging.mjs`'s
 * SKIP_DIRS / collectFiles / fail-closed conventions). To avoid false
 * positives it strips `//` line comments and obvious string literals before
 * matching the CALL shapes; the dependency/import/config checks match
 * verbatim (a posthog import or dependency is a violation even in a comment-
 * free file, and comments naming the banned identifiers are fine).
 *
 * Exit code 0 when clean, non-zero (1) on any violation, 2 on a crash.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')

// Directories the scanner never descends into.
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.expo',
  '.tamagui',
  'dist',
  'build',
  'coverage',
  '.git',
  '.claude',
  'ios',
  'android',
])

// Top-level roots scanned for source files. `scripts` is deliberately absent:
// this file itself must name the banned tokens to ban them.
const SCAN_ROOTS = ['packages', 'apps', 'supabase']

// Extra JSON config files checked for POSTHOG tokens (these used to carry the
// client keys/hosts).
const CONFIG_FILES = ['apps/mobile/eas.json', 'vercel.json']

function isSourceFile(rel) {
  return /\.(ts|tsx|mjs|js|jsx)$/.test(rel) && !rel.endsWith('.d.ts')
}

/** Recursively collect scannable files under the given absolute dir. */
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
      out.push(abs)
    }
  }
}

/** Recursively collect every package.json under ROOT (skipping SKIP_DIRS). */
function collectPackageJsons(absDir, out) {
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
      collectPackageJsons(abs, out)
    } else if (name === 'package.json') {
      out.push(abs)
    }
  }
}

/**
 * Strip `//` line comments, `/* ... *​/` block comments, and obvious string
 * literals from a line so a mention inside a comment or a user-facing string
 * never false-positives the CALL-shape checks. Coarse but sufficient for a
 * ban-scan (same tradeoff as lint-edge-function-logging.mjs).
 */
function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

const violations = []

function violation(file, message) {
  violations.push(`${path.relative(ROOT, file)}: ${message}`)
}

try {
  // ── 1. No posthog package in any package.json dependency map. ─────────────
  const packageJsons = []
  collectPackageJsons(ROOT, packageJsons)
  for (const pkgPath of packageJsons) {
    let pkg
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    } catch {
      continue
    }
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'resolutions']) {
      for (const dep of Object.keys(pkg[field] ?? {})) {
        if (/posthog/i.test(dep)) {
          violation(pkgPath, `${field} contains banned analytics package "${dep}"`)
        }
      }
    }
  }

  // ── 2–4. Source scan. ──────────────────────────────────────────────────────
  const files = []
  for (const root of SCAN_ROOTS) {
    collectFiles(path.join(ROOT, root), files)
  }

  const IMPORT_SPECIFIER = /(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"][^'"]*posthog[^'"]*['"]/i
  const CALL_SHAPES = [/\bcaptureEvent\s*\(/, /\bemitServerEvent\s*\(/]
  const CONFIG_TOKEN = /POSTHOG/

  for (const file of files) {
    if (!isSourceFile(file)) continue
    let source
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    if (IMPORT_SPECIFIER.test(source)) {
      violation(file, 'imports a posthog module — the analytics SDK must not return')
    }
    if (CONFIG_TOKEN.test(source)) {
      violation(file, 'references a POSTHOG config token — no analytics env vars may remain')
    }

    const stripped = stripCommentsAndStrings(source)
    for (const shape of CALL_SHAPES) {
      if (shape.test(stripped)) {
        violation(
          file,
          `contains a ${String(shape).includes('capture') ? 'captureEvent(' : 'emitServerEvent('} call — the removed analytics entry points must stay removed`
        )
      }
    }
  }

  // Config files (JSON, not caught by the source-extension filter).
  for (const rel of CONFIG_FILES) {
    let text
    try {
      text = readFileSync(path.join(ROOT, rel), 'utf8')
    } catch {
      continue
    }
    if (CONFIG_TOKEN.test(text)) {
      violation(path.join(ROOT, rel), 'carries a POSTHOG config entry — remove the analytics keys')
    }
  }

  if (violations.length > 0) {
    console.error('lint-posthog-events: the no-analytics guarantee is violated:\n')
    for (const v of violations) {
      console.error(`  ✗ ${v}`)
    }
    console.error(`\n${violations.length} violation(s).`)
    process.exit(1)
  }

  console.log(
    'lint-posthog-events: clean — no analytics dependency, import, call site, or config token found.'
  )
  process.exit(0)
} catch (error) {
  console.error('lint-posthog-events: crashed while scanning:', error)
  process.exit(2)
}
