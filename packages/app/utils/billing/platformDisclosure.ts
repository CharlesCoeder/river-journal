/**
 * platformDisclosure.ts — pure resolver for the platform-aware billing
 * disclosure copy.
 *
 * The copy is intentionally minimal and carries NO external-link microcopy on
 * iOS/Android at v1.0 (no "save on the web" / "manage on the web") — that
 * surface is a separate, flag-gated affordance (see externalLinkVisibility.ts),
 * never folded into this disclosure string.
 *
 * Platform is an injectable argument so the resolver is fully table-testable.
 * Desktop (Tauri) renders through the web copy, so it maps to the same 'web'
 * literal — there is no distinct 'desktop' branch here.
 */

export type BillingPlatform = 'web' | 'ios' | 'android'

const DISCLOSURE_COPY: Record<BillingPlatform, string> = {
  web: 'Purchase via Stripe',
  ios: 'Purchase via the App Store',
  android: 'Purchase via the Play Store',
}

export function resolveBillingDisclosureCopy(platform: BillingPlatform): string {
  return DISCLOSURE_COPY[platform]
}
