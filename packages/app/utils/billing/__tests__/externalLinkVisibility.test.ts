/**
 * externalLinkVisibility.test.ts — the flag + geofence gate governing the
 * (v1.0 hidden) external-link affordance under its phased rollout.
 *
 * `shouldShowExternalLinkSurface(platform, storefrontCountryCode, flagValue)`
 * is a PURE function. Table-driven matrix per the story:
 *   - flag off              -> never shown, any platform/country
 *   - flag on + non-US      -> hidden (v1.0 IAP-only path retained)
 *   - flag on + US + iOS    -> shown
 *   - flag on + US + Android-> shown
 *   - web/desktop           -> n/a (never shown — the external-link surface
 *                               only exists for native IAP platforms; web/
 *                               desktop already checks out directly via Stripe)
 *   - unknown/undeterminable storefront -> fail-closed (hidden)
 *
 * Red-phase: `packages/app/utils/billing/externalLinkVisibility.ts` does not
 * exist yet — this file fails at the top-level import until it is created.
 */

import { describe, expect, it } from 'vitest'

// Import under test — fails until externalLinkVisibility.ts exists.
import { shouldShowExternalLinkSurface } from '../externalLinkVisibility'

describe('shouldShowExternalLinkSurface — flag OFF', () => {
  it('is hidden on iOS + US when the flag is off', () => {
    expect(shouldShowExternalLinkSurface('ios', 'USA', false)).toBe(false)
  })

  it('is hidden on Android + US when the flag is off', () => {
    expect(shouldShowExternalLinkSurface('android', 'USA', false)).toBe(false)
  })

  it('is hidden on iOS + non-US when the flag is off', () => {
    expect(shouldShowExternalLinkSurface('ios', 'GBR', false)).toBe(false)
  })
})

describe('shouldShowExternalLinkSurface — flag ON, geofence matrix', () => {
  it('is shown on iOS + US storefront when the flag is on', () => {
    expect(shouldShowExternalLinkSurface('ios', 'USA', true)).toBe(true)
  })

  it('is shown on Android + US storefront when the flag is on', () => {
    expect(shouldShowExternalLinkSurface('android', 'USA', true)).toBe(true)
  })

  it('is hidden on iOS + a non-US storefront even when the flag is on (v1.0 IAP-only path retained)', () => {
    expect(shouldShowExternalLinkSurface('ios', 'GBR', true)).toBe(false)
  })

  it('is hidden on Android + a non-US storefront even when the flag is on', () => {
    expect(shouldShowExternalLinkSurface('android', 'CAN', true)).toBe(false)
  })
})

describe('shouldShowExternalLinkSurface — web/desktop is always n/a', () => {
  it('is hidden on web even with the flag on and a US storefront code', () => {
    expect(shouldShowExternalLinkSurface('web', 'USA', true)).toBe(false)
  })

  it('is hidden on web when the flag is off', () => {
    expect(shouldShowExternalLinkSurface('web', 'USA', false)).toBe(false)
  })
})

describe('shouldShowExternalLinkSurface — fail-closed on an unknown storefront', () => {
  it('is hidden on iOS when the storefront country code is null (undeterminable) even with the flag on', () => {
    expect(shouldShowExternalLinkSurface('ios', null, true)).toBe(false)
  })

  it('is hidden on Android when the storefront country code is null even with the flag on', () => {
    expect(shouldShowExternalLinkSurface('android', null, true)).toBe(false)
  })
})

describe('shouldShowExternalLinkSurface — pure function contract', () => {
  it('is deterministic across repeated calls with the same inputs', () => {
    const first = shouldShowExternalLinkSurface('ios', 'USA', true)
    const second = shouldShowExternalLinkSurface('ios', 'USA', true)
    expect(first).toBe(second)
  })
})
