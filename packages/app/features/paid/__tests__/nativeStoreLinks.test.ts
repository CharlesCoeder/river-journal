/**
 * nativeStoreLinks.test.ts — the pure provider -> native store deep-link
 * mapping used by the Apple/Play cancel leg.
 *
 * Contract pinned for the green-phase implementer:
 *   `packages/app/features/paid/nativeStoreLinks.ts` exports
 *   `resolveNativeStoreLink(provider: 'apple_iap' | 'play_iap'): {
 *     url: string; label: string; storeName: string
 *   }`
 *
 * Kept as a pure function (no `Linking` import) so the mapping is testable
 * without touching the deferred cross-platform Linking idiom — the dialog
 * component consumes this seam and is independently covered in
 * `CancelSubscriptionFlow.test.tsx`.
 *
 * Red-phase: `packages/app/features/paid/nativeStoreLinks.ts` does not exist
 * yet — this file fails at the top-level import until it is created.
 */

import { describe, expect, it } from 'vitest'

// Import under test — fails until nativeStoreLinks.ts exists.
import { resolveNativeStoreLink } from '../nativeStoreLinks'

describe('resolveNativeStoreLink — apple_iap', () => {
  it('resolves the App Store subscriptions management URL', () => {
    const result = resolveNativeStoreLink('apple_iap')
    expect(result.url).toBe('https://apps.apple.com/account/subscriptions')
  })

  it('resolves a button label naming the App Store', () => {
    const result = resolveNativeStoreLink('apple_iap')
    expect(result.label).toMatch(/app store/i)
  })

  it('resolves a store name of "App Store" (for the native-action + fallback copy)', () => {
    const result = resolveNativeStoreLink('apple_iap')
    expect(result.storeName).toBe('App Store')
  })
})

describe('resolveNativeStoreLink — play_iap', () => {
  it('resolves the Play Store subscriptions management URL', () => {
    const result = resolveNativeStoreLink('play_iap')
    expect(result.url).toBe('https://play.google.com/store/account/subscriptions')
  })

  it('resolves a button label naming the Play Store', () => {
    const result = resolveNativeStoreLink('play_iap')
    expect(result.label).toMatch(/play store/i)
  })

  it('resolves a store name of "Play Store" (for the native-action + fallback copy)', () => {
    const result = resolveNativeStoreLink('play_iap')
    expect(result.storeName).toBe('Play Store')
  })
})

describe('resolveNativeStoreLink — the two providers never collide', () => {
  it('apple_iap and play_iap resolve to distinct URLs', () => {
    const apple = resolveNativeStoreLink('apple_iap')
    const play = resolveNativeStoreLink('play_iap')
    expect(apple.url).not.toBe(play.url)
  })

  it('apple_iap and play_iap resolve to distinct labels', () => {
    const apple = resolveNativeStoreLink('apple_iap')
    const play = resolveNativeStoreLink('play_iap')
    expect(apple.label).not.toBe(play.label)
  })
})
