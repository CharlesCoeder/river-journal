#!/usr/bin/env node
/**
 * lint-posthog-events.mjs — the CI lint that statically enforces the PostHog
 * event allowlist at every `captureEvent(...)` call site.
 *
 * WHAT IT DOES
 *  1. Loads the REAL exported `EVENT_ALLOWLIST` and the REAL `isContentKey` /
 *     `KNOWN_CONTENT_KEYS` by bundling `eventAllowlist.ts` + `contentKeys.ts`
 *     with esbuild (already a transitive dep). It consumes the actual exported
 *     values, NOT a brittle regex — and it resolves the `contentKeys` import
 *     chain by bundling (bundle: true), so the content-key denylist is the
 *     single source of truth, never re-hardcoded here.
 *  2. Scans `.ts`/`.tsx` under `packages/**` and `apps/**` (excluding
 *     node_modules, build output, .claude worktrees, and TEST files) for
 *     `captureEvent(` calls, parsing each with the TypeScript compiler so
 *     multi-line calls, comments, and string literals are handled correctly and
 *     never false-positive.
 *  3. Validates each call: the event name must be a known allowlist event, and
 *     every prop key must be permitted for that event.
 *  4. Validates the allowlist itself against the content-key denylist.
 *
 * FAIL-CLOSED (Red Team hardening): any call the lint cannot STATICALLY verify —
 * a non-literal event name, or a props argument that is a spread, a computed
 * key, or a bare variable rather than an inline object literal — is an ERROR,
 * not a silent skip. The runtime net in `captureEvent` still applies, but the
 * two-net invariant requires the static net to reject what it cannot prove.
 *
 * Exit code 0 when clean, non-zero on any violation.
 *
 * NOTE: Story that wires this into `ci.yml` as a required check is a later
 * story; this script + the `lint:posthog` yarn entry are what land here.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import ts from 'typescript'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')
const ALLOWLIST_PATH = path.join(ROOT, 'packages/app/utils/telemetry/eventAllowlist.ts')
const CONTENT_KEYS_PATH = path.join(ROOT, 'packages/app/utils/telemetry/contentKeys.ts')
const ALLOWLIST_REL = 'packages/app/utils/telemetry/eventAllowlist.ts'

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

// Only these top-level roots are scanned.
const SCAN_ROOTS = ['packages', 'apps']

/** Test files are excluded — they intentionally exercise invalid calls. */
function isTestFile(rel) {
  return /\.(test|spec|e2e\.test)\.tsx?$/.test(rel) || /\.e2e\.test\.tsx?$/.test(rel)
}

function isSourceFile(rel) {
  if (!/\.tsx?$/.test(rel)) return false
  if (rel.endsWith('.d.ts')) return false
  if (isTestFile(rel)) return false
  return true
}

/**
 * Load the real EVENT_ALLOWLIST + content-key helpers by bundling the two
 * source modules (they are pure TS, dependency-free) into a single ESM module
 * we import via a data: URL — no temp files to clean up.
 */
async function loadAllowlistModule() {
  const entry =
    `export { EVENT_ALLOWLIST } from ${JSON.stringify(ALLOWLIST_PATH)}\n` +
    `export { isContentKey, KNOWN_CONTENT_KEYS } from ${JSON.stringify(CONTENT_KEYS_PATH)}\n`

  const result = await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'ts', sourcefile: 'lint-entry.ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  })

  const code = result.outputFiles[0].text
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  return import(dataUrl)
}

/** Recursively collect scannable source files under the given absolute dir. */
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
      const rel = path.relative(ROOT, abs)
      if (isSourceFile(rel)) out.push(abs)
    }
  }
}

// The single fail-closed guidance emitted for any statically-unverifiable call.
const FAIL_CLOSED_GUIDANCE =
  'captureEvent(...) must be called with a string-literal event name and an ' +
  'inline literal props object so the CI lint can statically verify it. ' +
  'Do not pass a variable/template event name, a spread ({ ...obj }), a computed ' +
  'key, or a bare variable as props.'

/**
 * Extract the top-level string keys of an object-literal props argument.
 * Returns { ok: true, keys } for a fully-static literal, or { ok: false } when
 * the object contains a spread / computed key (fail-closed).
 */
function readInlinePropKeys(objLiteral) {
  const keys = []
  for (const prop of objLiteral.properties) {
    if (ts.isSpreadAssignment(prop)) return { ok: false }
    // Method / accessor shorthands are not valid prop shapes here.
    if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
      const nameNode = prop.name
      if (ts.isIdentifier(nameNode)) {
        keys.push(nameNode.text)
      } else if (ts.isStringLiteral(nameNode)) {
        keys.push(nameNode.text)
      } else {
        // ComputedPropertyName or anything non-static → cannot verify.
        return { ok: false }
      }
    } else {
      return { ok: false }
    }
  }
  return { ok: true, keys }
}

async function main() {
  const mod = await loadAllowlistModule()
  const EVENT_ALLOWLIST = mod.EVENT_ALLOWLIST
  const isContentKey = mod.isContentKey

  const errors = []

  // ── (4) Validate the allowlist itself against the content-key denylist. ──
  for (const [event, entry] of Object.entries(EVENT_ALLOWLIST)) {
    for (const key of entry.props) {
      if (isContentKey(key)) {
        errors.push(
          `${ALLOWLIST_REL}: Field '${key}' is in the content-key denylist. ` +
            `PostHog events MUST NOT capture user-generated content. ` +
            `(event '${event}')`
        )
      }
    }
  }

  // ── (2) Collect and scan source files for captureEvent(...) call sites. ──
  const files = []
  for (const rootName of SCAN_ROOTS) {
    collectFiles(path.join(ROOT, rootName), files)
  }

  let callsChecked = 0

  for (const abs of files) {
    const rel = path.relative(ROOT, abs)
    let text
    try {
      text = readFileSync(abs, 'utf-8')
    } catch {
      continue
    }
    // Cheap pre-filter: skip files that don't even mention captureEvent.
    if (!text.includes('captureEvent')) continue

    const sourceFile = ts.createSourceFile(
      rel,
      text,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )

    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'captureEvent'
      ) {
        callsChecked++
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        const loc = `${rel}:${line + 1}`
        const args = node.arguments

        // (3a) Event name must be a string literal.
        const eventArg = args[0]
        if (!eventArg || !ts.isStringLiteralLike(eventArg)) {
          errors.push(`${loc}: ${FAIL_CLOSED_GUIDANCE}`)
        } else {
          const eventName = eventArg.text
          const entry = EVENT_ALLOWLIST[eventName]
          if (!entry) {
            errors.push(
              `${loc}: Event '${eventName}' is not in the allowlist. ` +
                `Add it to ${ALLOWLIST_REL} with the explicit prop schema before merging.`
            )
          } else if (args.length >= 2) {
            // (3b) Props argument, when present, must be an inline object literal.
            const propsArg = args[1]
            if (!ts.isObjectLiteralExpression(propsArg)) {
              errors.push(`${loc}: ${FAIL_CLOSED_GUIDANCE}`)
            } else {
              const parsed = readInlinePropKeys(propsArg)
              if (!parsed.ok) {
                errors.push(`${loc}: ${FAIL_CLOSED_GUIDANCE}`)
              } else {
                const allowed = new Set(entry.props)
                for (const key of parsed.keys) {
                  if (!allowed.has(key)) {
                    errors.push(
                      `${loc}: Prop '${key}' is not permitted for event '${eventName}'. ` +
                        `Allowed props: ${entry.props.join(', ')}. ` +
                        `Update ${ALLOWLIST_REL} or remove the prop.`
                    )
                  }
                }
              }
            }
          }
          // args.length < 2 → captureEvent(event) with no props → valid.
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  const eventCount = Object.keys(EVENT_ALLOWLIST).length

  if (errors.length > 0) {
    for (const err of errors) {
      // eslint-disable-next-line no-console
      console.error(`✗ ${err}`)
    }
    // eslint-disable-next-line no-console
    console.error(
      `\nlint:posthog FAILED — ${errors.length} violation(s). ` +
        `Checked ${callsChecked} captureEvent call(s) across ${files.length} file(s); ` +
        `${eventCount} events in the allowlist.`
    )
    process.exit(1)
  }

  // eslint-disable-next-line no-console
  console.log(
    `lint:posthog OK — checked ${callsChecked} captureEvent call(s) across ` +
      `${files.length} file(s); ${eventCount} events in the allowlist.`
  )
  process.exit(0)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('lint:posthog crashed:', err)
  process.exit(2)
})
