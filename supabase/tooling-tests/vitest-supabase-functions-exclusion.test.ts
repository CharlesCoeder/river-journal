// Gate test: the root vitest.config.mts has no `include`, so it applies
// Vitest's default whole-repo glob and relies solely on its `exclude` list.
// That list does not (yet, in red phase) contain a `supabase/**` /
// `supabase/functions/**` entry. supabase/functions/** is Deno 2 code (URL /
// `npm:` / `jsr:` imports, `Deno.*` globals) colocated with `*.test.ts` files
// that Vitest's default glob otherwise matches and tries to collect -- which
// crashes the run (Deno-only import specifiers do not resolve under Vite).
//
// This test spawns the real `vitest list` CLI (collection only, no test
// execution) scoped to the `supabase` path and asserts that ZERO files under
// supabase/functions/ are collected. It is intentionally NOT placed under
// supabase/functions/ (so it is unaffected by the very exclude pattern it is
// asserting on) and NOT placed under supabase/tests/ (pgTAP's `.sql`-only
// convention; a `.test.ts` there would still run under Vitest today, but the
// directory's purpose is pgTAP, not Vitest meta-tests).
//
// Red phase: fails today because supabase/functions/**/*.test.ts (the Deno
// unit tests colocated with the envelope + function scaffold) ARE collected
// -- proving a real CI hazard. It passes once
// '**/supabase/functions/**' is added to vitest.config.mts's `test.exclude`
// array (an implementation change, not part of this test-generation pass).

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const vitestBin = path.join(repoRoot, 'node_modules', '.bin', 'vitest')

interface ListedFile {
  file: string
}

function listCollectedFiles(pattern: string): ListedFile[] {
  let stdout: string
  try {
    stdout = execFileSync(vitestBin, ['list', pattern, '--filesOnly', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      // `vitest list` still boots Vite; give it real headroom in CI/sandboxes.
      timeout: 60_000,
    })
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message: string }
    // A hard crash while COLLECTING is itself evidence of the hazard (Vite
    // failing to resolve a `jsr:`/`npm:`/URL specifier from a Deno file) --
    // surface it as a readable failure rather than letting the raw spawn
    // exception propagate.
    throw new Error(
      `vitest list ${pattern} --filesOnly --json crashed instead of returning a file list ` +
        `(this itself demonstrates the collection hazard):\n${execError.stdout ?? ''}\n${execError.stderr ?? execError.message}`
    )
  }

  try {
    return JSON.parse(stdout) as ListedFile[]
  } catch {
    throw new Error(`vitest list did not return parseable JSON:\n${stdout}`)
  }
}

describe('vitest.config.mts excludes supabase/functions (Deno) from collection', () => {
  it('collects zero test files under supabase/functions', () => {
    const collected = listCollectedFiles('supabase')
    const collectedUnderFunctions = collected
      .map((entry) => entry.file)
      .filter((file) => file.includes(`${path.sep}supabase${path.sep}functions${path.sep}`))

    expect(collectedUnderFunctions).toEqual([])
  })
})
