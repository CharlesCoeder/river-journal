#!/usr/bin/env node
/**
 * lint-boundaries.mjs — the CI lint that structurally enforces three
 * import-statement-anchored architectural boundaries the codebase relies on
 * but that no compiler or type-check catches:
 *
 *  (a) NO TANSTACK QUERY IN THE LEGACY LEGEND-STATE JOURNAL FILES. The
 *      encrypted-journal domain is backed by Legend-State; its core state
 *      files must not start reaching into the TanStack Query domain. Any
 *      `@tanstack/react-query` import in the enumerated legacy files is
 *      rejected.
 *
 *  (b) NO MODERATION FEATURE IN THE MOBILE APP. The moderation admin surface
 *      is web + desktop only; it must never ship inside a publicly
 *      distributed mobile binary. Any `apps/mobile/**` file that imports
 *      `app/features/moderation/**` is rejected. Match is import-anchored so
 *      an explanatory prose comment mentioning the path is not a violation.
 *
 *  (c) NO JOURNAL-DOMAIN BRIDGE FROM COLLECTIVE STATE. Collective state is
 *      TanStack-Query-backed and must not bridge into the Legend-State
 *      journal domain. Two anti-patterns are rejected in
 *      `packages/app/state/collective/**`: a `syncedQuery(` call (the
 *      cross-library bridge primitive), and an import of the Legend-State
 *      journal store / synced observables (`app/state/{store,flows,entries,
 *      syncConfig}`). A small set of pre-existing files legitimately READ the
 *      journal store's observables for cross-cutting UI (word count, feed
 *      composition); those specific reads are grandfathered so this check
 *      prevents NEW bridges without forcing a refactor of accepted reactive
 *      reads. A blanket `@legendapp/state` ban is deliberately NOT used —
 *      several accepted `use$`/`observe` reads would trip it.
 *
 * This is a RAW-SOURCE line scanner (mirroring lint-edge-function-logging.mjs
 * and lint-posthog-events.mjs): it strips `//` line comments and string
 * literals before matching so a mention inside a comment or string is never a
 * false positive, and only matches real import specifiers / call shapes.
 *
 * Exit code 0 when clean, 1 on any violation, 2 on a crash.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')

// Directories the recursive scanners never descend into.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.tamagui',
  '.next',
  '.expo',
  'ios',
  'android',
])

// ── Rule (a): the enumerated legacy Legend-State journal files. A FIXED list
// (not a glob) because the boundary is defined per-file: sibling files under
// state/ (e.g. the TanStack-Query-backed collective/query modules) legitimately
// use react-query and must NOT be scanned by this rule.
const LEGACY_LEGEND_STATE_FILES = [
  'packages/app/state/store.ts',
  'packages/app/state/flows.ts',
  'packages/app/state/entries.ts',
  'packages/app/state/syncConfig.ts',
  'packages/app/state/encryptionSetup.ts',
  'packages/app/state/initializeApp.ts',
  'packages/app/state/persistConfig.ts',
  'packages/app/state/persistConfig.native.ts',
]

const TANSTACK_SPECIFIER_RE =
  /(?:from\s*|import\s*|require\s*\(\s*)['"]@tanstack\/react-query(?:['"/])/

// ── Rule (b): apps/mobile must not import the moderation feature.
const MOBILE_ROOT = 'apps/mobile'
const MODERATION_SPECIFIER_RE =
  /(?:from\s*|import\s*|require\s*\(\s*)['"][^'"]*features\/moderation(?:['"/])/

// ── Rule (c): collective state must not bridge into the journal domain.
const COLLECTIVE_ROOT = 'packages/app/state/collective'
const SYNCED_QUERY_CALL_RE = /\bsyncedQuery\s*\(/
const JOURNAL_STORE_SPECIFIER_RE =
  /(?:from\s*|import\s*|require\s*\(\s*)['"]app\/state\/(store|flows|entries|syncConfig)(?:['"/])/
// Pre-existing files that legitimately read the journal store's observables
// for cross-cutting reactive UI (not a two-library bridge). Grandfathered for
// the journal-store IMPORT check only — a `syncedQuery(` call in any of them
// is still rejected.
const JOURNAL_STORE_READ_ALLOWLIST = new Set([
  'packages/app/state/collective/todayWordCount.ts',
  'packages/app/state/collective/feed.ts',
  'packages/app/state/collective/locallyHidden.ts',
])

function toPosix(p) {
  return p.split(path.sep).join('/')
}

/** A .ts/.tsx/.mts/.js source file that is NOT a test file. */
function isScannable(rel) {
  if (!/\.(m?tsx?|m?jsx?)$/.test(rel)) return false
  if (rel.endsWith('.d.ts')) return false
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(rel)) return false
  if (rel.split('/').includes('__tests__')) return false
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

/**
 * Neutralize a source line for the false-positive guards. Returns two variants
 * with `//` line comments (outside string literals) truncated away:
 *   - `code`: string-literal CONTENTS blanked — used for call-shape checks
 *     (`syncedQuery(`) so a token inside a string is not a false positive.
 *   - `withStrings`: string-literal contents PRESERVED — used for import
 *     specifier checks (which require an `import/from/require ... 'spec'` shape,
 *     so a bare mention in a string is not a false positive).
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
        if (i + 1 < line.length) withStrings += line[i + 1]
        i++
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      withStrings += ch
      continue
    }
    if (ch === '/' && line[i + 1] === '/') {
      break
    }
    code += ch
    withStrings += ch
  }
  return { code, withStrings }
}

function readLines(abs) {
  try {
    return readFileSync(abs, 'utf-8').split(/\r?\n/)
  } catch {
    return null
  }
}

function main() {
  const violations = []
  let scanned = 0

  // Rule (a): legacy Legend-State files must not import @tanstack/react-query.
  for (const rel of LEGACY_LEGEND_STATE_FILES) {
    const abs = path.join(ROOT, rel)
    const lines = readLines(abs)
    if (!lines) continue // file may not exist (e.g. platform-specific variant)
    scanned++
    for (let i = 0; i < lines.length; i++) {
      const { withStrings } = stripLine(lines[i])
      if (TANSTACK_SPECIFIER_RE.test(withStrings)) {
        violations.push(
          `${rel}:${i + 1}: legacy Legend-State journal file must not import ` +
            `@tanstack/react-query — the journal domain is Legend-State-backed; ` +
            `keep the two state libraries unbridged.`
        )
      }
    }
  }

  // Rule (b): apps/mobile/** must not import app/features/moderation/**.
  {
    const files = []
    collectFiles(path.join(ROOT, MOBILE_ROOT), files)
    for (const abs of files) {
      const rel = toPosix(path.relative(ROOT, abs))
      const lines = readLines(abs)
      if (!lines) continue
      scanned++
      for (let i = 0; i < lines.length; i++) {
        const { withStrings } = stripLine(lines[i])
        if (MODERATION_SPECIFIER_RE.test(withStrings)) {
          violations.push(
            `${rel}:${i + 1}: apps/mobile must not import the moderation feature ` +
              `(features/moderation/**) — the admin surface is web + desktop only ` +
              `and must not ship in publicly distributed mobile binaries.`
          )
        }
      }
    }
  }

  // Rule (c): state/collective/** must not bridge into the journal domain.
  {
    const files = []
    collectFiles(path.join(ROOT, COLLECTIVE_ROOT), files)
    for (const abs of files) {
      const rel = toPosix(path.relative(ROOT, abs))
      const lines = readLines(abs)
      if (!lines) continue
      scanned++
      const storeReadAllowed = JOURNAL_STORE_READ_ALLOWLIST.has(rel)
      for (let i = 0; i < lines.length; i++) {
        const { code, withStrings } = stripLine(lines[i])
        if (SYNCED_QUERY_CALL_RE.test(code)) {
          violations.push(
            `${rel}:${i + 1}: syncedQuery( is banned in collective state — it bridges ` +
              `the TanStack-Query and Legend-State domains; keep collective state on ` +
              `TanStack Query only.`
          )
        }
        if (!storeReadAllowed && JOURNAL_STORE_SPECIFIER_RE.test(withStrings)) {
          violations.push(
            `${rel}:${i + 1}: collective state must not import the Legend-State journal ` +
              `store/synced observables (app/state/{store,flows,entries,syncConfig}) — ` +
              `keep the two state libraries unbridged.`
          )
        }
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
      `\nlint:boundaries FAILED — ${violations.length} violation(s) across ` +
        `${scanned} scanned file(s).`
    )
    process.exit(1)
  }

  // eslint-disable-next-line no-console
  console.log(`lint:boundaries OK — scanned ${scanned} file(s); 0 violations.`)
  process.exit(0)
}

try {
  main()
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('lint:boundaries crashed:', err)
  process.exit(2)
}
