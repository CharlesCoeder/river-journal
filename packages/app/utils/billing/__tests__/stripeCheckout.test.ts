/**
 * stripeCheckout.test.ts — the two pure Stripe-path helpers that carry the
 * anti-hijack binding invariant and the "always the Session id, never the
 * Subscription id" invariant.
 *
 * Contract under test:
 *
 *   buildStripeCheckoutUrl(paymentLinkBaseUrl: string, userId: string): string
 *     - Appends `client_reference_id=<userId>` as a query param onto the
 *       Payment Link URL. The uid is passed through as-is (a Supabase
 *       auth uid — UUID — already conforms to Stripe's
 *       `^[a-zA-Z0-9_-]{1,200}$` charset, so no encoding is needed).
 *     - Throws (fail-closed, never silently truncates/mangles) if the given
 *       userId does NOT conform to that charset — the story's explicit
 *       "must be rejected/encoded rather than silently truncated" guard.
 *
 *   extractStripeSessionIdFromSuccessUrl(url: string): string | null
 *     - Reads the `session_id` query param from the Checkout success-redirect
 *       URL (the `{CHECKOUT_SESSION_ID}` template Stripe substitutes).
 *     - LOAD-BEARING: returns the id ONLY if it is a `cs_...` Checkout
 *       Session id. A `sub_...` Subscription id (or anything else) is NEVER
 *       accepted here — a Payment Link's `client_reference_id` does not
 *       propagate to the Subscription's metadata, so sending a `sub_...`
 *       downstream would silently drop the server-side ownership binding. This
 *       function is the client-side gate that makes that mistake structurally
 *       impossible: a non-`cs_...` id resolves to `null`, never a usable
 *       receipt value.
 *
 * Red-phase: `packages/app/utils/billing/stripeCheckout.ts` does not exist
 * yet — this file fails at the top-level import until it is created.
 */

import { describe, expect, it } from 'vitest'

// Import under test — fails until stripeCheckout.ts exists.
import { buildStripeCheckoutUrl, extractStripeSessionIdFromSuccessUrl } from '../stripeCheckout'

const VALID_UUID = 'a1b2c3d4-5e6f-4a1b-8c2d-9e0f1a2b3c4d'

describe('buildStripeCheckoutUrl — client_reference_id binding', () => {
  it('appends client_reference_id=<uid> to a bare Payment Link URL', () => {
    const url = buildStripeCheckoutUrl('https://buy.stripe.com/test_abc123', VALID_UUID)
    const parsed = new URL(url)
    expect(parsed.searchParams.get('client_reference_id')).toBe(VALID_UUID)
  })

  it('preserves the base Payment Link path/host unchanged', () => {
    const url = buildStripeCheckoutUrl('https://buy.stripe.com/test_abc123', VALID_UUID)
    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://buy.stripe.com')
    expect(parsed.pathname).toBe('/test_abc123')
  })

  it('appends to (does not clobber) an existing query string on the base URL', () => {
    const url = buildStripeCheckoutUrl('https://buy.stripe.com/test_abc123?locale=en', VALID_UUID)
    const parsed = new URL(url)
    expect(parsed.searchParams.get('locale')).toBe('en')
    expect(parsed.searchParams.get('client_reference_id')).toBe(VALID_UUID)
  })

  it('passes a UUID-shaped uid through as-is (no re-encoding, no truncation)', () => {
    const url = buildStripeCheckoutUrl('https://buy.stripe.com/test_abc123', VALID_UUID)
    // The uid must round-trip byte-for-byte through the query string.
    expect(url).toContain(`client_reference_id=${VALID_UUID}`)
  })

  it('is deterministic — building twice with the same inputs yields the same client_reference_id', () => {
    const first = buildStripeCheckoutUrl('https://buy.stripe.com/test_abc123', VALID_UUID)
    const second = buildStripeCheckoutUrl('https://buy.stripe.com/test_abc123', VALID_UUID)
    expect(new URL(first).searchParams.get('client_reference_id')).toBe(
      new URL(second).searchParams.get('client_reference_id')
    )
  })

  it('throws (fail-closed) rather than silently mangling a userId with a disallowed character', () => {
    // Stripe's client_reference_id charset is ^[a-zA-Z0-9_-]{1,200}$ — a space,
    // slash, or other punctuation is outside it. The story requires this be
    // rejected, never silently truncated by Stripe (or by us).
    expect(() =>
      buildStripeCheckoutUrl('https://buy.stripe.com/test_abc123', 'not a valid id/at all')
    ).toThrow()
  })

  it('throws on an empty userId', () => {
    expect(() => buildStripeCheckoutUrl('https://buy.stripe.com/test_abc123', '')).toThrow()
  })

  it('throws on a userId exceeding 200 characters', () => {
    const tooLong = 'a'.repeat(201)
    expect(() => buildStripeCheckoutUrl('https://buy.stripe.com/test_abc123', tooLong)).toThrow()
  })
})

describe('extractStripeSessionIdFromSuccessUrl — cs_... only, never sub_... (load-bearing invariant)', () => {
  it('extracts a cs_... session id from the success redirect URL', () => {
    const result = extractStripeSessionIdFromSuccessUrl(
      'https://app.example.com/paid?session_id=cs_test_a1b2c3d4e5f6'
    )
    expect(result).toBe('cs_test_a1b2c3d4e5f6')
  })

  it('returns null when session_id is absent entirely', () => {
    const result = extractStripeSessionIdFromSuccessUrl('https://app.example.com/paid')
    expect(result).toBeNull()
  })

  it('returns null (NEVER the value) when session_id is a sub_... Subscription id, not a cs_... Session id', () => {
    // This is the single load-bearing guard from the Dev Notes pressure-test:
    // a sub_... id must never be handed to validateReceipt, because a Payment
    // Link's client_reference_id binding does not propagate to Subscription
    // metadata — sending a sub_... would silently drop the 7.2 ownership
    // binding. Structurally prevented by returning null here.
    const result = extractStripeSessionIdFromSuccessUrl(
      'https://app.example.com/paid?session_id=sub_test_a1b2c3d4e5f6'
    )
    expect(result).toBeNull()
  })

  it('returns null for an empty session_id value', () => {
    const result = extractStripeSessionIdFromSuccessUrl('https://app.example.com/paid?session_id=')
    expect(result).toBeNull()
  })

  it('returns null for a malformed/non-URL string rather than throwing', () => {
    expect(() => extractStripeSessionIdFromSuccessUrl('not a url at all')).not.toThrow()
    expect(extractStripeSessionIdFromSuccessUrl('not a url at all')).toBeNull()
  })

  it('extracts correctly alongside other unrelated query params', () => {
    const result = extractStripeSessionIdFromSuccessUrl(
      'https://app.example.com/paid?utm_source=email&session_id=cs_live_xyz789&locale=en'
    )
    expect(result).toBe('cs_live_xyz789')
  })
})
