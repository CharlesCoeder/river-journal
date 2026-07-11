/**
 * Red-phase platform-boundary guard for `features/moderation-receipts/**`.
 *
 * This surface ships to web + desktop + mobile (unlike the admin-only,
 * mobile-excluded `features/moderation/**`). A stray import of the admin
 * subtree (e.g. reaching for `REMOVAL_REASONS` from `RemovePostDialog.tsx`
 * instead of the locally-defined `reasonLabels.ts` map) would silently break
 * the mobile bundle. This test is an automated, source-text-level guard
 * against that regression — it does not need the app to build; it greps.
 *
 * Red-phase contract: the required receipt-feature files do not exist yet,
 * so the file-existence assertions below fail until Task groups 3/4 create
 * them. Once they exist, the import-boundary scan takes over as the ongoing
 * regression guard.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const FEATURE_DIR = path.resolve(__dirname, '..')

const REQUIRED_FILES = [
  'ModerationReceiptDialog.tsx',
  'ModerationReceiptGate.tsx',
  'acknowledgment.ts',
  'reasonLabels.ts',
]

// Forbidden: any import specifier that reaches into the admin-only,
// mobile-excluded features/moderation/** subtree. Deliberately does NOT
// match 'features/moderation-receipts/**' itself (the char after
// "moderation" there is '-', not '/').
const FORBIDDEN_IMPORT_RE = /from\s+['"][^'"]*\bfeatures\/moderation\/[^'"]*['"]/g

function collectSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const entries = readdirSync(dir)
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full)
    }
  }
  return files
}

// ─────────────────────────────────────────────────────────────────────────────
describe('features/moderation-receipts/** — required files exist', () => {
  for (const file of REQUIRED_FILES) {
    it(`${file} exists`, () => {
      expect(existsSync(path.join(FEATURE_DIR, file))).toBe(true)
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
describe('features/moderation-receipts/** — mobile-exclusion import boundary', () => {
  it('no file under features/moderation-receipts/** imports from features/moderation/** (admin-only, mobile-excluded)', () => {
    const files = collectSourceFiles(FEATURE_DIR)
    // Guard against a vacuous pass: the scan must actually have files to check
    // once the feature exists (red-phase: this assertion itself fails first).
    expect(files.length).toBeGreaterThan(0)

    const violations: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      const matches = src.match(FORBIDDEN_IMPORT_RE)
      if (matches) {
        for (const m of matches) {
          violations.push(`${path.relative(FEATURE_DIR, file)}: ${m}`)
        }
      }
    }

    expect(violations, `forbidden features/moderation/** imports found:\n${violations.join('\n')}`).toEqual([])
  })

  it('reasonLabels.ts specifically does NOT import REMOVAL_REASONS from features/moderation/RemovePostDialog', () => {
    const reasonLabelsPath = path.join(FEATURE_DIR, 'reasonLabels.ts')
    expect(existsSync(reasonLabelsPath)).toBe(true)
    const src = readFileSync(reasonLabelsPath, 'utf8')
    expect(src).not.toMatch(/REMOVAL_REASONS/)
    expect(src).not.toMatch(/features\/moderation\//)
  })

  it('ModerationReceiptDialog.tsx does not import the admin SuspendUserDialog or RemovePostDialog', () => {
    const dialogPath = path.join(FEATURE_DIR, 'ModerationReceiptDialog.tsx')
    expect(existsSync(dialogPath)).toBe(true)
    const src = readFileSync(dialogPath, 'utf8')
    expect(src).not.toMatch(/SuspendUserDialog/)
    expect(src).not.toMatch(/RemovePostDialog/)
  })
})
