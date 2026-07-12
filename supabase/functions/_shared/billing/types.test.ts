// Deno unit tests for the shared billing-validation contract types + the
// provider-agnostic tier-derivation helper.
//
// Run locally with: deno test --allow-env --allow-net supabase/functions/
//
// NOT wired into `yarn vitest` -- supabase/functions/** is excluded from the
// root vitest.config.mts glob (Deno 2 code: URL/npm:/jsr: imports, Deno.*
// globals). This file is `deno test`-only.
//
// Contract pinned down here (inferred from the acceptance criteria -- not
// verbatim named in the source spec, mirroring how the notify_reply
// precedent pinned an inferred client-usage contract):
//   - SubscriptionTier: 'paid_monthly' | 'paid_yearly'.
//   - SubscriptionStatus: 'active' | 'pending' | 'canceled' | 'past_due' |
//     'expired' (the 5-value receipt status enum, referenced here only by
//     shape).
//   - ReceiptValidationResult: { provider_subscription_id: string; status:
//     SubscriptionStatus; current_period_end: string (UTC ISO-8601);
//     tier: SubscriptionTier; bound_user_id: string | null; raw_metadata:
//     Record<string, unknown> } -- the normalized shape every provider
//     validator resolves to on success. bound_user_id carries a
//     provider-side ownership signal (e.g. Stripe Checkout
//     client_reference_id / metadata.user_id) when the provider payload
//     surfaces one, else null. raw_metadata is the provider's own validated
//     payload/metadata -- the value persisted into
//     subscription_receipts.raw_receipt (never the caller's original
//     raw_receipt input verbatim).
//   - ReceiptValidationError: an Error subclass carrying `code: string`,
//     `fault: 'client' | 'provider'`, and an optional `status?: number`
//     override -- the discriminator callers use to map a validator failure
//     to 4xx (client / bad receipt) vs 5xx (provider unreachable, timeout,
//     or our own misconfiguration) without re-deriving it from scratch; an
//     explicit `status` (e.g. 502 for a provider-contract violation) takes
//     precedence over the fault-based default. `name` is fixed to
//     'ReceiptValidationError' so a caller can distinguish it from an
//     unexpected/unhandled throw.
//   - deriveTierFromInterval(interval, intervalCount, productId,
//     productTierMap): SubscriptionTier -- the provider-agnostic tier
//     deriver shared by all three provider modules (Stripe passes its native
//     interval/interval_count; Apple/Google convert their ISO-8601
//     subscription period to the same interval/count shape before calling
//     this). Recognizes ONLY the two exact shapes (month,1)->paid_monthly
//     and (year,1)->paid_yearly directly; any other interval/count
//     (week/day, (month,3), (month,12), ...) falls through to
//     `productTierMap[productId]` when productId is non-null and present in
//     the map; an interval/plan neither rule resolves throws a
//     ReceiptValidationError with code 'tier_unresolvable' and fault
//     'client' -- NEVER a silent default to a paid tier.
//
// Red phase: ./types.ts does not exist yet, so every test in this file fails
// at import resolution before a single assertion runs.

import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { deriveTierFromInterval, ReceiptValidationError } from './types.ts'

// ---------------------------------------------------------------------------
// ReceiptValidationError -- the fault discriminator every provider module
// and the handler share.
// ---------------------------------------------------------------------------

Deno.test('ReceiptValidationError carries the message, code, and fault it was constructed with', () => {
  const error = new ReceiptValidationError('receipt not found', {
    code: 'receipt_not_found',
    fault: 'client',
  })
  assertEquals(error.message, 'receipt not found')
  assertEquals(error.code, 'receipt_not_found')
  assertEquals(error.fault, 'client')
})

Deno.test('ReceiptValidationError accepts an explicit status override alongside code and fault', () => {
  const error = new ReceiptValidationError('provider returned a contract-violating payload', {
    code: 'provider_contract_violation',
    fault: 'provider',
    status: 502,
  })
  assertEquals(error.code, 'provider_contract_violation')
  assertEquals(error.fault, 'provider')
  assertEquals(error.status, 502)
})

Deno.test('ReceiptValidationError leaves status undefined when no override is given', () => {
  const error = new ReceiptValidationError('bad receipt', { code: 'bad_request', fault: 'client' })
  assertEquals(error.status, undefined)
})

Deno.test('ReceiptValidationError is a genuine Error instance distinguishable by name', () => {
  const error = new ReceiptValidationError('provider unreachable', {
    code: 'provider_unreachable',
    fault: 'provider',
  })
  assertEquals(error instanceof Error, true)
  assertEquals(error.name, 'ReceiptValidationError')
})

// ---------------------------------------------------------------------------
// deriveTierFromInterval -- interval-first, product-map fallback, never a
// silent default to a paid tier.
// ---------------------------------------------------------------------------

Deno.test('deriveTierFromInterval resolves (month, 1) directly to paid_monthly', () => {
  const tier = deriveTierFromInterval('month', 1, null, {})
  assertEquals(tier, 'paid_monthly')
})

Deno.test('deriveTierFromInterval resolves (year, 1) directly to paid_yearly', () => {
  const tier = deriveTierFromInterval('year', 1, null, {})
  assertEquals(tier, 'paid_yearly')
})

Deno.test('deriveTierFromInterval does NOT misclassify (month, 12) as monthly -- it falls through to the product map', () => {
  const tier = deriveTierFromInterval('month', 12, 'price_annual_via_monthly_interval', {
    price_annual_via_monthly_interval: 'paid_yearly',
  })
  assertEquals(tier, 'paid_yearly')
})

Deno.test('deriveTierFromInterval does NOT misclassify (month, 6) as monthly -- it falls through to the product map', () => {
  const tier = deriveTierFromInterval('month', 6, 'price_semiannual', {
    price_semiannual: 'paid_yearly',
  })
  assertEquals(tier, 'paid_yearly')
})

Deno.test('deriveTierFromInterval falls through a non-month/year interval (e.g. week) to the product map', () => {
  const tier = deriveTierFromInterval('week', 1, 'price_weekly', { price_weekly: 'paid_monthly' })
  assertEquals(tier, 'paid_monthly')
})

Deno.test('deriveTierFromInterval throws tier_unresolvable (client fault) when the interval is unrecognized and the product id is absent from the map', () => {
  const error = assertThrows<ReceiptValidationError>(
    () => deriveTierFromInterval('month', 12, 'price_unmapped', {}),
    ReceiptValidationError,
  )
  assertEquals(error.code, 'tier_unresolvable')
  assertEquals(error.fault, 'client')
})

Deno.test('deriveTierFromInterval throws tier_unresolvable when productId is null and the interval/count is not one of the two recognized shapes', () => {
  const error = assertThrows<ReceiptValidationError>(
    () => deriveTierFromInterval('day', 1, null, { price_weekly: 'paid_monthly' }),
    ReceiptValidationError,
  )
  assertEquals(error.code, 'tier_unresolvable')
  assertEquals(error.fault, 'client')
})

Deno.test('deriveTierFromInterval never silently defaults to a paid tier for an unresolvable plan -- it always throws rather than returning a guess', () => {
  assertThrows(
    () =>
      deriveTierFromInterval('month', 3, 'totally_unmapped_id', { some_other_id: 'paid_monthly' }),
    ReceiptValidationError,
  )
})

Deno.test('deriveTierFromInterval treats interval-first as authoritative even when a conflicting product-map entry exists for the same product id', () => {
  // (month, 1) is a directly-recognized shape -- the map must never override it.
  const tier = deriveTierFromInterval('month', 1, 'price_monthly', { price_monthly: 'paid_yearly' })
  assertEquals(tier, 'paid_monthly')
})
