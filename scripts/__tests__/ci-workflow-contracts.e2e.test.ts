/**
 * ci-workflow-contracts.e2e.test.ts — TDD RED-PHASE E2E spec for the three
 * GitHub Actions workflow files this story adds: `.github/workflows/ci.yml`,
 * `.github/workflows/migrations.yml`, and `.github/workflows/eas.yml`.
 *
 * These workflows cannot actually execute locally (no GitHub Actions
 * runner), so this spec tests what IS testable outside that runner: the
 * committed YAML's structural CONTRACT — triggers, pinned toolchain
 * versions, required steps, ordering/gating invariants, and known footguns
 * this story's design explicitly calls out (Berry `--immutable` vs Yarn 1
 * `--frozen-lockfile`, the CI-safe Vitest invocation excluding BOTH
 * `dev.test.ts` and `build.test.ts`, the tag-only/concurrency-guarded EAS
 * trigger, the environment-gated migrations job).
 *
 * The workflow files are parsed with the `yaml` package (present in the
 * dependency tree already) rather than hand-rolled regex where structure
 * matters (triggers, job/step shape); free-form step command bodies are
 * matched against the raw file text where a step's exact command mix would
 * otherwise force this spec to assume a specific job/step *name* the
 * implementation is free to choose.
 *
 * RED PHASE: `.github/` does not exist at all yet (confirmed: a repo-wide
 * search for any `.github` path segment is empty at baseline). Every test below MUST fail until
 * this story lands the workflow files — the "exists" tests fail on a false
 * `existsSync`, and every structural test fails on `parsed` being
 * `undefined` (this file's `expect(parsed).toBeDefined()` step).
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

const ROOT = path.resolve(import.meta.dirname, '../..')
const WORKFLOWS_DIR = path.join(ROOT, '.github/workflows')
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json')

type Step = { uses?: string; run?: string; with?: Record<string, unknown>; name?: string }
type Job = {
  'runs-on'?: string
  environment?: unknown
  concurrency?: unknown
  steps?: Step[]
}
type WorkflowDoc = {
  on?: Record<string, unknown>
  concurrency?: unknown
  jobs?: Record<string, Job>
}

function readWorkflowText(filename: string): string {
  const p = path.join(WORKFLOWS_DIR, filename)
  if (!existsSync(p)) return ''
  return readFileSync(p, 'utf-8')
}

function parseWorkflow(filename: string): WorkflowDoc | undefined {
  const text = readWorkflowText(filename)
  if (!text) return undefined
  return parseYaml(text) as WorkflowDoc
}

/** Flattens every step across every job into one array, in file order. */
function allSteps(doc: WorkflowDoc | undefined): Step[] {
  if (!doc?.jobs) return []
  const out: Step[] = []
  for (const job of Object.values(doc.jobs)) {
    if (job.steps) out.push(...job.steps)
  }
  return out
}

function allJobs(doc: WorkflowDoc | undefined): Job[] {
  if (!doc?.jobs) return []
  return Object.values(doc.jobs)
}

/** Joined `run`/`uses` text of every step, for substring/regex checks. */
function stepsText(steps: Step[]): string {
  return steps.map((s) => `${s.uses ?? ''}\n${s.run ?? ''}`).join('\n')
}

function findStepByUses(steps: Step[], pattern: RegExp): Step | undefined {
  return steps.find((s) => s.uses && pattern.test(s.uses))
}

/** Index of the first step in `steps` whose run/uses text matches `pattern`. */
function indexOfStep(steps: Step[], pattern: RegExp): number {
  return steps.findIndex((s) => pattern.test(`${s.uses ?? ''}\n${s.run ?? ''}`))
}

function readPackageJson(): { scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8'))
}

// ─────────────────────────────────────────────────────────────────────────
// .github/workflows/ci.yml
// ─────────────────────────────────────────────────────────────────────────

describe('.github/workflows/ci.yml — exists and parses as a workflow', () => {
  it('the file exists', () => {
    expect(existsSync(path.join(WORKFLOWS_DIR, 'ci.yml'))).toBe(true)
  })

  it('parses as valid YAML with an `on` and `jobs` block', () => {
    const doc = parseWorkflow('ci.yml')
    expect(doc).toBeDefined()
    expect(doc?.on).toBeDefined()
    expect(doc?.jobs).toBeDefined()
  })
})

describe('.github/workflows/ci.yml — triggers on every PR and on push to main', () => {
  it('triggers on pull_request', () => {
    const doc = parseWorkflow('ci.yml')
    expect(doc?.on).toHaveProperty('pull_request')
  })

  it('triggers on push to main (for status history), not on tags', () => {
    const doc = parseWorkflow('ci.yml')
    const push = doc?.on?.push as { branches?: string[]; tags?: unknown } | undefined
    expect(push).toBeDefined()
    expect(push?.branches).toContain('main')
    expect(push?.tags).toBeUndefined()
  })
})

describe('.github/workflows/ci.yml — runs on ubuntu-latest', () => {
  it('every job runs on ubuntu-latest', () => {
    const doc = parseWorkflow('ci.yml')
    const jobs = allJobs(doc)
    expect(jobs.length).toBeGreaterThan(0)
    for (const job of jobs) {
      expect(job['runs-on']).toBe('ubuntu-latest')
    }
  })
})

describe('.github/workflows/ci.yml — pinned Node 22 + Corepack-activated Yarn 4.5.0', () => {
  it('sets up actions/setup-node@v4 pinned to node-version 22, with yarn dependency caching', () => {
    const doc = parseWorkflow('ci.yml')
    const steps = allSteps(doc)
    const setupNode = findStepByUses(steps, /actions\/setup-node@v4/)
    expect(setupNode).toBeDefined()
    expect(String(setupNode?.with?.['node-version']).trim()).toBe('22')
    expect(String(setupNode?.with?.cache ?? '').toLowerCase()).toBe('yarn')
  })

  it('runs `corepack enable` before `yarn install --immutable`, in the same job', () => {
    const doc = parseWorkflow('ci.yml')
    for (const job of allJobs(doc)) {
      const steps = job.steps ?? []
      const installIdx = indexOfStep(steps, /yarn install --immutable/)
      if (installIdx === -1) continue
      const corepackIdx = indexOfStep(steps, /corepack enable/)
      expect(corepackIdx).toBeGreaterThanOrEqual(0)
      expect(corepackIdx).toBeLessThan(installIdx)
    }
    // At least one job must actually contain the install step.
    const flatInstallIdx = indexOfStep(allSteps(doc), /yarn install --immutable/)
    expect(flatInstallIdx).toBeGreaterThanOrEqual(0)
  })

  it('uses the Berry immutable-install flag, never the Yarn 1 --frozen-lockfile flag', () => {
    const text = readWorkflowText('ci.yml')
    expect(text).toMatch(/yarn install --immutable\b/)
    expect(text).not.toMatch(/--frozen-lockfile/)
  })
})

describe('.github/workflows/ci.yml — build, typecheck, and the CI-safe Vitest invocation', () => {
  it('runs the root `yarn build` (never an app-level `next build`)', () => {
    const text = readWorkflowText('ci.yml')
    expect(text).toMatch(/\byarn build\b/)
    expect(text).not.toMatch(/apps\/(web|desktop)[^\n]*next build/)
    expect(text).not.toMatch(/\bnext build\b.*apps\/(web|desktop)/)
    expect(text).not.toMatch(/\byarn dev\b/)
    expect(text).not.toMatch(/\bnext dev\b/)
  })

  it('runs `yarn typecheck` (required because `yarn build` uses --skip-types)', () => {
    const text = readWorkflowText('ci.yml')
    expect(text).toMatch(/\byarn typecheck\b/)
  })

  it('runs the CI-safe Vitest invocation excluding BOTH dev.test.ts and build.test.ts, never bare `yarn test`', () => {
    // The verified-safe form may be the raw CLI invocation, or a `test:ci`
    // package script encoding both excludes (recommended, since CLI
    // `--exclude` may override rather than merge the config's exclude
    // array) — accept either by inspecting the union of workflow text and
    // package.json script bodies.
    const workflowText = readWorkflowText('ci.yml')
    const pkg = readPackageJson()
    const scriptsText = JSON.stringify(pkg.scripts ?? {})
    const combined = `${workflowText}\n${scriptsText}`

    expect(combined).toMatch(/--exclude ['"]\*\*\/build\.test\.ts['"]/)
    expect(combined).toMatch(/--exclude ['"]\*\*\/dev\.test\.ts['"]/)

    // Bare `yarn test` (no excludes) must never appear as the CI test step —
    // it would collect and hang on apps/{web,desktop}/__tests__/dev.test.ts.
    expect(workflowText).not.toMatch(/run:\s*yarn test\s*$/m)
  })
})

describe('.github/workflows/ci.yml — format/lint gate', () => {
  it('runs a biome check step', () => {
    const text = readWorkflowText('ci.yml')
    expect(text).toMatch(/biome check/)
  })

  it('runs the PostHog event-allowlist lint (`yarn lint:posthog`)', () => {
    const text = readWorkflowText('ci.yml')
    expect(text).toMatch(/\byarn lint:posthog\b/)
  })

  it('runs the Edge Function logging/encryption-boundary lint (`yarn lint:edge-logging`)', () => {
    const text = readWorkflowText('ci.yml')
    expect(text).toMatch(/\byarn lint:edge-logging\b/)
  })

  it('invokes the boundary-rule lint (script or inline greps) somewhere in the job', () => {
    const text = readWorkflowText('ci.yml')
    const pkg = readPackageJson()
    const scriptsText = JSON.stringify(pkg.scripts ?? {})
    const referencesBoundaryScript = /lint-boundaries\.mjs/.test(`${text}\n${scriptsText}`)
    const referencesBoundaryYarnEntry = /\byarn lint:boundaries\b/.test(text)
    expect(referencesBoundaryScript || referencesBoundaryYarnEntry).toBe(true)
  })
})

describe('.github/workflows/ci.yml — Deno Edge-Function test step', () => {
  it('sets up Deno via denoland/setup-deno, pinned to the locally-verified 2.9.2 (not a floating 2.x)', () => {
    const doc = parseWorkflow('ci.yml')
    const steps = allSteps(doc)
    const setupDeno = findStepByUses(steps, /denoland\/setup-deno/)
    expect(setupDeno).toBeDefined()
    expect(String(setupDeno?.with?.['deno-version'] ?? '').trim()).toBe('2.9.2')
  })

  it('runs `deno test` against supabase/functions/ with at least --allow-read and --allow-env', () => {
    const text = readWorkflowText('ci.yml')
    expect(text).toMatch(/deno test[^\n]*--allow-read/)
    expect(text).toMatch(/deno test[^\n]*--allow-env/)
    expect(text).toMatch(/deno test[^\n]*supabase\/functions/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// .github/workflows/migrations.yml
// ─────────────────────────────────────────────────────────────────────────

describe('.github/workflows/migrations.yml — exists and parses as a workflow', () => {
  it('the file exists', () => {
    expect(existsSync(path.join(WORKFLOWS_DIR, 'migrations.yml'))).toBe(true)
  })

  it('parses as valid YAML with an `on` and `jobs` block', () => {
    const doc = parseWorkflow('migrations.yml')
    expect(doc).toBeDefined()
    expect(doc?.on).toBeDefined()
    expect(doc?.jobs).toBeDefined()
  })
})

describe('.github/workflows/migrations.yml — triggers only on a path-filtered push to main', () => {
  it('triggers on push to main, path-filtered to supabase/migrations/**', () => {
    const doc = parseWorkflow('migrations.yml')
    const push = doc?.on?.push as { branches?: string[]; paths?: string[] } | undefined
    expect(push).toBeDefined()
    expect(push?.branches).toContain('main')
    expect(push?.paths).toBeDefined()
    expect(push?.paths?.some((p) => p.includes('supabase/migrations'))).toBe(true)
  })

  it('never triggers on pull_request (migrations apply only after merge, under approval)', () => {
    const doc = parseWorkflow('migrations.yml')
    expect(doc?.on).not.toHaveProperty('pull_request')
  })
})

describe('.github/workflows/migrations.yml — human-approval Environment gate', () => {
  it('the apply job is bound to a GitHub Environment (e.g. "production")', () => {
    const doc = parseWorkflow('migrations.yml')
    const jobs = allJobs(doc)
    const gated = jobs.some((job) => {
      if (!job.environment) return false
      const envName =
        typeof job.environment === 'string'
          ? job.environment
          : (job.environment as { name?: string }).name
      return typeof envName === 'string' && envName.length > 0
    })
    expect(gated).toBe(true)
  })
})

describe('.github/workflows/migrations.yml — forward-only linter runs and gates the apply', () => {
  it('invokes the forward-only migration linter somewhere in the job', () => {
    const text = readWorkflowText('migrations.yml')
    const pkg = readPackageJson()
    const scriptsText = JSON.stringify(pkg.scripts ?? {})
    const combined = `${text}\n${scriptsText}`
    expect(combined).toMatch(/lint-forward-only-migrations\.mjs|lint:forward-only-migrations/)
  })

  it('runs the forward-only linter BEFORE `supabase db push` in the same job (fail-closed ordering)', () => {
    const doc = parseWorkflow('migrations.yml')
    for (const job of allJobs(doc)) {
      const steps = job.steps ?? []
      const pushIdx = indexOfStep(steps, /supabase db push/)
      if (pushIdx === -1) continue
      const lintIdx = indexOfStep(
        steps,
        /lint-forward-only-migrations\.mjs|lint:forward-only-migrations/
      )
      expect(lintIdx).toBeGreaterThanOrEqual(0)
      expect(lintIdx).toBeLessThan(pushIdx)
    }
    // At least one job must actually contain the db push step.
    expect(indexOfStep(allSteps(doc), /supabase db push/)).toBeGreaterThanOrEqual(0)
  })

  it('applies via `supabase db push` referencing the service-role secret, never a hardcoded credential', () => {
    const text = readWorkflowText('migrations.yml')
    expect(text).toMatch(/supabase db push/)
    expect(text).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
    expect(text).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"][^$][^'"]*['"]/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// .github/workflows/eas.yml
// ─────────────────────────────────────────────────────────────────────────

describe('.github/workflows/eas.yml — exists and parses as a workflow', () => {
  it('the file exists', () => {
    expect(existsSync(path.join(WORKFLOWS_DIR, 'eas.yml'))).toBe(true)
  })

  it('parses as valid YAML with an `on` and `jobs` block', () => {
    const doc = parseWorkflow('eas.yml')
    expect(doc).toBeDefined()
    expect(doc?.on).toBeDefined()
    expect(doc?.jobs).toBeDefined()
  })
})

describe('.github/workflows/eas.yml — fires ONLY on mobile-v* release tags', () => {
  it('triggers on push tags matching mobile-v*', () => {
    const doc = parseWorkflow('eas.yml')
    const push = doc?.on?.push as { tags?: string[] } | undefined
    expect(push?.tags).toBeDefined()
    expect(push?.tags?.some((t) => t.includes('mobile-v'))).toBe(true)
  })

  it('never triggers on pull_request', () => {
    const doc = parseWorkflow('eas.yml')
    expect(doc?.on).not.toHaveProperty('pull_request')
  })

  it('never triggers on an ordinary branch push (no `push.branches`)', () => {
    const doc = parseWorkflow('eas.yml')
    const push = doc?.on?.push as { branches?: unknown; tags?: unknown } | undefined
    // Guard: the workflow must actually declare a tag-triggered push (not just
    // "no push trigger at all", which would trivially satisfy "no branches").
    expect(push?.tags).toBeDefined()
    expect(push?.branches).toBeUndefined()
  })

  it('has no unguarded workflow_dispatch trigger (a paid iOS+Android build must not be one manual click away with no gate)', () => {
    const doc = parseWorkflow('eas.yml')
    expect(doc?.on).not.toHaveProperty('workflow_dispatch')
  })
})

describe('.github/workflows/eas.yml — concurrency guard against retag storms', () => {
  it('declares a concurrency group with cancel-in-progress: true', () => {
    const doc = parseWorkflow('eas.yml')
    const concurrency = (doc?.concurrency ??
      allJobs(doc).find((j) => j.concurrency)?.concurrency) as
      | { group?: string; ['cancel-in-progress']?: boolean }
      | undefined
    expect(concurrency).toBeDefined()
    expect(concurrency?.group).toBeTruthy()
    expect(concurrency?.['cancel-in-progress']).toBe(true)
  })
})

describe('.github/workflows/eas.yml — builds production for both platforms, no submission side effects', () => {
  it('sets up Node 22 and authenticates via the EXPO_TOKEN secret', () => {
    const doc = parseWorkflow('eas.yml')
    const steps = allSteps(doc)
    const setupNode = findStepByUses(steps, /actions\/setup-node@v4/)
    expect(setupNode).toBeDefined()
    expect(String(setupNode?.with?.['node-version']).trim()).toBe('22')
    const text = readWorkflowText('eas.yml')
    expect(text).toMatch(/EXPO_TOKEN/)
  })

  it('runs `eas build --profile production` for both ios and android, from apps/mobile', () => {
    const text = readWorkflowText('eas.yml')
    expect(text).toMatch(/eas build[^\n]*--profile production[^\n]*--platform ios/)
    expect(text).toMatch(/eas build[^\n]*--profile production[^\n]*--platform android/)
    expect(text).toMatch(/apps\/mobile/)
  })

  it('never passes --auto-submit (no store-submission side effects)', () => {
    const text = readWorkflowText('eas.yml')
    // Guard: the workflow must actually exist and contain a real eas build
    // invocation (not just "the file is empty/missing", which would
    // trivially satisfy "does not contain --auto-submit").
    expect(text).toMatch(/eas build/)
    expect(text).not.toMatch(/--auto-submit/)
  })
})
