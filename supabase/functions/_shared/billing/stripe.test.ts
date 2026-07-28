// Deno unit tests for the Stripe receipt validator.
//
// Run locally with: deno test --allow-env --allow-net supabase/functions/
//
// NOT wired into `yarn vitest` -- supabase/functions/** is excluded from the
// root vitest.config.mts glob (Deno 2 code). This file is `deno test`-only.
//
// Contract pinned down here (inferred from the spec -- not
// verbatim named in the source spec):
//   - validateStripeReceipt(rawReceipt: unknown, deps: StripeDeps):
//     Promise<ReceiptValidationResult>. `rawReceipt` must be a non-empty
//     string (a Stripe Subscription id `sub_...` or a Checkout Session id
//     `cs_...`) -- any other shape throws a ReceiptValidationError
//     { code: 'invalid_receipt_shape', fault: 'client' } BEFORE any network
//     call.
//   - deps.stripeClient is the injectable SDK seam (never a real network
//     call in tests): { subscriptions: { retrieve(id): Promise<Sub> },
//     checkout: { sessions: { retrieve(id): Promise<Session> } } }.
//   - A `sub_...` id is retrieved directly. A `cs_...` id is first resolved
//     via checkout.sessions.retrieve; its `payment_status`/`mode` MUST be
//     `complete`/`subscription` (sanity-checked) before the linked
//     `subscription` id is retrieved -- an incomplete/mismatched session
//     throws a client-fault error withOUT ever calling subscriptions.retrieve.
//   - `raw_metadata` on the returned result carries the provider's own
//     validated payload (persisted to subscription_receipts.raw_receipt,
//     never the caller's original raw_receipt input).
//   - The resolved Subscription's `status` is mapped via mapStripeStatus;
//     `current_period_end` (Unix seconds) is normalized via
//     normalizeStripeTimestamp (`sec * 1000` -> ISO). Under Stripe API
//     2025-03-31.basil+ the period end is item-level
//     (`items.data[0].current_period_end`); the validator reads that first and
//     falls back to the top-level field for pre-Basil accounts. tier is derived
//     from `items.data[0].price.recurring.{interval,interval_count}` via the
//     shared deriveTierFromInterval, keyed on `items.data[0].price.id` for the
//     map fallback. `bound_user_id` comes from the Checkout Session's
//     `client_reference_id` (fallback `session.metadata.user_id`) on the cs_
//     path, else the Subscription's `metadata.user_id` — null if none present.
//   - mapStripeStatus(status): active/trialing->active, past_due->past_due,
//     canceled->canceled, unpaid/incomplete_expired->expired,
//     incomplete->pending; any other string is a provider-contract failure
//     (fault 'provider', since Stripe returning an undocumented status is
//     OUR integration being out of date with Stripe's API, not the user's
//     fault).
//   - normalizeStripeTimestamp(unixSeconds): `new Date(unixSeconds *
//     1000).toISOString()`.
//   - An empty/whitespace-only `id` or a missing `current_period_end` on the
//     resolved Subscription is a provider-contract violation -> throws
//     { code: 'provider_contract_violation', fault: 'provider' } BEFORE
//     returning (never written to the DB).
//   - A subscription id the SDK reports as not-found is a client fault (the
//     caller's receipt does not correspond to a real subscription).
//   - Every SDK call is wrapped in a timeout (deps.timeoutMs, default small
//     budget); a call that never settles within budget throws
//     { code: 'provider_timeout', fault: 'provider' }.
//
// Cancel-path contract (folded in alongside the validate-path contract above
// -- inferred from the spec, not verbatim named in the source
// spec):
//   - cancelStripeSubscriptionAtPeriodEnd(id: string, deps: { stripeClient:
//     StripeClientSeam, timeoutMs?: number }): Promise<{ current_period_end:
//     string }>. Calls deps.stripeClient.subscriptions.update(id,
//     { cancel_at_period_end: true }, signal) wrapped in withTimeout, and
//     reads current_period_end back from the updated subscription using the
//     SAME item-level-first / top-level-fallback resolution as the validate
//     path (Stripe 2025-03-31.basil+ shape).
//   - StripeClientSeam is extended with a mutation method:
//     subscriptions.update(id, params, signal?): Promise<unknown>. Every seam
//     method (retrieve, update, checkout.sessions.retrieve) now accepts an
//     OPTIONAL trailing AbortSignal, and withTimeout's signal is threaded
//     through on every call (carry-in hardening: the previous adapter built a
//     timeout AbortController but never actually passed its signal anywhere,
//     so an in-flight request was never torn down on a fired timeout).
//   - Calling update() on a subscription Stripe already reports as scheduled
//     for cancellation (cancel_at_period_end already true) is a successful
//     no-op that resolves normally -- Stripe's own idempotent behavior,
//     requiring no special-case handling here.
//   - A rejection from subscriptions.update that carries a numeric `status`
//     property of 404 (the thin fetch adapter's not-found signal) maps to
//     { code: 'provider_resource_missing', fault: 'client', status: 404 } --
//     a local <-> Stripe desync, NOT a provider-contract violation. Any other
//     rejection (5xx, 429, network failure, no status) maps to
//     { code: 'provider_cancel_failed', fault: 'provider' } (no explicit
//     status override, so the caller's fault-based default applies). A
//     ReceiptValidationError thrown by the seam itself (e.g. a fired timeout)
//     passes through untouched.
//   - A missing/malformed current_period_end on the updated subscription is a
//     provider-contract violation, identical to the validate path:
//     { code: 'provider_contract_violation', fault: 'provider', status: 502 }.
//   - A call that never settles within the timeout budget throws
//     { code: 'provider_timeout', fault: 'provider' }, never a hang.
//
// Webhook verifier + authoritative-refresh contract (folded in alongside the
// validate/cancel contracts above -- inferred from the spec,
// not verbatim named in the source spec):
//
//   - verifyStripeWebhookSignature(rawBody: string, signatureHeader: string,
//     secret: string, opts?: { toleranceSeconds?: number; nowMs?: number }):
//     unknown. Pure/synchronous (no network call) -- it parses the
//     `t=<unix>,v1=<hex>[,v1=<hex>...]` header, computes HMAC-SHA256 over the
//     exact string `${t}.${rawBody}` with the endpoint secret, and accepts if
//     ANY `v1` value matches via a constant-time compare. A timestamp whose
//     |now - t*1000| exceeds the tolerance (default 300_000ms, injectable via
//     opts.toleranceSeconds/opts.nowMs) is a stale/replay failure. ANY
//     failure (missing/malformed header, no matching v1, stale timestamp,
//     wrong secret) throws a ReceiptValidationError { code:
//     'webhook_signature_invalid', fault: 'client' } -- never a different
//     error shape, so the handler's generic-400 mapping is uniform. On
//     success it returns JSON.parse(rawBody) -- the SAME raw string that was
//     HMAC'd, never a re-serialized variant (verified below with an
//     irregularly-formatted body).
//   - refreshStripeSubscriptionState(subscriptionId: string, deps: {
//     stripeClient: StripeClientSeam; productTierMap?: Record<string,
//     SubscriptionTier>; timeoutMs?: number }): Promise<{
//     provider_subscription_id: string; status: SubscriptionStatus;
//     current_period_end: string; tier: SubscriptionTier | null }>. ALWAYS
//     retrieves the Subscription fresh by id via
//     deps.stripeClient.subscriptions.retrieve (withTimeout-wrapped) -- it
//     never accepts a pre-fetched subscription object, so every caller's
//     write reflects Stripe's live state at handling time (out-of-order /
//     redelivery safety). current_period_end resolution (item-level first,
//     top-level fallback) and status mapping reuse the exact same rules as
//     validateStripeReceipt. Unlike validateStripeReceipt, an unresolvable
//     plan does NOT throw -- deriveTierFromInterval's tier_unresolvable is
//     caught internally and the helper returns `tier: null`, so a freshness
//     refresh is never wedged by an underivable plan. A malformed/
//     out-of-range current_period_end (a normalizeStripeTimestamp RangeError)
//     is caught and remapped to a ReceiptValidationError { code:
//     'provider_contract_violation', fault: 'provider', status: 502 } -- the
//     same carry-in hardening applied to validateStripeReceipt below (both
//     paths shared the same previously-unguarded call site).
//   - Carry-in fold-in: validateStripeReceipt's normalization call is now
//     ALSO guarded -- a malformed/out-of-range current_period_end maps to the
//     same provider_contract_violation/502, never an uncaught RangeError
//     surfacing as a generic 500 (this was the residual half of the carry-in
//     hardening already applied to the cancel path).

import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1'
import { createHmac } from 'node:crypto'
import { ReceiptValidationError } from './types.ts'
import {
  cancelStripeSubscriptionAtPeriodEnd,
  mapStripeStatus,
  normalizeStripeTimestamp,
  refreshStripeSubscriptionState,
  validateStripeReceipt,
  verifyStripeWebhookSignature,
} from './stripe.ts'

const SUBSCRIPTION_ID = 'sub_test0000000000000001'
const SESSION_ID = 'cs_test0000000000000001'
const PRICE_ID = 'price_paid_monthly'
const BOUND_USER_ID = '00000000-0000-0000-0000-0000000000c1'

const PERIOD_END_SECONDS = 1_780_000_000 // Unix seconds

// Models the Stripe API 2025-03-31.basil+ shape: current_period_end lives on the
// line item (items.data[].current_period_end), NOT at the subscription top level.
// client_reference_id is deliberately absent — it is a Checkout Session field,
// never a Subscription field.
function subscriptionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: SUBSCRIPTION_ID,
    status: 'active',
    items: {
      data: [
        {
          current_period_end: PERIOD_END_SECONDS,
          price: { id: PRICE_ID, recurring: { interval: 'month', interval_count: 1 } },
        },
      ],
    },
    metadata: {},
    ...overrides,
  }
}

function sessionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    payment_status: 'paid',
    mode: 'subscription',
    subscription: SUBSCRIPTION_ID,
    ...overrides,
  }
}

function stripeClientStub(config: {
  retrieveSubscription?: (id: string) => Promise<unknown>
  retrieveSession?: (id: string) => Promise<unknown>
  updateSubscription?: (
    id: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<unknown>
}) {
  return {
    subscriptions: {
      retrieve(id: string) {
        if (!config.retrieveSubscription) {
          throw new Error('subscriptions.retrieve not configured for this test')
        }
        return config.retrieveSubscription(id)
      },
      update(id: string, params: Record<string, unknown>, signal?: AbortSignal) {
        if (!config.updateSubscription) {
          throw new Error('subscriptions.update not configured for this test')
        }
        return config.updateSubscription(id, params, signal)
      },
    },
    checkout: {
      sessions: {
        retrieve(id: string) {
          if (!config.retrieveSession) {
            throw new Error('checkout.sessions.retrieve not configured for this test')
          }
          return config.retrieveSession(id)
        },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// mapStripeStatus / normalizeStripeTimestamp -- pure helpers.
// ---------------------------------------------------------------------------

Deno.test('mapStripeStatus maps active and trialing to active', () => {
  assertEquals(mapStripeStatus('active'), 'active')
  assertEquals(mapStripeStatus('trialing'), 'active')
})

Deno.test('mapStripeStatus maps past_due to past_due', () => {
  assertEquals(mapStripeStatus('past_due'), 'past_due')
})

Deno.test('mapStripeStatus maps canceled to canceled', () => {
  assertEquals(mapStripeStatus('canceled'), 'canceled')
})

Deno.test('mapStripeStatus maps unpaid and incomplete_expired to expired', () => {
  assertEquals(mapStripeStatus('unpaid'), 'expired')
  assertEquals(mapStripeStatus('incomplete_expired'), 'expired')
})

Deno.test('mapStripeStatus maps incomplete to pending', () => {
  assertEquals(mapStripeStatus('incomplete'), 'pending')
})

Deno.test('mapStripeStatus throws a provider-contract-violation error on an unrecognized status string', () => {
  let thrown: unknown
  try {
    mapStripeStatus('some_future_stripe_status')
    throw new Error('expected mapStripeStatus to throw')
  } catch (e) {
    thrown = e
  }
  const error = thrown as ReceiptValidationError
  assertEquals(error instanceof ReceiptValidationError, true)
  assertEquals(error.fault, 'provider')
})

Deno.test('normalizeStripeTimestamp converts Unix seconds to a UTC ISO-8601 string', () => {
  assertEquals(
    normalizeStripeTimestamp(1_780_000_000),
    new Date(1_780_000_000 * 1000).toISOString(),
  )
})

// ---------------------------------------------------------------------------
// validateStripeReceipt -- shape validation, dispatch, mapping, and faults.
// ---------------------------------------------------------------------------

Deno.test('validateStripeReceipt rejects a non-string raw_receipt with a client fault and never calls the SDK', async () => {
  const client = stripeClientStub({})
  await assertRejects(
    () => validateStripeReceipt({ not: 'a string' }, { stripeClient: client }),
    ReceiptValidationError,
  )
})

Deno.test('validateStripeReceipt rejects an empty/whitespace-only string raw_receipt with a client fault and never calls the SDK', async () => {
  const client = stripeClientStub({})
  await assertRejects(
    () => validateStripeReceipt('   ', { stripeClient: client }),
    ReceiptValidationError,
  )
})

Deno.test('validateStripeReceipt retrieves a sub_ id directly and returns the normalized result on the happy path', async () => {
  const client = stripeClientStub({
    retrieveSubscription: (id) => {
      assertEquals(id, SUBSCRIPTION_ID)
      return Promise.resolve(subscriptionFixture())
    },
  })
  const result = await validateStripeReceipt(SUBSCRIPTION_ID, { stripeClient: client })
  assertEquals(result.provider_subscription_id, SUBSCRIPTION_ID)
  assertEquals(result.status, 'active')
  assertEquals(result.tier, 'paid_monthly')
  assertEquals(result.current_period_end, new Date(1_780_000_000 * 1000).toISOString())
  assertEquals(result.bound_user_id, null)
  // raw_metadata is the provider metadata JSON persisted to the
  // subscription_receipts.raw_receipt column (the DB column is fed from the
  // validated provider payload, never the caller's original raw input).
  assertEquals(typeof result.raw_metadata, 'object')
})

Deno.test('validateStripeReceipt reads the item-level current_period_end (Stripe 2025-03-31.basil+ shape) with no top-level field', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () =>
      Promise.resolve(
        // Basil default: period end only at items.data[].current_period_end.
        subscriptionFixture({
          items: {
            data: [
              {
                current_period_end: PERIOD_END_SECONDS,
                price: { id: PRICE_ID, recurring: { interval: 'month', interval_count: 1 } },
              },
            ],
          },
        }),
      ),
  })
  const result = await validateStripeReceipt(SUBSCRIPTION_ID, { stripeClient: client })
  assertEquals(result.current_period_end, new Date(PERIOD_END_SECONDS * 1000).toISOString())
})

Deno.test('validateStripeReceipt falls back to a top-level current_period_end for a pre-Basil subscription (no item-level field)', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () =>
      Promise.resolve(
        // Legacy shape: period end at the subscription top level, none on the item.
        subscriptionFixture({
          current_period_end: PERIOD_END_SECONDS,
          items: {
            data: [
              { price: { id: PRICE_ID, recurring: { interval: 'month', interval_count: 1 } } },
            ],
          },
        }),
      ),
  })
  const result = await validateStripeReceipt(SUBSCRIPTION_ID, { stripeClient: client })
  assertEquals(result.current_period_end, new Date(PERIOD_END_SECONDS * 1000).toISOString())
})

Deno.test('validateStripeReceipt surfaces the checkout session client_reference_id as bound_user_id', async () => {
  // client_reference_id is a Checkout Session field (NOT a Subscription field),
  // so the binding is read off the resolved session, not the subscription.
  const client = stripeClientStub({
    retrieveSession: () => Promise.resolve(sessionFixture({ client_reference_id: BOUND_USER_ID })),
    retrieveSubscription: () => Promise.resolve(subscriptionFixture()),
  })
  const result = await validateStripeReceipt(SESSION_ID, { stripeClient: client })
  assertEquals(result.bound_user_id, BOUND_USER_ID)
})

Deno.test('validateStripeReceipt falls back to session.metadata.user_id for bound_user_id when client_reference_id is absent', async () => {
  const client = stripeClientStub({
    retrieveSession: () =>
      Promise.resolve(sessionFixture({ metadata: { user_id: BOUND_USER_ID } })),
    retrieveSubscription: () => Promise.resolve(subscriptionFixture()),
  })
  const result = await validateStripeReceipt(SESSION_ID, { stripeClient: client })
  assertEquals(result.bound_user_id, BOUND_USER_ID)
})

Deno.test('validateStripeReceipt does NOT read client_reference_id off the subscription (it is a session-only field)', async () => {
  // A subscription-level client_reference_id is not a real Stripe field, so a
  // stray one must never become the binding — only subscription.metadata.user_id
  // is a valid sub_-path binding signal.
  const client = stripeClientStub({
    retrieveSubscription: () =>
      Promise.resolve(subscriptionFixture({ client_reference_id: BOUND_USER_ID })),
  })
  const result = await validateStripeReceipt(SUBSCRIPTION_ID, { stripeClient: client })
  assertEquals(result.bound_user_id, null)
})

Deno.test('validateStripeReceipt uses subscription.metadata.user_id as the bound_user_id on the sub_ path', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () =>
      Promise.resolve(subscriptionFixture({ metadata: { user_id: BOUND_USER_ID } })),
  })
  const result = await validateStripeReceipt(SUBSCRIPTION_ID, { stripeClient: client })
  assertEquals(result.bound_user_id, BOUND_USER_ID)
})

Deno.test('validateStripeReceipt resolves a cs_ session id, sanity-checks payment_status/mode, then retrieves the linked subscription', async () => {
  let subscriptionRetrieveCalled = false
  const client = stripeClientStub({
    retrieveSession: (id) => {
      assertEquals(id, SESSION_ID)
      return Promise.resolve(sessionFixture())
    },
    retrieveSubscription: (id) => {
      subscriptionRetrieveCalled = true
      assertEquals(id, SUBSCRIPTION_ID)
      return Promise.resolve(subscriptionFixture())
    },
  })
  const result = await validateStripeReceipt(SESSION_ID, { stripeClient: client })
  assertEquals(subscriptionRetrieveCalled, true)
  assertEquals(result.provider_subscription_id, SUBSCRIPTION_ID)
})

Deno.test('validateStripeReceipt rejects a cs_ session whose payment_status is not complete/paid, with a client fault, and never retrieves the subscription', async () => {
  const client = stripeClientStub({
    retrieveSession: () =>
      Promise.resolve({
        id: SESSION_ID,
        payment_status: 'unpaid',
        mode: 'subscription',
        subscription: SUBSCRIPTION_ID,
      }),
    retrieveSubscription: () => {
      throw new Error('must never retrieve the subscription for an incomplete session')
    },
  })
  const error = await assertRejects(
    () => validateStripeReceipt(SESSION_ID, { stripeClient: client }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).fault, 'client')
})

Deno.test('validateStripeReceipt derives the tier via the product-id map when the interval/count is not one of the two recognized shapes', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () =>
      Promise.resolve(
        subscriptionFixture({
          items: {
            data: [
              {
                current_period_end: PERIOD_END_SECONDS,
                price: {
                  id: 'price_annual_via_monthly_interval',
                  recurring: { interval: 'month', interval_count: 12 },
                },
              },
            ],
          },
        }),
      ),
  })
  const result = await validateStripeReceipt(SUBSCRIPTION_ID, {
    stripeClient: client,
    productTierMap: { price_annual_via_monthly_interval: 'paid_yearly' },
  })
  assertEquals(result.tier, 'paid_yearly')
})

Deno.test('validateStripeReceipt fails with tier_unresolvable (client fault, 400-worthy) when neither the interval rule nor the product map resolves a tier', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () =>
      Promise.resolve(
        subscriptionFixture({
          items: {
            data: [{
              current_period_end: PERIOD_END_SECONDS,
              price: { id: 'price_unmapped', recurring: { interval: 'week', interval_count: 2 } },
            }],
          },
        }),
      ),
  })
  const error = await assertRejects(
    () => validateStripeReceipt(SUBSCRIPTION_ID, { stripeClient: client, productTierMap: {} }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'tier_unresolvable')
  assertEquals((error as ReceiptValidationError).fault, 'client')
})

Deno.test('validateStripeReceipt treats a not-found subscription id as a client fault', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () => Promise.reject(new Error('No such subscription: sub_bogus')),
  })
  const error = await assertRejects(
    () => validateStripeReceipt(SUBSCRIPTION_ID, { stripeClient: client }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).fault, 'client')
})

Deno.test('validateStripeReceipt treats an empty provider_subscription_id on the resolved Subscription as a provider-contract violation (502-worthy)', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () => Promise.resolve(subscriptionFixture({ id: '   ' })),
  })
  const error = await assertRejects(
    () => validateStripeReceipt(SUBSCRIPTION_ID, { stripeClient: client }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'provider_contract_violation')
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})

Deno.test('validateStripeReceipt treats a missing current_period_end on an active subscription as a provider-contract violation, never a null write', async () => {
  // Neither the item-level (Basil) nor the top-level (pre-Basil) period end is
  // present, so there is no period end to resolve anywhere.
  const client = stripeClientStub({
    retrieveSubscription: () =>
      Promise.resolve(
        subscriptionFixture({
          current_period_end: null,
          items: {
            data: [
              { price: { id: PRICE_ID, recurring: { interval: 'month', interval_count: 1 } } },
            ],
          },
        }),
      ),
  })
  const error = await assertRejects(
    () => validateStripeReceipt(SUBSCRIPTION_ID, { stripeClient: client }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'provider_contract_violation')
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})

Deno.test('validateStripeReceipt maps an SDK call that never settles within the timeout budget to a provider-fault timeout error, never a hang', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () => new Promise(() => {}), // never resolves
  })
  const error = await assertRejects(
    () => validateStripeReceipt(SUBSCRIPTION_ID, { stripeClient: client, timeoutMs: 15 }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})

// ---------------------------------------------------------------------------
// cancelStripeSubscriptionAtPeriodEnd -- cancel-at-period-end dispatch, period
// end re-read, idempotent re-cancel, resource-missing vs. generic provider
// fault, and AbortSignal threading.
// ---------------------------------------------------------------------------

Deno.test('cancelStripeSubscriptionAtPeriodEnd calls subscriptions.update with cancel_at_period_end: true and returns the re-read period end', async () => {
  let capturedParams: Record<string, unknown> | null = null
  const client = stripeClientStub({
    updateSubscription: (id, params) => {
      assertEquals(id, SUBSCRIPTION_ID)
      capturedParams = params
      return Promise.resolve(subscriptionFixture())
    },
  })
  const result = await cancelStripeSubscriptionAtPeriodEnd(SUBSCRIPTION_ID, {
    stripeClient: client,
  })
  assertEquals(result.current_period_end, new Date(PERIOD_END_SECONDS * 1000).toISOString())
  assertEquals((capturedParams as unknown as Record<string, unknown>).cancel_at_period_end, true)
})

Deno.test('cancelStripeSubscriptionAtPeriodEnd reads the item-level current_period_end (Basil+ shape) after the update call', async () => {
  const client = stripeClientStub({
    updateSubscription: () =>
      Promise.resolve(
        subscriptionFixture({
          items: {
            data: [
              {
                current_period_end: PERIOD_END_SECONDS,
                price: { id: PRICE_ID, recurring: { interval: 'month', interval_count: 1 } },
              },
            ],
          },
        }),
      ),
  })
  const result = await cancelStripeSubscriptionAtPeriodEnd(SUBSCRIPTION_ID, {
    stripeClient: client,
  })
  assertEquals(result.current_period_end, new Date(PERIOD_END_SECONDS * 1000).toISOString())
})

Deno.test('cancelStripeSubscriptionAtPeriodEnd falls back to a top-level current_period_end for a pre-Basil subscription', async () => {
  const client = stripeClientStub({
    updateSubscription: () =>
      Promise.resolve(
        subscriptionFixture({
          current_period_end: PERIOD_END_SECONDS,
          items: {
            data: [
              { price: { id: PRICE_ID, recurring: { interval: 'month', interval_count: 1 } } },
            ],
          },
        }),
      ),
  })
  const result = await cancelStripeSubscriptionAtPeriodEnd(SUBSCRIPTION_ID, {
    stripeClient: client,
  })
  assertEquals(result.current_period_end, new Date(PERIOD_END_SECONDS * 1000).toISOString())
})

Deno.test('cancelStripeSubscriptionAtPeriodEnd succeeds idempotently when Stripe reports the subscription already scheduled for cancellation', async () => {
  // Stripe treats a repeat cancel_at_period_end=true call on an
  // already-scheduled subscription as a successful no-op -- the seam simply
  // resolves again with the current state, requiring no special-case
  // handling in the helper itself.
  const client = stripeClientStub({
    updateSubscription: () => Promise.resolve(subscriptionFixture({ cancel_at_period_end: true })),
  })
  const result = await cancelStripeSubscriptionAtPeriodEnd(SUBSCRIPTION_ID, {
    stripeClient: client,
  })
  assertEquals(result.current_period_end, new Date(PERIOD_END_SECONDS * 1000).toISOString())
})

Deno.test('cancelStripeSubscriptionAtPeriodEnd maps a 404/resource_missing rejection to a client-fault provider_resource_missing error, never a 502', async () => {
  const client = stripeClientStub({
    updateSubscription: () =>
      Promise.reject(Object.assign(new Error('stripe api responded 404'), { status: 404 })),
  })
  const error = await assertRejects(
    () => cancelStripeSubscriptionAtPeriodEnd(SUBSCRIPTION_ID, { stripeClient: client }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'provider_resource_missing')
  assertEquals((error as ReceiptValidationError).fault, 'client')
})

Deno.test('cancelStripeSubscriptionAtPeriodEnd maps a non-404 rejection (e.g. Stripe 5xx/429) to a generic provider-fault error', async () => {
  const client = stripeClientStub({
    updateSubscription: () =>
      Promise.reject(Object.assign(new Error('stripe api responded 503'), { status: 503 })),
  })
  const error = await assertRejects(
    () => cancelStripeSubscriptionAtPeriodEnd(SUBSCRIPTION_ID, { stripeClient: client }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'provider_cancel_failed')
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})

Deno.test('cancelStripeSubscriptionAtPeriodEnd maps a rejection with no status information to the same generic provider-fault error', async () => {
  const client = stripeClientStub({
    updateSubscription: () => Promise.reject(new Error('network failure')),
  })
  const error = await assertRejects(
    () => cancelStripeSubscriptionAtPeriodEnd(SUBSCRIPTION_ID, { stripeClient: client }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'provider_cancel_failed')
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})

Deno.test('cancelStripeSubscriptionAtPeriodEnd treats a missing current_period_end on the updated subscription as a provider-contract violation (502-worthy)', async () => {
  const client = stripeClientStub({
    updateSubscription: () =>
      Promise.resolve(
        subscriptionFixture({
          current_period_end: null,
          items: {
            data: [
              { price: { id: PRICE_ID, recurring: { interval: 'month', interval_count: 1 } } },
            ],
          },
        }),
      ),
  })
  const error = await assertRejects(
    () => cancelStripeSubscriptionAtPeriodEnd(SUBSCRIPTION_ID, { stripeClient: client }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'provider_contract_violation')
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})

Deno.test('cancelStripeSubscriptionAtPeriodEnd maps an update call that never settles within the timeout budget to a provider-fault timeout error, never a hang', async () => {
  const client = stripeClientStub({
    updateSubscription: () => new Promise(() => {}), // never resolves
  })
  const error = await assertRejects(
    () =>
      cancelStripeSubscriptionAtPeriodEnd(SUBSCRIPTION_ID, { stripeClient: client, timeoutMs: 15 }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'provider_timeout')
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})

Deno.test('cancelStripeSubscriptionAtPeriodEnd threads the withTimeout AbortSignal into the subscriptions.update seam call', async () => {
  let capturedSignal: AbortSignal | undefined
  const client = stripeClientStub({
    updateSubscription: (_id, _params, signal) => {
      capturedSignal = signal
      return Promise.resolve(subscriptionFixture())
    },
  })
  await cancelStripeSubscriptionAtPeriodEnd(SUBSCRIPTION_ID, { stripeClient: client })
  assertEquals(capturedSignal instanceof AbortSignal, true)
})

// ---------------------------------------------------------------------------
// validateStripeReceipt -- carry-in hardening fold-in: a malformed/
// out-of-range current_period_end must map to the same provider-fault 502 as
// the (already-guarded) cancel path, never an uncaught RangeError.
// ---------------------------------------------------------------------------

Deno.test('validateStripeReceipt maps a malformed/out-of-range current_period_end to a provider-fault 502, never an uncaught RangeError/500 (carry-in hardening fold-in)', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () =>
      Promise.resolve(
        subscriptionFixture({
          items: {
            data: [
              {
                // Out of Date's representable range -- normalizeStripeTimestamp's
                // `new Date(unixSeconds * 1000).toISOString()` throws a RangeError
                // ("Invalid time value") on a value this large, prior to this
                // fold-in landing.
                current_period_end: 99_999_999_999_999_999,
                price: { id: PRICE_ID, recurring: { interval: 'month', interval_count: 1 } },
              },
            ],
          },
        }),
      ),
  })
  const error = await assertRejects(
    () => validateStripeReceipt(SUBSCRIPTION_ID, { stripeClient: client }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'provider_contract_violation')
  assertEquals((error as ReceiptValidationError).fault, 'provider')
  assertEquals((error as ReceiptValidationError).status, 502)
})

// ---------------------------------------------------------------------------
// verifyStripeWebhookSignature -- header parsing, HMAC compare, tolerance
// window, and the raw-body-unmodified invariant.
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = 'whsec_test_signing_secret_0123456789abcdef'
const WEBHOOK_NOW_MS = Date.parse('2026-07-15T12:00:00.000Z')
const WEBHOOK_RAW_BODY = JSON.stringify({
  id: 'evt_test_signature_fixture_1',
  type: 'invoice.paid',
  data: { object: { id: 'in_test_1' } },
})

// Computes the same `${t}.${rawBody}` HMAC-SHA256 digest the verifier itself
// computes -- fixtures are self-consistent, never a hardcoded digest.
function computeStripeV1(secret: string, timestampSeconds: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex')
}

function stripeSignatureHeader(
  secret: string,
  rawBody: string,
  timestampSeconds: number,
  extraSchemes: string[] = [],
): string {
  const v1 = computeStripeV1(secret, timestampSeconds, rawBody)
  return [`t=${timestampSeconds}`, `v1=${v1}`, ...extraSchemes].join(',')
}

Deno.test('verifyStripeWebhookSignature verifies a valid signature within the tolerance window and returns the parsed event', () => {
  const t = Math.floor(WEBHOOK_NOW_MS / 1000)
  const header = stripeSignatureHeader(WEBHOOK_SECRET, WEBHOOK_RAW_BODY, t)
  const event = verifyStripeWebhookSignature(WEBHOOK_RAW_BODY, header, WEBHOOK_SECRET, {
    nowMs: WEBHOOK_NOW_MS,
  })
  assertEquals(event, JSON.parse(WEBHOOK_RAW_BODY))
})

Deno.test('verifyStripeWebhookSignature returns the SAME parsed event as JSON.parse(rawBody) for an irregularly-formatted body -- proving the raw string is HMAC-verified as-is, never re-serialized before verifying', () => {
  // Extra whitespace/newlines change the byte sequence but not the parsed
  // shape. If the implementation ever re-serialized
  // (JSON.stringify(JSON.parse(rawBody))) before computing the HMAC, this
  // exact-byte signature would fail to verify a real, un-tampered body.
  const irregularBody =
    '{\n  "id": "evt_formatting_sensitive",\n  "type": "customer.subscription.updated",\n  "data":   { "object": { "id": "sub_x" } }\n}\n'
  const t = Math.floor(WEBHOOK_NOW_MS / 1000)
  const header = stripeSignatureHeader(WEBHOOK_SECRET, irregularBody, t)
  const event = verifyStripeWebhookSignature(irregularBody, header, WEBHOOK_SECRET, {
    nowMs: WEBHOOK_NOW_MS,
  })
  assertEquals(event, JSON.parse(irregularBody))
})

Deno.test('verifyStripeWebhookSignature throws webhook_signature_invalid (client fault) when the secret does not match', () => {
  const t = Math.floor(WEBHOOK_NOW_MS / 1000)
  const header = stripeSignatureHeader(WEBHOOK_SECRET, WEBHOOK_RAW_BODY, t)
  const error = assertThrows<ReceiptValidationError>(
    () =>
      verifyStripeWebhookSignature(
        WEBHOOK_RAW_BODY,
        header,
        'whsec_a_completely_different_secret',
        {
          nowMs: WEBHOOK_NOW_MS,
        },
      ),
    ReceiptValidationError,
  )
  assertEquals(error.code, 'webhook_signature_invalid')
  assertEquals(error.fault, 'client')
})

Deno.test('verifyStripeWebhookSignature rejects an empty/whitespace secret with webhook_signature_invalid even when the header carries a v1 that matches the empty-keyed HMAC (defense-in-depth: no forgeable-HMAC bypass)', () => {
  // A future caller that forgets the handler-level unset-secret check must not
  // open a forgeable-HMAC hole: with an empty key the digest is a known constant
  // any caller could reproduce. The verifier must fail closed BEFORE the compare.
  const t = Math.floor(WEBHOOK_NOW_MS / 1000)
  for (const emptySecret of ['', '   ']) {
    // Sign with the empty/whitespace secret so the v1 WOULD match if the guard
    // were absent -- proving the rejection is the guard, not an incidental mismatch.
    const header = stripeSignatureHeader(emptySecret, WEBHOOK_RAW_BODY, t)
    const error = assertThrows<ReceiptValidationError>(
      () =>
        verifyStripeWebhookSignature(WEBHOOK_RAW_BODY, header, emptySecret, {
          nowMs: WEBHOOK_NOW_MS,
        }),
      ReceiptValidationError,
    )
    assertEquals(error.code, 'webhook_signature_invalid')
    assertEquals(error.fault, 'client')
  }
})

Deno.test('verifyStripeWebhookSignature throws webhook_signature_invalid when the signature was computed for a DIFFERENT body than the one delivered (tamper detection)', () => {
  const t = Math.floor(WEBHOOK_NOW_MS / 1000)
  const signedForBodyA = JSON.stringify({ id: 'evt_body_a', type: 'invoice.paid', data: {} })
  const deliveredBodyB = JSON.stringify({ id: 'evt_body_b', type: 'invoice.paid', data: {} })
  const header = stripeSignatureHeader(WEBHOOK_SECRET, signedForBodyA, t)
  assertThrows(
    () =>
      verifyStripeWebhookSignature(deliveredBodyB, header, WEBHOOK_SECRET, {
        nowMs: WEBHOOK_NOW_MS,
      }),
    ReceiptValidationError,
  )
})

Deno.test('verifyStripeWebhookSignature throws webhook_signature_invalid for a timestamp beyond the default 300s tolerance (stale/replay)', () => {
  const staleT = Math.floor(WEBHOOK_NOW_MS / 1000) - 400
  const header = stripeSignatureHeader(WEBHOOK_SECRET, WEBHOOK_RAW_BODY, staleT)
  const error = assertThrows<ReceiptValidationError>(
    () =>
      verifyStripeWebhookSignature(WEBHOOK_RAW_BODY, header, WEBHOOK_SECRET, {
        nowMs: WEBHOOK_NOW_MS,
      }),
    ReceiptValidationError,
  )
  assertEquals(error.code, 'webhook_signature_invalid')
})

Deno.test('verifyStripeWebhookSignature throws webhook_signature_invalid for a FUTURE timestamp beyond tolerance (clock-skew/replay in the other direction)', () => {
  const futureT = Math.floor(WEBHOOK_NOW_MS / 1000) + 400
  const header = stripeSignatureHeader(WEBHOOK_SECRET, WEBHOOK_RAW_BODY, futureT)
  assertThrows(
    () =>
      verifyStripeWebhookSignature(WEBHOOK_RAW_BODY, header, WEBHOOK_SECRET, {
        nowMs: WEBHOOK_NOW_MS,
      }),
    ReceiptValidationError,
  )
})

Deno.test('verifyStripeWebhookSignature accepts a timestamp within an injected, narrower opts.toleranceSeconds window', () => {
  const t = Math.floor(WEBHOOK_NOW_MS / 1000) - 5
  const header = stripeSignatureHeader(WEBHOOK_SECRET, WEBHOOK_RAW_BODY, t)
  const event = verifyStripeWebhookSignature(WEBHOOK_RAW_BODY, header, WEBHOOK_SECRET, {
    nowMs: WEBHOOK_NOW_MS,
    toleranceSeconds: 10,
  })
  assertEquals(event, JSON.parse(WEBHOOK_RAW_BODY))
})

Deno.test('verifyStripeWebhookSignature rejects a timestamp outside an injected, narrower opts.toleranceSeconds window that the default 300s would have accepted', () => {
  const t = Math.floor(WEBHOOK_NOW_MS / 1000) - 60
  const header = stripeSignatureHeader(WEBHOOK_SECRET, WEBHOOK_RAW_BODY, t)
  assertThrows(
    () =>
      verifyStripeWebhookSignature(WEBHOOK_RAW_BODY, header, WEBHOOK_SECRET, {
        nowMs: WEBHOOK_NOW_MS,
        toleranceSeconds: 10,
      }),
    ReceiptValidationError,
  )
})

Deno.test('verifyStripeWebhookSignature throws webhook_signature_invalid when the header has no t= field', () => {
  const t = Math.floor(WEBHOOK_NOW_MS / 1000)
  const v1 = computeStripeV1(WEBHOOK_SECRET, t, WEBHOOK_RAW_BODY)
  assertThrows(
    () =>
      verifyStripeWebhookSignature(WEBHOOK_RAW_BODY, `v1=${v1}`, WEBHOOK_SECRET, {
        nowMs: WEBHOOK_NOW_MS,
      }),
    ReceiptValidationError,
  )
})

Deno.test('verifyStripeWebhookSignature throws webhook_signature_invalid when the header has no v1= field', () => {
  const t = Math.floor(WEBHOOK_NOW_MS / 1000)
  assertThrows(
    () =>
      verifyStripeWebhookSignature(WEBHOOK_RAW_BODY, `t=${t}`, WEBHOOK_SECRET, {
        nowMs: WEBHOOK_NOW_MS,
      }),
    ReceiptValidationError,
  )
})

Deno.test('verifyStripeWebhookSignature throws webhook_signature_invalid for a garbage/malformed header with neither t= nor v1=', () => {
  assertThrows(
    () =>
      verifyStripeWebhookSignature(
        WEBHOOK_RAW_BODY,
        'not-a-real-stripe-signature-header',
        WEBHOOK_SECRET,
        {
          nowMs: WEBHOOK_NOW_MS,
        },
      ),
    ReceiptValidationError,
  )
})

Deno.test('verifyStripeWebhookSignature throws webhook_signature_invalid for an empty header string', () => {
  assertThrows(
    () =>
      verifyStripeWebhookSignature(WEBHOOK_RAW_BODY, '', WEBHOOK_SECRET, { nowMs: WEBHOOK_NOW_MS }),
    ReceiptValidationError,
  )
})

Deno.test('verifyStripeWebhookSignature accepts a header with MULTIPLE v1 schemes when only the SECOND one matches', () => {
  const t = Math.floor(WEBHOOK_NOW_MS / 1000)
  const wrongV1 = 'deadbeef'.repeat(8) // 64 hex chars -- same length, wrong content
  const correctV1 = computeStripeV1(WEBHOOK_SECRET, t, WEBHOOK_RAW_BODY)
  const header = `t=${t},v1=${wrongV1},v1=${correctV1}`
  const event = verifyStripeWebhookSignature(WEBHOOK_RAW_BODY, header, WEBHOOK_SECRET, {
    nowMs: WEBHOOK_NOW_MS,
  })
  assertEquals(event, JSON.parse(WEBHOOK_RAW_BODY))
})

Deno.test('verifyStripeWebhookSignature throws webhook_signature_invalid when NONE of multiple v1 schemes match', () => {
  const t = Math.floor(WEBHOOK_NOW_MS / 1000)
  const header = `t=${t},v1=${'deadbeef'.repeat(8)},v1=${'cafebabe'.repeat(8)}`
  assertThrows(
    () =>
      verifyStripeWebhookSignature(WEBHOOK_RAW_BODY, header, WEBHOOK_SECRET, {
        nowMs: WEBHOOK_NOW_MS,
      }),
    ReceiptValidationError,
  )
})

Deno.test('verifyStripeWebhookSignature fails cleanly (length-gated compare) when a v1 value has the WRONG LENGTH, never crashing on a byte-length mismatch', () => {
  // Exercises the constant-time compare's length gate specifically -- a
  // too-short v1 must fail the same way an equal-length-but-wrong-content v1
  // does (a length-mismatch timingSafeEqual call would throw a RangeError, so
  // the gate must short-circuit BEFORE calling it).
  const t = Math.floor(WEBHOOK_NOW_MS / 1000)
  const header = `t=${t},v1=short`
  assertThrows(
    () =>
      verifyStripeWebhookSignature(WEBHOOK_RAW_BODY, header, WEBHOOK_SECRET, {
        nowMs: WEBHOOK_NOW_MS,
      }),
    ReceiptValidationError,
  )
})

// ---------------------------------------------------------------------------
// refreshStripeSubscriptionState -- retrieve-by-id, period-end resolution,
// tier-null-never-throws, and the malformed-timestamp 502 fold-in.
// ---------------------------------------------------------------------------

Deno.test('refreshStripeSubscriptionState retrieves the Subscription FRESH by id via the injected seam and returns its normalized state', async () => {
  let retrievedId: string | null = null
  const client = stripeClientStub({
    retrieveSubscription: (id) => {
      retrievedId = id
      return Promise.resolve(subscriptionFixture())
    },
  })
  const result = await refreshStripeSubscriptionState(SUBSCRIPTION_ID, { stripeClient: client })
  assertEquals(retrievedId, SUBSCRIPTION_ID)
  assertEquals(result.provider_subscription_id, SUBSCRIPTION_ID)
  assertEquals(result.status, 'active')
  assertEquals(result.current_period_end, new Date(PERIOD_END_SECONDS * 1000).toISOString())
  assertEquals(result.tier, 'paid_monthly')
})

Deno.test('refreshStripeSubscriptionState reads the item-level current_period_end (Stripe 2025-03-31.basil+ shape) first', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () =>
      Promise.resolve(
        subscriptionFixture({
          items: {
            data: [
              {
                current_period_end: PERIOD_END_SECONDS,
                price: { id: PRICE_ID, recurring: { interval: 'month', interval_count: 1 } },
              },
            ],
          },
        }),
      ),
  })
  const result = await refreshStripeSubscriptionState(SUBSCRIPTION_ID, { stripeClient: client })
  assertEquals(result.current_period_end, new Date(PERIOD_END_SECONDS * 1000).toISOString())
})

Deno.test('refreshStripeSubscriptionState falls back to a top-level current_period_end for a pre-Basil subscription (no item-level field)', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () =>
      Promise.resolve(
        subscriptionFixture({
          current_period_end: PERIOD_END_SECONDS,
          items: {
            data: [
              { price: { id: PRICE_ID, recurring: { interval: 'month', interval_count: 1 } } },
            ],
          },
        }),
      ),
  })
  const result = await refreshStripeSubscriptionState(SUBSCRIPTION_ID, { stripeClient: client })
  assertEquals(result.current_period_end, new Date(PERIOD_END_SECONDS * 1000).toISOString())
})

Deno.test('refreshStripeSubscriptionState returns tier: null (never throws) when the plan cannot be resolved, while STILL refreshing status/current_period_end', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () =>
      Promise.resolve(
        subscriptionFixture({
          items: {
            data: [
              {
                current_period_end: PERIOD_END_SECONDS,
                price: { id: 'price_unmapped', recurring: { interval: 'week', interval_count: 2 } },
              },
            ],
          },
        }),
      ),
  })
  const result = await refreshStripeSubscriptionState(SUBSCRIPTION_ID, {
    stripeClient: client,
    productTierMap: {},
  })
  assertEquals(result.tier, null)
  assertEquals(result.status, 'active')
  assertEquals(result.current_period_end, new Date(PERIOD_END_SECONDS * 1000).toISOString())
})

Deno.test('refreshStripeSubscriptionState resolves the tier via the product-id map when the interval/count is not one of the two recognized shapes', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () =>
      Promise.resolve(
        subscriptionFixture({
          items: {
            data: [
              {
                current_period_end: PERIOD_END_SECONDS,
                price: {
                  id: 'price_annual_via_monthly_interval',
                  recurring: { interval: 'month', interval_count: 12 },
                },
              },
            ],
          },
        }),
      ),
  })
  const result = await refreshStripeSubscriptionState(SUBSCRIPTION_ID, {
    stripeClient: client,
    productTierMap: { price_annual_via_monthly_interval: 'paid_yearly' },
  })
  assertEquals(result.tier, 'paid_yearly')
})

Deno.test('refreshStripeSubscriptionState maps a malformed/out-of-range current_period_end to a provider-fault 502, never an uncaught RangeError (carry-in hardening)', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () =>
      Promise.resolve(
        subscriptionFixture({
          items: {
            data: [
              {
                current_period_end: 99_999_999_999_999_999,
                price: { id: PRICE_ID, recurring: { interval: 'month', interval_count: 1 } },
              },
            ],
          },
        }),
      ),
  })
  const error = await assertRejects(
    () => refreshStripeSubscriptionState(SUBSCRIPTION_ID, { stripeClient: client }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'provider_contract_violation')
  assertEquals((error as ReceiptValidationError).fault, 'provider')
  assertEquals((error as ReceiptValidationError).status, 502)
})

Deno.test('refreshStripeSubscriptionState propagates a provider-contract-violation error for an unrecognized Stripe status', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () =>
      Promise.resolve(subscriptionFixture({ status: 'some_future_stripe_status' })),
  })
  const error = await assertRejects(
    () => refreshStripeSubscriptionState(SUBSCRIPTION_ID, { stripeClient: client }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'provider_contract_violation')
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})

Deno.test('refreshStripeSubscriptionState maps a retrieve call that never settles within the timeout budget to a provider-fault timeout error, never a hang', async () => {
  const client = stripeClientStub({
    retrieveSubscription: () => new Promise(() => {}), // never resolves
  })
  const error = await assertRejects(
    () => refreshStripeSubscriptionState(SUBSCRIPTION_ID, { stripeClient: client, timeoutMs: 15 }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'provider_timeout')
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})
