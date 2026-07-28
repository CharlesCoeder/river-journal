/**
 * storefront.native.ts — native platform + storefront resolution.
 *
 * `Platform.OS` distinguishes iOS from Android. The storefront country code is
 * read from the native StoreKit (`Storefront.current?.countryCode`) / Play
 * Billing storefront equivalent — but that native module is operator follow-up
 * (provisioned alongside the store-side subscription setup). Until it lands,
 * the storefront is null, which fails the external-link gate closed (the v1.0
 * IAP-only path is retained).
 */

import { Platform } from 'react-native'
import type { BillingPlatform } from 'app/utils/billing/platformDisclosure'

export function resolvePurchasePlatform(): BillingPlatform {
  return Platform.OS === 'android' ? 'android' : 'ios'
}

export function resolveStorefrontCountryCode(): string | null {
  // Requires the native StoreKit / Play Billing module (operator follow-up).
  return null
}
