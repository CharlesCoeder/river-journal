// telemetryConsent$ observable + setter — pure state unit tests.
//
// Mirrors the state/onboarding.ts / onboarding.test.ts precedent: this file
// exercises only the plain Legend-State observable + setter (persistence wiring
// in initializeApp.ts is not under test here). The observable is reset to its
// initial shape in beforeEach.
//
// Coverage:
//   - default OFF (telemetry is opt-in)
//   - setTelemetryConsentEnabled writes the flag both ways
//   - device-local / never-synced: structural guard on the module source

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { setTelemetryConsentEnabled, telemetryConsent$ } from '../telemetryConsent'

beforeEach(() => {
  telemetryConsent$.set({ enabled: false })
})

describe('telemetryConsent$ initial state', () => {
  it('defaults enabled to false (telemetry is opt-in)', () => {
    expect(telemetryConsent$.enabled.get()).toBe(false)
  })
})

describe('setTelemetryConsentEnabled — writes the flag', () => {
  it('turns consent ON', () => {
    setTelemetryConsentEnabled(true)
    expect(telemetryConsent$.enabled.get()).toBe(true)
  })

  it('turns consent back OFF', () => {
    setTelemetryConsentEnabled(true)
    setTelemetryConsentEnabled(false)
    expect(telemetryConsent$.enabled.get()).toBe(false)
  })

  it('is readable synchronously via peek (used by the SDK init predicates)', () => {
    setTelemetryConsentEnabled(true)
    expect(telemetryConsent$.enabled.peek()).toBe(true)
  })
})

describe('telemetryConsent.ts source — device-local, never synced, no SDK coupling', () => {
  const modulePath = path.resolve(__dirname, '../telemetryConsent.ts')

  it('does not import the Supabase sync config or telemetry SDKs (imports only @legendapp/state)', () => {
    const source = readFileSync(modulePath, 'utf-8')
    expect(source).not.toMatch(/from ['"].*syncConfig['"]/)
    expect(source).not.toMatch(/configureSyncedSupabase/)
    expect(source).not.toMatch(/posthog-js|@sentry|posthog-react-native/)
  })
})
