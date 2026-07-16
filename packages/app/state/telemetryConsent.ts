/**
 * state/telemetryConsent.ts
 *
 * Device-local, per-device telemetry consent preference. Telemetry (crash +
 * product analytics) is OPT-IN: this flag defaults OFF, and until it is turned
 * ON no SDK initializes and no telemetry request leaves the device. A single
 * flag gates BOTH Sentry (crash/error) and PostHog (product analytics).
 *
 * NEVER synced to Supabase — the opt-in choice is a per-device decision that
 * intentionally does not travel with the account (clones the appLock$ pattern).
 * Persistence is wired separately in initializeApp.ts (IndexedDB on
 * web/desktop, MMKV on native).
 *
 * This module imports ONLY `@legendapp/state` so it can be read synchronously
 * (`peek()`) from inside the SDK init predicates in utils/telemetry/*, keeping
 * the dependency direction state <- telemetry <- initializeApp acyclic.
 */

import { observable } from '@legendapp/state'

export interface TelemetryConsentState {
  enabled: boolean
}

export const telemetryConsent$ = observable<TelemetryConsentState>({
  enabled: false,
})

/**
 * Write the consent flag (state only). This does NOT init or tear down any SDK;
 * the immediate init/disable side effects live in utils/telemetry/consent.ts so
 * the state layer stays free of platform-only telemetry imports.
 */
export function setTelemetryConsentEnabled(enabled: boolean): void {
  telemetryConsent$.enabled.set(enabled)
}
