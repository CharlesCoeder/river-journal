/**
 * platformDisclosure.test.ts — the platform-aware billing disclosure copy
 * resolver.
 *
 * `resolveBillingDisclosureCopy(platform)` is a PURE function — no
 * observable reads, no I/O — taking the platform as an injectable argument
 * (per the story's explicit "table-driven testing" requirement) and
 * returning the exact disclosure string for that platform:
 *   - web / desktop -> "Purchase via Stripe"
 *   - iOS           -> "Purchase via the App Store"
 *   - Android       -> "Purchase via the Play Store"
 *
 * At v1.0 the copy carries NO external-link microcopy on iOS/Android (no
 * "save on the web", no "manage on the web") — that surface is a SEPARATE,
 * flag-gated affordance (see externalLinkVisibility.ts), never folded
 * into this disclosure string.
 */

import { describe, expect, it } from 'vitest'

import { resolveBillingDisclosureCopy } from '../platformDisclosure'
import type { BillingPlatform } from '../platformDisclosure'

describe('resolveBillingDisclosureCopy — per-platform disclosure copy', () => {
  it('resolves "Purchase via Stripe" for web', () => {
    expect(resolveBillingDisclosureCopy('web')).toBe('Purchase via Stripe')
  })

  it('resolves "Purchase via Stripe" for desktop (Tauri renders through the web copy — same string)', () => {
    // Desktop is NOT a distinct platform literal in this resolver — Tauri desktop
    // uses the web renderer (isWeb === true covers both), so the same 'web' input
    // yields the Stripe copy for desktop too.
    expect(resolveBillingDisclosureCopy('web')).toBe('Purchase via Stripe')
  })

  it('resolves "Purchase via the App Store" for iOS', () => {
    expect(resolveBillingDisclosureCopy('ios')).toBe('Purchase via the App Store')
  })

  it('resolves "Purchase via the Play Store" for Android', () => {
    expect(resolveBillingDisclosureCopy('android')).toBe('Purchase via the Play Store')
  })
})

describe('resolveBillingDisclosureCopy — no external-link microcopy at v1.0', () => {
  const FORBIDDEN_PHRASES = [/save.*web/i, /manage.*web/i, /on the web/i]

  it('the iOS copy carries no "save/manage on the web" microcopy', () => {
    const copy = resolveBillingDisclosureCopy('ios')
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(copy).not.toMatch(phrase)
    }
  })

  it('the Android copy carries no "save/manage on the web" microcopy', () => {
    const copy = resolveBillingDisclosureCopy('android')
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(copy).not.toMatch(phrase)
    }
  })
})

describe('resolveBillingDisclosureCopy — pure function contract', () => {
  it('is deterministic: repeated calls with the same platform yield an identical string', () => {
    const first = resolveBillingDisclosureCopy('ios')
    const second = resolveBillingDisclosureCopy('ios')
    expect(first).toBe(second)
  })

  it('table-driven: every BillingPlatform literal resolves to a non-empty string', () => {
    const platforms: BillingPlatform[] = ['web', 'ios', 'android']
    for (const platform of platforms) {
      const copy = resolveBillingDisclosureCopy(platform)
      expect(typeof copy).toBe('string')
      expect(copy.length).toBeGreaterThan(0)
    }
  })
})
