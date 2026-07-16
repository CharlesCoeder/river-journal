/**
 * lintPosthogEvents.e2e.test.ts — TDD RED-PHASE E2E spec for the CI lint
 * check, `scripts/lint-posthog-events.mjs`.
 *
 * This is a true end-to-end test of the script AS an operator/CI would run
 * it: `node scripts/lint-posthog-events.mjs` is shelled out to as a real
 * child process against the real repository tree (this repo's convention
 * for scaffolding/CLI checks — see `depsAndConfig.e2e.test.ts`). Nothing about
 * the lint script itself is mocked; it is exercised exactly as CI would
 * invoke it. Fixture `.fixture.ts` files that intentionally violate the
 * rules are planted under `packages/**` (inside the scanner's real scan
 * scope) immediately before each test and are ALWAYS removed in a
 * `finally` block — including for the content-key-denylist test, which
 * temporarily mutates the real `eventAllowlist.ts` and restores the
 * original content afterward (mirroring the story's own manual
 * Verification step: "temporarily plant a bad captureEvent(...) call...
 * then revert").
 *
 * RED PHASE: `scripts/lint-posthog-events.mjs` does not exist yet (there is
 * no `scripts/` directory in this repo before this story). Every test
 * below MUST fail until this story is implemented — most by the lint
 * script simply not being found (`node` exits non-zero with a
 * "Cannot find module" error), which still satisfies "the lint fails" for
 * tests asserting non-zero exit, but FAILS the tests asserting the exact
 * expected error text and the "exits 0 on a clean tree" test, as intended.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../../../../..')
const LINT_SCRIPT_REL = 'scripts/lint-posthog-events.mjs'
const FIXTURES_DIR = path.join(
  ROOT,
  'packages/app/utils/telemetry/__tests__/__fixtures__/lint-posthog-scratch'
)

function runLint(): { status: number | null; output: string } {
  const result = spawnSync('node', [LINT_SCRIPT_REL], { cwd: ROOT, encoding: 'utf-8' })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/** Writes a scratch fixture file inside the scanner's scan scope (packages/**) and returns its absolute path. */
function plantFixture(name: string, contents: string): string {
  mkdirSync(FIXTURES_DIR, { recursive: true })
  const absPath = path.join(FIXTURES_DIR, name)
  writeFileSync(absPath, contents)
  return absPath
}

beforeAll(() => {
  // Defensive cleanup in case a previous interrupted run left scratch files
  // behind — never leave a planted violation in the tree.
  rmSync(FIXTURES_DIR, { recursive: true, force: true })
})

afterAll(() => {
  rmSync(FIXTURES_DIR, { recursive: true, force: true })
})

describe('scripts/lint-posthog-events.mjs — exists and is runnable', () => {
  it('the script file exists', () => {
    expect(existsSync(path.join(ROOT, LINT_SCRIPT_REL))).toBe(true)
  })

  it('exits 0 on the real, clean source tree (once the allowlist + wiring from this story land)', () => {
    const { status } = runLint()
    expect(status).toBe(0)
  })
})

describe('scripts/lint-posthog-events.mjs — unknown-event failure is explicit', () => {
  it('fails with the exact message naming the event and the file to edit', () => {
    const fixturePath = plantFixture(
      'unknownEvent.fixture.ts',
      `import { captureEvent } from '../../posthog'\n\ncaptureEvent('totally_unknown_event_xyz', { user_id: 'u1' })\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).toContain("Event 'totally_unknown_event_xyz' is not in the allowlist.")
      expect(output).toContain('packages/app/utils/telemetry/eventAllowlist.ts')
      expect(output).toContain('with the explicit prop schema before merging.')
    } finally {
      rmSync(fixturePath, { force: true })
    }
  })
})

describe('scripts/lint-posthog-events.mjs — an unpermitted prop key for a known event also fails', () => {
  it('fails when a captureEvent call passes a prop key not in that event\'s allowed props', () => {
    const fixturePath = plantFixture(
      'unpermittedProp.fixture.ts',
      `import { captureEvent } from '../../posthog'\n\ncaptureEvent('flow_started', { user_id: 'u1', tier: 'free', notAnAllowedProp: 'x' })\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      // Must be the lint script itself reporting the violation, not Node
      // failing to even find the (not-yet-implemented) script.
      expect(output).not.toMatch(/Cannot find module/)
      expect(output).toMatch(/notAnAllowedProp/)
    } finally {
      rmSync(fixturePath, { force: true })
    }
  })
})

describe('scripts/lint-posthog-events.mjs — content-key denylist reused from contentKeys.ts', () => {
  const ALLOWLIST_PATH = path.join(ROOT, 'packages/app/utils/telemetry/eventAllowlist.ts')

  it("fails with the exact message when a content-shaped key is added to an event's allowed props", () => {
    if (!existsSync(ALLOWLIST_PATH)) {
      // RED PHASE: eventAllowlist.ts does not exist yet — fail explicitly
      // rather than silently skipping, so this test correctly reports red.
      expect(existsSync(ALLOWLIST_PATH)).toBe(true)
      return
    }

    const original = readFileSync(ALLOWLIST_PATH, 'utf-8')
    try {
      const mutated = original.replace(
        /(flow_started\s*:\s*\{[^}]*?props\s*:\s*\[)/,
        `$1'note', `
      )
      expect(
        mutated,
        'expected to locate a flow_started allowlist entry to mutate for this test'
      ).not.toBe(original)
      writeFileSync(ALLOWLIST_PATH, mutated)

      const { status, output } = runLint()

      expect(status).not.toBe(0)
      expect(output).toContain("Field 'note' is in the content-key denylist.")
      expect(output).toContain('PostHog events MUST NOT capture user-generated content (NFR19).')
    } finally {
      writeFileSync(ALLOWLIST_PATH, original)
    }
  })
})

describe('scripts/lint-posthog-events.mjs — fail-closed on statically-unverifiable calls (Red Team hardening)', () => {
  it('rejects a non-literal (variable) event name with guidance to use a string literal', () => {
    const fixturePath = plantFixture(
      'dynamicEventName.fixture.ts',
      `import { captureEvent } from '../../posthog'\n\nconst dynamicEventName = 'flow_started'\ncaptureEvent(dynamicEventName, { user_id: 'u1', tier: 'free' })\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).toMatch(/string[- ]literal event name/i)
    } finally {
      rmSync(fixturePath, { force: true })
    }
  })

  it('rejects a spread props object with guidance to use an inline literal object', () => {
    const fixturePath = plantFixture(
      'spreadProps.fixture.ts',
      `import { captureEvent } from '../../posthog'\n\nconst extra = { user_id: 'u1', tier: 'free' }\ncaptureEvent('flow_started', { ...extra })\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).toMatch(/inline (literal )?props object/i)
    } finally {
      rmSync(fixturePath, { force: true })
    }
  })

  it('rejects a props object with a computed key', () => {
    const fixturePath = plantFixture(
      'computedKey.fixture.ts',
      `import { captureEvent } from '../../posthog'\n\nconst key = 'tier'\ncaptureEvent('flow_started', { user_id: 'u1', [key]: 'free' })\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).not.toMatch(/Cannot find module/)
      expect(output).toMatch(/inline (literal )?props object/i)
    } finally {
      rmSync(fixturePath, { force: true })
    }
  })

  it('rejects a bare variable passed as the props argument (not an inline object literal)', () => {
    const fixturePath = plantFixture(
      'bareVariableProps.fixture.ts',
      `import { captureEvent } from '../../posthog'\n\nconst props = { user_id: 'u1', tier: 'free' }\ncaptureEvent('flow_started', props)\n`
    )
    try {
      const { status, output } = runLint()
      expect(status).not.toBe(0)
      expect(output).toMatch(/inline (literal )?props object/i)
    } finally {
      rmSync(fixturePath, { force: true })
    }
  })
})

describe('scripts/lint-posthog-events.mjs — valid edge cases lint clean (edge sweep)', () => {
  it('captureEvent(event) with no props argument at all is valid and does not introduce a new violation', () => {
    const fixturePath = plantFixture(
      'noPropsArg.fixture.ts',
      `import { captureEvent } from '../../posthog'\n\ncaptureEvent('flow_started')\n`
    )
    try {
      const { status } = runLint()
      expect(status).toBe(0)
    } finally {
      rmSync(fixturePath, { force: true })
    }
  })

  it('captureEvent(event, {}) with an empty props object is valid and does not introduce a new violation', () => {
    const fixturePath = plantFixture(
      'emptyPropsObject.fixture.ts',
      `import { captureEvent } from '../../posthog'\n\ncaptureEvent('flow_started', {})\n`
    )
    try {
      const { status } = runLint()
      expect(status).toBe(0)
    } finally {
      rmSync(fixturePath, { force: true })
    }
  })

  it('a multi-line captureEvent call with the event name and props on different lines is parsed correctly', () => {
    const fixturePath = plantFixture(
      'multiLineCall.fixture.ts',
      `import { captureEvent } from '../../posthog'\n\ncaptureEvent(\n  'flow_started',\n  {\n    user_id: 'u1',\n    tier: 'free',\n  }\n)\n`
    )
    try {
      const { status } = runLint()
      expect(status).toBe(0)
    } finally {
      rmSync(fixturePath, { force: true })
    }
  })

  it('a captureEvent-looking occurrence inside a comment or string literal is not treated as a real call site', () => {
    const fixturePath = plantFixture(
      'commentedOutCall.fixture.ts',
      `// captureEvent('not_a_real_event', { body: 'not a real call' })\nconst note = "captureEvent('also_not_real', { body: 'x' })"\nexport const noop = note\n`
    )
    try {
      const { status } = runLint()
      expect(status).toBe(0)
    } finally {
      rmSync(fixturePath, { force: true })
    }
  })
})
