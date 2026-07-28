/**
 * Shared result contract for the platform purchase-kickoff seam. The web
 * (Stripe) and native (IAP) implementations live in `purchaseFlow.ts` /
 * `purchaseFlow.native.ts` respectively and both resolve to this shape, so the
 * purchase surface reacts identically regardless of provider.
 */

import type { BillingProvider } from 'app/utils/billing/subscriptionApi'

export interface PurchaseSuccess {
  status: 'success'
  outcome: { provider: BillingProvider; raw_receipt: string }
}

export interface PurchaseCancelled {
  status: 'cancelled'
}

export type PurchaseAttemptResult = PurchaseSuccess | PurchaseCancelled
