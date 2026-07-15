/**
 * appOpenReValidation.ts — schedules the opportunistic app-open entitlement
 * re-validation.
 *
 * This is the cheapest, least-reliable leg of the renewal-freshness model (the
 * daily server-side expiry sweep + provider push webhooks are the authoritative
 * legs). It re-POSTs a stored receipt on app open to refresh the client's tier.
 *
 * It is DEFERRED until a session is known: the auth listener's initial
 * session-hydration event resolves asynchronously, so firing the invoke the
 * instant the listener is registered can run before the JWT exists and 401 as a
 * silent no-op on a cold boot. Gating on a non-null session userId avoids that
 * race (and fires synchronously when a session is already hydrated). The whole
 * thing stays fire-and-forget: never awaited on the boot path, silent on
 * failure, non-blocking.
 */

import { when } from '@legendapp/state'
import { store$, applySubscriptionTierFromServer } from './store'
import { getStoredReceipt } from './billing'
import { reValidateStoredReceiptOnAppOpen } from '../utils/billing/subscriptionApi'

export function scheduleAppOpenReValidation(): void {
  void when(
    () => store$.session.userId.get() != null,
    () => {
      reValidateStoredReceiptOnAppOpen(getStoredReceipt(), (refresh) => {
        applySubscriptionTierFromServer(refresh.subscription_tier)
      })
    }
  )
}
