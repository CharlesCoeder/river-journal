/**
 * purchaseFlow.ts — web / desktop (Stripe) purchase kickoff.
 *
 * v1.0 mechanism: a pre-created Stripe Payment Link with `?client_reference_id`
 * appended client-side. No Stripe secret key on the client, no new server
 * surface. The Payment Link forwards `client_reference_id` onto the resulting
 * Checkout Session, which is the field the receipt-validation function reads to
 * bind the receipt to the caller's account.
 *
 * The flow has two legs across a full-page redirect:
 *   1. Kickoff: navigate to the Payment Link (`buildStripeCheckoutUrl`); the
 *      page unloads, so the returned promise never settles before navigation.
 *   2. Return: Stripe redirects back to the success URL carrying
 *      `?session_id={CHECKOUT_SESSION_ID}`; on the next call we read that
 *      `cs_...` Session id and report success. The value handed downstream is
 *      ALWAYS the `cs_...` Session id, NEVER a `sub_...` Subscription id
 *      (`extractStripeSessionIdFromSuccessUrl` enforces this) — a `sub_...`
 *      would silently drop the ownership binding.
 *
 * The Payment Link URL is operator-configured via env (the actual product,
 * price, and the `{CHECKOUT_SESSION_ID}` success-redirect template are set up
 * out-of-band alongside store-product provisioning).
 */

import {
  buildStripeCheckoutUrl,
  extractStripeSessionIdFromSuccessUrl,
} from 'app/utils/billing/stripeCheckout'
import type { PurchaseAttemptResult } from './purchaseFlow.types'

const PAYMENT_LINK_URL =
  process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK ?? process.env.EXPO_PUBLIC_STRIPE_PAYMENT_LINK ?? ''

export async function attemptPurchase(userId: string): Promise<PurchaseAttemptResult> {
  if (typeof window === 'undefined') {
    return { status: 'cancelled' }
  }

  // Return leg — did we come back from the Stripe success redirect?
  const sessionId = extractStripeSessionIdFromSuccessUrl(window.location.href)
  if (sessionId) {
    return { status: 'success', outcome: { provider: 'stripe', raw_receipt: sessionId } }
  }

  // Kickoff leg — no configured Payment Link means nothing to open.
  if (!PAYMENT_LINK_URL) {
    return { status: 'cancelled' }
  }

  window.location.assign(buildStripeCheckoutUrl(PAYMENT_LINK_URL, userId))
  // The page is navigating away; this promise intentionally never settles.
  return new Promise<PurchaseAttemptResult>(() => {})
}
