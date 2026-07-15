/**
 * purchaseFlow.native.ts — native (iOS StoreKit / Android Play Billing)
 * purchase kickoff.
 *
 * The native in-app-purchase module and the real App Store Connect / Play
 * Console products are operator follow-up (they are provisioned out-of-band
 * alongside the store-side subscription setup). Until that native module is
 * installed and the products exist, this path cannot open a purchase sheet, so
 * it reports a calm cancel rather than a hard failure — the surface returns to
 * idle with no error, exactly as it would for a user-dismissed sheet.
 *
 * When the native module lands, this file gains the StoreKit / Play Billing
 * sheet wiring: iOS resolves `{ provider: 'apple_iap', raw_receipt }`, Android
 * resolves `{ provider: 'play_iap', raw_receipt }`, and product ids are read
 * from `EXPO_PUBLIC_*` env config. This keeps the native IAP module out of the
 * web bundle via the `.native` split.
 */

import type { PurchaseAttemptResult } from './purchaseFlow.types'

export async function attemptPurchase(_userId: string): Promise<PurchaseAttemptResult> {
  // No native billing module wired yet — return to idle without an error.
  return { status: 'cancelled' }
}
