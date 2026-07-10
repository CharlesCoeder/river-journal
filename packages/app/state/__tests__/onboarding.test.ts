// onboarding$ observable + actions — pure state unit tests.
//
// No persistence involved here — this file only exercises the plain
// Legend-State observable + action functions, following the `state/lapsed.ts`
// / `lapsed.test.ts` precedent (persistence wiring in initializeApp.ts is not
// under test here). Observable is reset to initial shape in beforeEach.
//
// Coverage:
//   - Get started writes onboardingCompletedAt to a local-only persisted
//     observable (persistence itself is covered by initializeApp wiring,
//     not this file; here we assert the action's write behavior)
//   - Skip sets the SAME flag (skip == completion) — exercised here via
//     completeOnboarding's idempotency contract
//   - per-device / never-synced semantics — asserted structurally by
//     inspecting the module source for absence of sync-related imports
//   - mid-flow resume via persisted, clamped currentScreen

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
// eslint-disable-next-line import/first
import { onboarding$, completeOnboarding, setOnboardingScreen } from '../onboarding'

const T0_ISO = '2026-01-01T00:00:00.000Z'
const T1_ISO = '2026-01-02T00:00:00.000Z'

beforeEach(() => {
  // Reset observable to initial shape before every test (no persistence involved).
  onboarding$.set({
    onboardingCompletedAt: null,
    currentScreen: 0,
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Initial state
// ─────────────────────────────────────────────────────────────────────────────
describe('onboarding$ initial state', () => {
  it('onboardingCompletedAt is null on a fresh observable', () => {
    expect(onboarding$.onboardingCompletedAt.get()).toBeNull()
  })

  it('currentScreen is 0 on a fresh observable', () => {
    expect(onboarding$.currentScreen.get()).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// completeOnboarding writes an ISO timestamp to the persisted observable
// ─────────────────────────────────────────────────────────────────────────────
describe('completeOnboarding — writes completion timestamp', () => {
  it('sets onboardingCompletedAt to the provided fixed ISO timestamp', () => {
    completeOnboarding(T0_ISO)
    expect(onboarding$.onboardingCompletedAt.get()).toBe(T0_ISO)
  })

  it('with no argument, sets onboardingCompletedAt to a valid ISO 8601 string (live time)', () => {
    completeOnboarding()
    const value = onboarding$.onboardingCompletedAt.get()
    expect(typeof value).toBe('string')
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency: a second call (e.g. Skip after a prior Get started, or vice
// versa) must NOT clobber the already-recorded completion timestamp. This is
// the mechanism that makes "skip == completion" safe to wire from two call
// sites (Get started AND Skip both call completeOnboarding) without a race
// overwriting the original timestamp.
// ─────────────────────────────────────────────────────────────────────────────
describe('completeOnboarding — idempotent once completed', () => {
  it('a second call with a different timestamp does not overwrite the first', () => {
    completeOnboarding(T0_ISO)
    completeOnboarding(T1_ISO)
    expect(onboarding$.onboardingCompletedAt.get()).toBe(T0_ISO)
  })

  it('is a no-op (value unchanged) when called again after the default-time path', () => {
    completeOnboarding()
    const first = onboarding$.onboardingCompletedAt.get()
    completeOnboarding(T1_ISO)
    expect(onboarding$.onboardingCompletedAt.get()).toBe(first)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// setOnboardingScreen clamps to [0, 2]
// ─────────────────────────────────────────────────────────────────────────────
describe('setOnboardingScreen — clamps to [0, 2]', () => {
  it('clamps a negative value up to 0', () => {
    setOnboardingScreen(-1)
    expect(onboarding$.currentScreen.get()).toBe(0)
  })

  it('clamps an out-of-range high value down to 2', () => {
    setOnboardingScreen(5)
    expect(onboarding$.currentScreen.get()).toBe(2)
  })

  it('truncates a fractional value (1.9 -> 1)', () => {
    setOnboardingScreen(1.9)
    expect(onboarding$.currentScreen.get()).toBe(1)
  })

  it('passes through valid in-range values unchanged (0, 1, 2)', () => {
    setOnboardingScreen(0)
    expect(onboarding$.currentScreen.get()).toBe(0)
    setOnboardingScreen(1)
    expect(onboarding$.currentScreen.get()).toBe(1)
    setOnboardingScreen(2)
    expect(onboarding$.currentScreen.get()).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Per-device / never-synced: structural guard on the module source.
//
// state/onboarding.ts must never import the Supabase sync layer or the
// non-persisted ephemeral$ bucket — ephemeral$ is a naming trap: it is
// NON-persisted and would silently break the flag-already-set and mid-flow-
// resume behaviors if used here. This is a static/architectural assertion
// rather than a behavioral one: onboarding.ts must never be wired into
// state/syncConfig.ts or into the ephemeral$ bucket in state/store.ts.
// ─────────────────────────────────────────────────────────────────────────────
describe('onboarding.ts source — never synced, never ephemeral', () => {
  const modulePath = path.resolve(__dirname, '../onboarding.ts')

  it('does not import the Supabase sync config (syncConfig.ts / configureSyncedSupabase)', () => {
    const source = readFileSync(modulePath, 'utf-8')
    expect(source).not.toMatch(/from ['"].*syncConfig['"]/)
    expect(source).not.toMatch(/configureSyncedSupabase/)
  })

  it('does not read or write the non-persisted ephemeral$ bucket', () => {
    const source = readFileSync(modulePath, 'utf-8')
    expect(source).not.toMatch(/ephemeral\$/)
  })
})
