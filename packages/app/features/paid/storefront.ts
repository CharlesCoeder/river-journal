/**
 * storefront.ts — web / desktop platform + storefront resolution.
 *
 * Web and Tauri desktop check out directly via Stripe and have no store-billing
 * storefront concept, so the platform is 'web' and the storefront country is
 * null. The native counterpart (`storefront.native.ts`) resolves iOS/Android
 * and reads the StoreKit / Play Billing storefront country.
 */

import type { BillingPlatform } from 'app/utils/billing/platformDisclosure'

export function resolvePurchasePlatform(): BillingPlatform {
  return 'web'
}

export function resolveStorefrontCountryCode(): string | null {
  return null
}
