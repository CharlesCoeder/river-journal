/**
 * depsAndConfig.e2e.test.ts — TDD RED-PHASE E2E spec for ("new
 * dependencies + files exist") and ("source maps + symbolication
 * configured") of this story.
 *
 * These two ACs are about installation/wiring across THREE platforms plus a
 * Rust crate — there is no pure-function surface to unit test, so this spec
 * exercises the actual on-disk artifacts an operator/CI would rely on: the
 * package manifests, the Cargo manifest, the Next config wrapping, the Expo
 * plugin registration, and the EAS env wiring. This is the closest thing to
 * an "end-to-end" check for a scaffolding/config AC — it reads the real
 * files a build would read, not a mock.
 *
 * RED PHASE: none of these additions exist yet (grep-confirmed zero
 * `sentry`/`telemetry` references anywhere in the repo before this story).
 * Every test below MUST fail until this story is implemented.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../../../../..')

function readJson(relPath: string): any {
  return JSON.parse(readFileSync(path.join(ROOT, relPath), 'utf-8'))
}

function readText(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8')
}

describe('— new dependencies exist', () => {
  it('apps/web/package.json depends on @sentry/nextjs', () => {
    const pkg = readJson('apps/web/package.json')
    expect(pkg.dependencies?.['@sentry/nextjs']).toBeTruthy()
  })

  it('apps/desktop/package.json depends on @sentry/nextjs', () => {
    const pkg = readJson('apps/desktop/package.json')
    expect(pkg.dependencies?.['@sentry/nextjs']).toBeTruthy()
  })

  it('apps/mobile/package.json depends on @sentry/react-native', () => {
    const pkg = readJson('apps/mobile/package.json')
    expect(pkg.dependencies?.['@sentry/react-native']).toBeTruthy()
  })

  it('apps/desktop/src-tauri/Cargo.toml declares the `sentry` crate as a dependency', () => {
    const cargoToml = readText('apps/desktop/src-tauri/Cargo.toml')
    const dependenciesSection = cargoToml.split(/^\[dependencies\]/m)[1] ?? ''
    // Must be the crate literally named `sentry` (the epic's "sentry-rust"
    // label refers to the getsentry/sentry-rust GitHub repo, not the crate
    // name) — match a `sentry = ` or `sentry = {` line, not `sentry-log` etc.
    expect(dependenciesSection).toMatch(/^sentry\s*=/m)
  })
})

describe('— new shared TS files exist', () => {
  it('packages/app/utils/telemetry/sentry.ts exists (web/desktop init + beforeSend)', () => {
    expect(existsSync(path.join(ROOT, 'packages/app/utils/telemetry/sentry.ts'))).toBe(true)
  })

  it('packages/app/utils/telemetry/sentry.native.ts exists (mobile init + same beforeSend)', () => {
    expect(existsSync(path.join(ROOT, 'packages/app/utils/telemetry/sentry.native.ts'))).toBe(true)
  })

  it('packages/app/utils/telemetry/contentKeys.ts exists', () => {
    expect(existsSync(path.join(ROOT, 'packages/app/utils/telemetry/contentKeys.ts'))).toBe(true)
  })

  it('packages/app/utils/telemetry/redactor.ts exists', () => {
    expect(existsSync(path.join(ROOT, 'packages/app/utils/telemetry/redactor.ts'))).toBe(true)
  })
})

describe('— telemetry init is consent-gated in initializeApp (opt-in), not eager at the entry', () => {
  it('initializeApp.ts calls initSentry() gated on the persisted telemetry consent flag', () => {
    const file = readText('packages/app/state/initializeApp.ts')
    expect(file).toMatch(/initSentry\s*\(\s*\)/)
    // The gate reads the persisted consent flag synchronously after load.
    expect(file).toMatch(/telemetryConsent\$\.enabled\.peek\(\)/)
  })

  it('web/desktop instrumentation-client.ts still export onRouterTransitionStart (unchanged Sentry route hook)', () => {
    for (const rel of [
      'apps/web/instrumentation-client.ts',
      'apps/desktop/instrumentation-client.ts',
    ]) {
      const file = readText(rel)
      expect(file).toContain('onRouterTransitionStart')
    }
  })
})

describe('— Tauri (Rust) shell adds sentry crate init', () => {
  it('apps/desktop/src-tauri/src/lib.rs initializes sentry in run() without disturbing existing command handlers', () => {
    const lib = readText('apps/desktop/src-tauri/src/lib.rs')
    expect(lib).toMatch(/sentry::init/)
    // The four existing crypto commands must still be registered.
    for (const command of [
      'set_encryption_key',
      'get_encryption_key',
      'delete_encryption_key',
      'derive_encryption_key',
    ]) {
      expect(lib).toContain(command)
    }
    // Key material must never be attached to Sentry — a crude but real
    // regression guard against a future dev logging Zeroizing<String> values.
    expect(lib).not.toMatch(/sentry::[^;]*key_b64/)
  })
})

describe('— source map / symbolication scaffolding is wired into each build pipeline', () => {
  it('apps/web/next.config.js is wrapped with withSentryConfig and preserves existing headers()/transpilePackages/turbopack config', () => {
    const config = readText('apps/web/next.config.js')
    expect(config).toMatch(/withSentryConfig/)
    // Preserve existing keys (design notes: "preserve all existing keys").
    expect(config).toContain('X-Frame-Options')
    expect(config).toContain('transpilePackages')
    expect(config).toContain('turbopack')
  })

  it('apps/desktop/next.config.js is wrapped with withSentryConfig and preserves output: "export" (static SPA)', () => {
    const config = readText('apps/desktop/next.config.js')
    expect(config).toMatch(/withSentryConfig/)
    expect(config).toMatch(/output:\s*['"]export['"]/)
    expect(config).toContain('NEXT_PUBLIC_IS_DESKTOP_APP')
    expect(config).toContain('trailingSlash')
  })

  it('apps/mobile/app.config.js registers the @sentry/react-native Expo config plugin, preserving the existing plugin list', () => {
    // The mobile Expo config is a CommonJS module (it branches on APP_VARIANT),
    // so evaluate it rather than parse it; unset, it yields the production app.
    const appConfig = createRequire(import.meta.url)(path.join(ROOT, 'apps/mobile/app.config.js'))
    const plugins: unknown[] = appConfig.expo.plugins
    const hasSentryPlugin = plugins.some(
      (p) =>
        (typeof p === 'string' && p.includes('sentry')) ||
        (Array.isArray(p) && String(p[0]).includes('sentry'))
    )
    expect(hasSentryPlugin).toBe(true)
    // Existing plugins must survive the append.
    for (const existing of ['expo-router', 'expo-font', 'expo-web-browser', 'expo-notifications']) {
      expect(plugins).toContain(existing)
    }
  })

  it('apps/mobile/eas.json declares EXPO_PUBLIC_SENTRY_DSN in the preview and production profiles (present; value may be empty — an empty DSN cleanly disables the SDK)', () => {
    const eas = readJson('apps/mobile/eas.json')
    expect(eas.build.preview.env).toHaveProperty('EXPO_PUBLIC_SENTRY_DSN')
    expect(eas.build.production.env).toHaveProperty('EXPO_PUBLIC_SENTRY_DSN')
    // Existing Supabase env vars in those profiles must survive the edit.
    expect(eas.build.preview.env?.EXPO_PUBLIC_SUPABASE_URL).toBeTruthy()
    expect(eas.build.production.env?.EXPO_PUBLIC_SUPABASE_URL).toBeTruthy()
  })
})

describe('/— build-time-only Sentry secrets never carry a client-exposed prefix', () => {
  it('SENTRY_AUTH_TOKEN is not referenced with a NEXT_PUBLIC_/EXPO_PUBLIC_ prefix anywhere in web/desktop/mobile config', () => {
    const files = [
      'apps/web/next.config.js',
      'apps/desktop/next.config.js',
      'apps/mobile/app.config.js',
      'apps/mobile/eas.json',
    ]
    for (const relPath of files) {
      if (!existsSync(path.join(ROOT, relPath))) continue
      const content = readText(relPath)
      expect(content).not.toMatch(/NEXT_PUBLIC_SENTRY_AUTH_TOKEN/)
      expect(content).not.toMatch(/EXPO_PUBLIC_SENTRY_AUTH_TOKEN/)
    }
  })
})
