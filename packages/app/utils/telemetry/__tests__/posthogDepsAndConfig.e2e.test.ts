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
    expect(existsSync(path.join(ROOT, 'packages/app/utils/telemetry/posthog.native.ts'))).toBe(true)
  })

  it('packages/app/utils/telemetry/eventAllowlist.ts exists (SDK-free single source of truth)', () => {
    expect(existsSync(path.join(ROOT, 'packages/app/utils/telemetry/eventAllowlist.ts'))).toBe(true)
  })
})

describe('— telemetry init is consent-gated in initializeApp (opt-in), not eager at the entries', () => {
  it('initializeApp.ts calls initSentry() then initPostHog(), gated on the persisted consent flag', () => {
    const file = readText('packages/app/state/initializeApp.ts')
    expect(file).toMatch(/initSentry\s*\(\s*\)/)
    expect(file).toMatch(/initPostHog\s*\(\s*\)/)
    expect(file).toMatch(/telemetryConsent\$\.enabled\.peek\(\)/)
    // initPostHog runs right after initSentry, both inside the consent gate.
    const sentryIdx = file.indexOf('initSentry()')
    const postHogIdx = file.indexOf('initPostHog()')
    expect(sentryIdx).toBeGreaterThan(-1)
    expect(postHogIdx).toBeGreaterThan(sentryIdx)
  })

  it('web/desktop instrumentation-client.ts no longer eagerly init but still export onRouterTransitionStart', () => {
    for (const rel of [
      'apps/web/instrumentation-client.ts',
      'apps/desktop/instrumentation-client.ts',
    ]) {
      const file = readText(rel)
      expect(file).toContain('onRouterTransitionStart')
      // Opt-in: init must NOT run at module load (before persistence).
      expect(file).not.toMatch(/initSentry\s*\(\s*\)/)
      expect(file).not.toMatch(/initPostHog\s*\(\s*\)/)
    }
  })

  it('apps/mobile/app/_layout.tsx keeps the eager mutations import but no longer eagerly inits telemetry', () => {
    const file = readText('apps/mobile/app/_layout.tsx')
    expect(file).toContain(`import 'app/state/collective/mutations'`)
    expect(file).not.toMatch(/initSentry\s*\(\s*\)/)
    expect(file).not.toMatch(/initPostHog\s*\(\s*\)/)
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
  it('apps/mobile/eas.json declares EXPO_PUBLIC_POSTHOG_KEY in the preview and production profiles (present, intentionally empty until a real key is minted), preserving existing Supabase/Sentry env vars', () => {
    const eas = readJson('apps/mobile/eas.json')
    expect(eas.build.preview.env).toHaveProperty('EXPO_PUBLIC_POSTHOG_KEY')
    expect(eas.build.production.env).toHaveProperty('EXPO_PUBLIC_POSTHOG_KEY')
    // Existing env vars in those profiles must survive the edit.
    expect(eas.build.preview.env?.EXPO_PUBLIC_SUPABASE_URL).toBeTruthy()
    expect(eas.build.production.env?.EXPO_PUBLIC_SUPABASE_URL).toBeTruthy()
    expect(eas.build.preview.env).toHaveProperty('EXPO_PUBLIC_SENTRY_DSN')
    expect(eas.build.production.env).toHaveProperty('EXPO_PUBLIC_SENTRY_DSN')
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
