/**
 * externalLinkVisibility.ts — pure gate governing the (v1.0 hidden)
 * external-link billing affordance.
 *
 * The affordance is BUILT now but shipped OFF: it renders only when a
 * server-seeded feature flag is on AND the current storefront is a US
 * storefront. Both conditions must hold; the gate fails closed on an unknown
 * (null) storefront and is n/a for web/desktop (which already checks out
 * directly via Stripe and has no store-billing external-link concept).
 *
 * The v1.1 rollout is a pure server-side flag flip (no binary resubmission);
 * non-US storefronts keep the IAP-only path even when the flag is true.
 */

import type { BillingPlatform } from './platformDisclosure'

const US_STOREFRONT = 'USA'

export function shouldShowExternalLinkSurface(
  platform: BillingPlatform,
  storefrontCountryCode: string | null,
  flagValue: boolean
): boolean {
  // Flag off — never shown, on any platform or storefront.
  if (!flagValue) return false
  // Only native store-billing platforms have an external-link affordance.
  if (platform !== 'ios' && platform !== 'android') return false
  // Geofenced to US storefronts; fail closed on an undeterminable storefront.
  return storefrontCountryCode === US_STOREFRONT
}
