/**
 * posthogDepsAndConfig.e2e.test.ts — TDD RED-PHASE E2E spec for the
 * scaffolding/wiring surface of "PostHog init + event allowlist + CI lint
 * check": new dependencies, new shared TS files, client init call sites,
 * the auth identify wiring, the EAS env-wiring, and the new `lint:posthog`
 * yarn entry.
 *
 * There is no pure-function surface for "a dependency is installed" or "a
 * call site imports and calls a function" — this spec exercises the actual
 * on-disk artifacts an operator/CI/build would read, mirroring this repo's
 * existing convention for scaffolding/wiring checks
 * (packages/app/utils/telemetry/__tests__/depsAndConfig.e2e.test.ts, the
 * existing Sentry telemetry precedent).
 *
 * RED PHASE: none of these additions exist yet (grep-confirmed zero
 * `posthog` references anywhere in the repo before this story). Every test
 * below MUST fail until this story is implemented.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../../../../..')

function readJson(relPath: string): any {
  return JSON.parse(readFileSync(path.join(ROOT, relPath), 'utf-8'))
}

function readText(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8')
}

describe('— new PostHog dependencies exist', () => {
  it('apps/web/package.json depends on posthog-js', () => {
    const pkg = readJson('apps/web/package.json')
    expect(pkg.dependencies?.['posthog-js']).toBeTruthy()
  })

  it('apps/desktop/package.json depends on posthog-js', () => {
    const pkg = readJson('apps/desktop/package.json')
    expect(pkg.dependencies?.['posthog-js']).toBeTruthy()
  })

  it('apps/mobile/package.json depends on posthog-react-native', () => {
    const pkg = readJson('apps/mobile/package.json')
    expect(pkg.dependencies?.['posthog-react-native']).toBeTruthy()
  })
})

describe('— new shared TS files exist', () => {
  it('packages/app/utils/telemetry/posthog.ts exists (web/desktop init)', () => {
    expect(existsSync(path.join(ROOT, 'packages/app/utils/telemetry/posthog.ts'))).toBe(true)
  })

  it('packages/app/utils/telemetry/posthog.native.ts exists (mobile init)', () => {
    expect(existsSync(path.join(ROOT, 'packages/app/utils/telemetry/posthog.native.ts'))).toBe(
      true
    )
  })

  it('packages/app/utils/telemetry/eventAllowlist.ts exists (SDK-free single source of truth)', () => {
    expect(existsSync(path.join(ROOT, 'packages/app/utils/telemetry/eventAllowlist.ts'))).toBe(
      true
    )
  })
})

describe('— client init call sites exist and call initPostHog() after initSentry()', () => {
  it('apps/web/instrumentation-client.ts imports and calls initPostHog(), and initSentry()/onRouterTransitionStart survive', () => {
    const file = readText('apps/web/instrumentation-client.ts')
    expect(file).toMatch(/initPostHog\s*\(\s*\)/)
    // Do not regress the existing Sentry wiring this story must not disturb.
    expect(file).toMatch(/initSentry\s*\(\s*\)/)
    expect(file).toContain('onRouterTransitionStart')
    // initPostHog must run after initSentry (Dev Notes: "Add initPostHog()
    // immediately after initSentry(); do not disturb the existing lines").
    const sentryIdx = file.indexOf('initSentry()')
    const postHogIdx = file.indexOf('initPostHog()')
    expect(sentryIdx).toBeGreaterThan(-1)
    expect(postHogIdx).toBeGreaterThan(sentryIdx)
  })

  it('apps/desktop/instrumentation-client.ts imports and calls initPostHog() after initSentry(), and onRouterTransitionStart survives', () => {
    const file = readText('apps/desktop/instrumentation-client.ts')
    expect(file).toMatch(/initPostHog\s*\(\s*\)/)
    expect(file).toMatch(/initSentry\s*\(\s*\)/)
    expect(file).toContain('onRouterTransitionStart')
    const sentryIdx = file.indexOf('initSentry()')
    const postHogIdx = file.indexOf('initPostHog()')
    expect(sentryIdx).toBeGreaterThan(-1)
    expect(postHogIdx).toBeGreaterThan(sentryIdx)
  })

  it('apps/mobile/app/_layout.tsx calls initPostHog() after initSentry(), which itself stays after the eager mutations import', () => {
    const file = readText('apps/mobile/app/_layout.tsx')
    expect(file).toMatch(/initPostHog\s*\(\s*\)/)

    const mutationsIdx = file.indexOf(`import 'app/state/collective/mutations'`)
    const sentryImportIdx = file.indexOf('initSentry()')
    const postHogIdx = file.indexOf('initPostHog()')

    expect(mutationsIdx).toBeGreaterThan(-1)
    expect(sentryImportIdx).toBeGreaterThan(mutationsIdx)
    expect(postHogIdx).toBeGreaterThan(sentryImportIdx)
  })
})

describe('— auth session lifecycle identifies/resets the PostHog user next to Sentry', () => {
  it('packages/app/utils/auth.ts updateSessionState calls identifyPostHogUser(session?.user?.id ?? null) alongside setSentryUser', () => {
    const file = readText('packages/app/utils/auth.ts')
    expect(file).toMatch(/identifyPostHogUser/)
    // Same null-on-sign-out semantics as the existing Sentry call.
    expect(file).toMatch(/identifyPostHogUser\(\s*session\?\.user\?\.id\s*\?\?\s*null\s*\)/)
    // The existing Sentry call must survive untouched.
    expect(file).toMatch(/setSentryUser\(\s*session\?\.user\?\.id\s*\?\?\s*null\s*\)/)
  })
})

describe('— EAS cloud builds carry the PostHog keys', () => {
  it('apps/mobile/eas.json adds EXPO_PUBLIC_POSTHOG_KEY to the preview and production profiles, preserving existing Supabase/Sentry env vars', () => {
    const eas = readJson('apps/mobile/eas.json')
    expect(eas.build.preview.env?.EXPO_PUBLIC_POSTHOG_KEY).toBeTruthy()
    expect(eas.build.production.env?.EXPO_PUBLIC_POSTHOG_KEY).toBeTruthy()
    // Existing env vars in those profiles must survive the edit.
    expect(eas.build.preview.env?.EXPO_PUBLIC_SUPABASE_URL).toBeTruthy()
    expect(eas.build.production.env?.EXPO_PUBLIC_SUPABASE_URL).toBeTruthy()
    expect(eas.build.preview.env?.EXPO_PUBLIC_SENTRY_DSN).toBeTruthy()
    expect(eas.build.production.env?.EXPO_PUBLIC_SENTRY_DSN).toBeTruthy()
    // Dev-client builds (development/simulator) stay quiet — no key there.
    expect(eas.build.development.env?.EXPO_PUBLIC_POSTHOG_KEY).toBeFalsy()
    expect(eas.build.simulator.env?.EXPO_PUBLIC_POSTHOG_KEY).toBeFalsy()
  })
})

describe('— the CI lint check has a runnable yarn entry', () => {
  it('root package.json declares a "lint:posthog" script that runs the lint script', () => {
    const pkg = readJson('package.json')
    expect(pkg.scripts?.['lint:posthog']).toBeTruthy()
    expect(pkg.scripts?.['lint:posthog']).toMatch(/scripts\/lint-posthog-events\.mjs/)
    // Existing scripts (a representative sample) must survive the edit.
    expect(pkg.scripts?.typecheck).toBeTruthy()
    expect(pkg.scripts?.test).toBeTruthy()
  })
})
