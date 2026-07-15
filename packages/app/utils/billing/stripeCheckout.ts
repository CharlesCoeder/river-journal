/**
 * stripeCheckout.ts — pure Stripe-path helpers carrying the anti-hijack
 * binding invariant.
 *
 * `buildStripeCheckoutUrl` appends `client_reference_id=<uid>` to the
 * pre-created Stripe Payment Link URL. A Payment Link forwards this query
 * param onto the resulting Checkout Session, which is exactly the field the
 * receipt-validation function reads to bind the receipt to the caller's
 * account. The uid is passed through as-is (a Supabase auth uid — a UUID —
 * already conforms to Stripe's charset), and a non-conforming uid is REJECTED
 * (thrown), never silently truncated by Stripe.
 *
 * `extractStripeSessionIdFromSuccessUrl` reads the Checkout Session id from
 * the success-redirect URL, accepting ONLY a `cs_...` Session id. A Payment
 * Link's `client_reference_id` does not propagate to the Subscription's
 * metadata, so a `sub_...` id downstream would silently drop the ownership
 * binding — this function makes that mistake structurally impossible by
 * resolving anything that is not a `cs_...` id to null.
 */

// Stripe's client_reference_id charset: ^[a-zA-Z0-9_-]{1,200}$
const CLIENT_REFERENCE_ID_RE = /^[a-zA-Z0-9_-]{1,200}$/

export function buildStripeCheckoutUrl(paymentLinkBaseUrl: string, userId: string): string {
  if (!CLIENT_REFERENCE_ID_RE.test(userId)) {
    // Fail closed rather than let Stripe silently truncate/mangle the binding.
    throw new Error('userId does not conform to the client_reference_id charset')
  }
  const url = new URL(paymentLinkBaseUrl)
  url.searchParams.set('client_reference_id', userId)
  return url.toString()
}

export function extractStripeSessionIdFromSuccessUrl(url: string): string | null {
  let sessionId: string | null
  try {
    sessionId = new URL(url).searchParams.get('session_id')
  } catch {
    // Malformed / non-URL input — resolve to null rather than throw.
    return null
  }
  if (!sessionId) return null
  // LOAD-BEARING: only a completed Checkout Session id is accepted. A
  // Subscription id (or anything else) is never a usable receipt value here.
  if (!sessionId.startsWith('cs_')) return null
  return sessionId
}
