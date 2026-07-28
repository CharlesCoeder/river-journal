/**
 * state/billing.ts
 *
 * Local-only (never synced, never encrypted) persistence for the last billing
 * receipt the client should re-POST on app open to opportunistically refresh
 * the entitlement window. For the Stripe path this is ALWAYS the `cs_...`
 * Checkout Session id (never a `sub_...`) — re-POSTing the Session keeps the
 * ownership binding engaged on every refresh, and completed Sessions stay
 * retrievable indefinitely so the re-POST never stales out.
 *
 * The authoritative entitlement lives server-side; this is purely a cheap
 * client cache of "the receipt to re-check", subordinate to the daily
 * server-side expiry sweep and the provider push webhooks.
 */

import { observable } from '@legendapp/state'
import type { StoredReceipt } from 'app/utils/billing/subscriptionApi'

export const billingReceipt$ = observable<{ receipt: StoredReceipt | null }>({
  receipt: null,
})

/**
 * Persists the receipt to re-validate on subsequent app opens. Called on a
 * successful purchase validation.
 */
export function setStoredReceipt(receipt: StoredReceipt): void {
  billingReceipt$.receipt.set(receipt)
}

/**
 * Reads the stored receipt (or null if none has been persisted).
 */
export function getStoredReceipt(): StoredReceipt | null {
  return billingReceipt$.receipt.get() ?? null
}
