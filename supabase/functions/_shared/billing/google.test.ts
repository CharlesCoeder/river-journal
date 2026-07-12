// Deno unit tests for the Google Play receipt validator.
//
// Run locally with: deno test --allow-env --allow-net supabase/functions/
//
// NOT wired into `yarn vitest` -- supabase/functions/** is excluded from the
// root vitest.config.mts glob (Deno 2 code). This file is `deno test`-only.
//
// Contract pinned down here (inferred from the acceptance criteria -- not
// verbatim named in the source spec):
//   - validateGoogleReceipt(rawReceipt: unknown, deps: GoogleDeps):
//     Promise<ReceiptValidationResult>. `rawReceipt` must be an object
//     shaped `{ purchaseToken: string }` with a non-empty purchaseToken --
//     any other shape throws { code: 'invalid_receipt_shape', fault:
//     'client' } BEFORE any network call.
//   - deps: { serviceAccountJson: string; packageName: string; fetchImpl?:
//     typeof fetch; productTierMap?: Record<string, SubscriptionTier>;
//     timeoutMs?: number }. A serviceAccountJson that fails to JSON.parse
//     (or lacks the fields needed to build an auth assertion) is OUR
//     misconfiguration, not the caller's fault -- throws
//     { code: 'service_account_misconfigured', fault: 'provider' } BEFORE
//     any fetch.
//   - Two outbound calls on the happy path, both through deps.fetchImpl: (1)
//     an OAuth2 token exchange (service-account JWT bearer grant) to obtain
//     an access token; (2) a GET against the Play Developer API v2
//     subscriptionsv2 endpoint for `packageName` + the purchase token,
//     Authorization: Bearer <access token>.
//   - subscriptionsv2 response shape: { subscriptionState: string;
//     lineItems: [{ productId: string; expiryTime: string (RFC-3339 or
//     epoch-ms string); billingPeriodDuration: string (ISO-8601 duration,
//     e.g. 'P1M'/'P1Y', read for tier derivation via the shared
//     deriveTierFromInterval + parseApplePeriod-equivalent parsing) }] }.
//     The FIRST lineItem is authoritative (single-line-item subscriptions
//     only, consistent with this app's plan model).
//   - mapGoogleStatus(subscriptionState): SUBSCRIPTION_STATE_ACTIVE ->
//     active; SUBSCRIPTION_STATE_IN_GRACE_PERIOD ->
//     SUBSCRIPTION_STATE_ON_HOLD -> past_due; SUBSCRIPTION_STATE_CANCELED ->
//     canceled; SUBSCRIPTION_STATE_EXPIRED ->
//     SUBSCRIPTION_STATE_PAUSED -> expired; SUBSCRIPTION_STATE_PENDING ->
//     pending; an unrecognized state is a provider-contract violation
//     (fault 'provider').
//   - normalizeGoogleTimestamp(value): if `value` is a numeric-only string,
//     treated as epoch ms (`new Date(Number(value)).toISOString()`);
//     otherwise parsed as an RFC-3339 string (`new
//     Date(value).toISOString()`).
//   - A 404 or 410 from the subscriptionsv2 endpoint (token expired / not
//     found) is a client fault. A non-2xx/5xx or an auth (401 on the token
//     exchange) failure is a provider fault. A fetch that never settles
//     within deps.timeoutMs is a provider-fault timeout.
//   - An empty productId-derived subscription identifier or a missing
//     expiryTime on the first lineItem is a provider-contract violation.
//
// Red phase: ./google.ts does not exist yet, so every test in this file
// fails at import resolution before a single assertion runs.

import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { ReceiptValidationError } from './types.ts'
import { mapGoogleStatus, normalizeGoogleTimestamp, validateGoogleReceipt } from './google.ts'

const PACKAGE_NAME = 'com.riverjournal.app'
const PURCHASE_TOKEN = 'test-purchase-token-0000000001'
const SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'river-journal-test',
  private_key: '-----BEGIN PRIVATE KEY-----\nFAKEFAKEFAKE\n-----END PRIVATE KEY-----\n',
  client_email: 'billing-test@river-journal-test.iam.gserviceaccount.com',
  token_uri: 'https://oauth2.googleapis.com/token',
})
const FUTURE_RFC3339 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

function lineItem(overrides: Record<string, unknown> = {}) {
  return {
    productId: 'paid_monthly_subscription',
    expiryTime: FUTURE_RFC3339,
    billingPeriodDuration: 'P1M',
    ...overrides,
  }
}

function subscriptionsV2Response(
  state: string,
  items: Array<Record<string, unknown>> = [lineItem()],
) {
  return { subscriptionState: state, lineItems: items }
}

// Two-call fetch stub: call 0 is the token exchange, call 1 is the
// subscriptionsv2 GET, matched by URL substring rather than strict order so
// a test can assert on either leg independently.
function fetchStub(
  handlers: Record<string, () => { status: number; body: unknown }>,
) {
  const calls: string[] = []
  const fn = ((url: string, init?: RequestInit) => {
    calls.push(url)
    void init
    const matchKey = Object.keys(handlers).find((k) => url.includes(k))
    if (!matchKey) {
      throw new Error(`unexpected fetch call to "${url}"`)
    }
    const { status, body } = handlers[matchKey]!()
    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  }) as typeof fetch
  return { fn, calls }
}

function okDeps(overrides: Record<string, unknown> = {}) {
  return {
    serviceAccountJson: SERVICE_ACCOUNT_JSON,
    packageName: PACKAGE_NAME,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

Deno.test('mapGoogleStatus maps SUBSCRIPTION_STATE_ACTIVE to active', () => {
  assertEquals(mapGoogleStatus('SUBSCRIPTION_STATE_ACTIVE'), 'active')
})

Deno.test('mapGoogleStatus maps grace-period and on-hold states to past_due', () => {
  assertEquals(mapGoogleStatus('SUBSCRIPTION_STATE_IN_GRACE_PERIOD'), 'past_due')
  assertEquals(mapGoogleStatus('SUBSCRIPTION_STATE_ON_HOLD'), 'past_due')
})

Deno.test('mapGoogleStatus maps SUBSCRIPTION_STATE_CANCELED to canceled', () => {
  assertEquals(mapGoogleStatus('SUBSCRIPTION_STATE_CANCELED'), 'canceled')
})

Deno.test('mapGoogleStatus maps expired and paused states to expired', () => {
  assertEquals(mapGoogleStatus('SUBSCRIPTION_STATE_EXPIRED'), 'expired')
  assertEquals(mapGoogleStatus('SUBSCRIPTION_STATE_PAUSED'), 'expired')
})

Deno.test('mapGoogleStatus maps SUBSCRIPTION_STATE_PENDING to pending', () => {
  assertEquals(mapGoogleStatus('SUBSCRIPTION_STATE_PENDING'), 'pending')
})

Deno.test('mapGoogleStatus throws a provider-contract-violation error on an unrecognized state', () => {
  let thrown: unknown
  try {
    mapGoogleStatus('SUBSCRIPTION_STATE_FUTURE_UNKNOWN')
    throw new Error('expected mapGoogleStatus to throw')
  } catch (e) {
    thrown = e
  }
  assertEquals((thrown as ReceiptValidationError).fault, 'provider')
})

Deno.test('normalizeGoogleTimestamp passes an RFC-3339 string through as a UTC ISO-8601 string', () => {
  assertEquals(normalizeGoogleTimestamp(FUTURE_RFC3339), new Date(FUTURE_RFC3339).toISOString())
})

Deno.test('normalizeGoogleTimestamp converts a numeric epoch-ms string to a UTC ISO-8601 string', () => {
  assertEquals(normalizeGoogleTimestamp('1780000000000'), new Date(1_780_000_000_000).toISOString())
})

// ---------------------------------------------------------------------------
// validateGoogleReceipt -- shape validation, auth, status/fault mapping,
// tier derivation, timeout.
// ---------------------------------------------------------------------------

Deno.test('validateGoogleReceipt rejects a raw_receipt missing purchaseToken with a client fault and never calls fetch', async () => {
  const { fn, calls } = fetchStub({})
  await assertRejects(
    () => validateGoogleReceipt({ notPurchaseToken: 'x' }, { ...okDeps(), fetchImpl: fn }),
    ReceiptValidationError,
  )
  assertEquals(calls.length, 0)
})

Deno.test('validateGoogleReceipt rejects an empty purchaseToken with a client fault and never calls fetch', async () => {
  const { fn, calls } = fetchStub({})
  await assertRejects(
    () => validateGoogleReceipt({ purchaseToken: '' }, { ...okDeps(), fetchImpl: fn }),
    ReceiptValidationError,
  )
  assertEquals(calls.length, 0)
})

Deno.test('validateGoogleReceipt treats an unparseable serviceAccountJson as our own misconfiguration (provider fault), before any fetch', async () => {
  const { fn, calls } = fetchStub({})
  const error = await assertRejects(
    () =>
      validateGoogleReceipt(
        { purchaseToken: PURCHASE_TOKEN },
        { ...okDeps({ serviceAccountJson: 'not valid json {' }), fetchImpl: fn },
      ),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).fault, 'provider')
  assertEquals(calls.length, 0)
})

Deno.test('validateGoogleReceipt exchanges a token then queries subscriptionsv2 for packageName + purchaseToken on the happy path', async () => {
  const { fn, calls } = fetchStub({
    'oauth2.googleapis.com/token': () => ({
      status: 200,
      body: { access_token: 'fake-access-token', expires_in: 3600 },
    }),
    'androidpublisher.googleapis.com': () => ({
      status: 200,
      body: subscriptionsV2Response('SUBSCRIPTION_STATE_ACTIVE'),
    }),
  })
  const result = await validateGoogleReceipt({ purchaseToken: PURCHASE_TOKEN }, {
    ...okDeps(),
    fetchImpl: fn,
  })
  assertEquals(calls.length, 2)
  assertEquals(calls.some((u) => u.includes(PACKAGE_NAME)), true)
  assertEquals(calls.some((u) => u.includes(PURCHASE_TOKEN)), true)
  assertEquals(result.status, 'active')
  assertEquals(result.tier, 'paid_monthly')
  // raw_metadata is the provider metadata JSON persisted to the
  // subscription_receipts.raw_receipt column -- never the caller's original
  // raw_receipt input.
  assertEquals(typeof result.raw_metadata, 'object')
})

Deno.test('validateGoogleReceipt derives paid_yearly for a P1Y billingPeriodDuration', async () => {
  const { fn } = fetchStub({
    'oauth2.googleapis.com/token': () => ({
      status: 200,
      body: { access_token: 'fake-access-token' },
    }),
    'androidpublisher.googleapis.com': () => ({
      status: 200,
      body: subscriptionsV2Response('SUBSCRIPTION_STATE_ACTIVE', [
        lineItem({ billingPeriodDuration: 'P1Y' }),
      ]),
    }),
  })
  const result = await validateGoogleReceipt({ purchaseToken: PURCHASE_TOKEN }, {
    ...okDeps(),
    fetchImpl: fn,
  })
  assertEquals(result.tier, 'paid_yearly')
})

Deno.test('validateGoogleReceipt falls back to the product map for an unrecognized billing period', async () => {
  const { fn } = fetchStub({
    'oauth2.googleapis.com/token': () => ({
      status: 200,
      body: { access_token: 'fake-access-token' },
    }),
    'androidpublisher.googleapis.com': () => ({
      status: 200,
      body: subscriptionsV2Response('SUBSCRIPTION_STATE_ACTIVE', [
        lineItem({ productId: 'quarterly_plan', billingPeriodDuration: 'P3M' }),
      ]),
    }),
  })
  const result = await validateGoogleReceipt(
    { purchaseToken: PURCHASE_TOKEN },
    { ...okDeps(), fetchImpl: fn, productTierMap: { quarterly_plan: 'paid_yearly' } },
  )
  assertEquals(result.tier, 'paid_yearly')
})

Deno.test('validateGoogleReceipt rejects with tier_unresolvable for an unrecognized, unmapped billing period', async () => {
  const { fn } = fetchStub({
    'oauth2.googleapis.com/token': () => ({
      status: 200,
      body: { access_token: 'fake-access-token' },
    }),
    'androidpublisher.googleapis.com': () => ({
      status: 200,
      body: subscriptionsV2Response('SUBSCRIPTION_STATE_ACTIVE', [
        lineItem({ productId: 'mystery_plan', billingPeriodDuration: 'P3M' }),
      ]),
    }),
  })
  const error = await assertRejects(
    () =>
      validateGoogleReceipt({ purchaseToken: PURCHASE_TOKEN }, {
        ...okDeps(),
        fetchImpl: fn,
        productTierMap: {},
      }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'tier_unresolvable')
})

Deno.test('validateGoogleReceipt treats a 404 from subscriptionsv2 (token not found) as a client fault', async () => {
  const { fn } = fetchStub({
    'oauth2.googleapis.com/token': () => ({
      status: 200,
      body: { access_token: 'fake-access-token' },
    }),
    'androidpublisher.googleapis.com': () => ({
      status: 404,
      body: { error: { code: 404, message: 'not found' } },
    }),
  })
  const error = await assertRejects(
    () => validateGoogleReceipt({ purchaseToken: PURCHASE_TOKEN }, { ...okDeps(), fetchImpl: fn }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).fault, 'client')
})

Deno.test('validateGoogleReceipt treats a 410 from subscriptionsv2 (token expired) as a client fault', async () => {
  const { fn } = fetchStub({
    'oauth2.googleapis.com/token': () => ({
      status: 200,
      body: { access_token: 'fake-access-token' },
    }),
    'androidpublisher.googleapis.com': () => ({
      status: 410,
      body: { error: { code: 410, message: 'gone' } },
    }),
  })
  const error = await assertRejects(
    () => validateGoogleReceipt({ purchaseToken: PURCHASE_TOKEN }, { ...okDeps(), fetchImpl: fn }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).fault, 'client')
})

Deno.test('validateGoogleReceipt treats a 401 on the token exchange as a provider fault (our credential, not the caller’s receipt)', async () => {
  const { fn } = fetchStub({
    'oauth2.googleapis.com/token': () => ({ status: 401, body: { error: 'invalid_client' } }),
  })
  const error = await assertRejects(
    () => validateGoogleReceipt({ purchaseToken: PURCHASE_TOKEN }, { ...okDeps(), fetchImpl: fn }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})

Deno.test('validateGoogleReceipt treats a 5xx from subscriptionsv2 as a provider fault (transient, retry-able)', async () => {
  const { fn } = fetchStub({
    'oauth2.googleapis.com/token': () => ({
      status: 200,
      body: { access_token: 'fake-access-token' },
    }),
    'androidpublisher.googleapis.com': () => ({
      status: 503,
      body: { error: { code: 503, message: 'unavailable' } },
    }),
  })
  const error = await assertRejects(
    () => validateGoogleReceipt({ purchaseToken: PURCHASE_TOKEN }, { ...okDeps(), fetchImpl: fn }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})

Deno.test('validateGoogleReceipt treats a missing expiryTime on the first lineItem as a provider-contract violation', async () => {
  const { fn } = fetchStub({
    'oauth2.googleapis.com/token': () => ({
      status: 200,
      body: { access_token: 'fake-access-token' },
    }),
    'androidpublisher.googleapis.com': () => ({
      status: 200,
      body: subscriptionsV2Response('SUBSCRIPTION_STATE_ACTIVE', [
        lineItem({ expiryTime: undefined }),
      ]),
    }),
  })
  const error = await assertRejects(
    () => validateGoogleReceipt({ purchaseToken: PURCHASE_TOKEN }, { ...okDeps(), fetchImpl: fn }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'provider_contract_violation')
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})

Deno.test('validateGoogleReceipt maps a fetch that never settles within the timeout budget to a provider-fault timeout error', async () => {
  const hangingFetch = (() => new Promise<Response>(() => {})) as typeof fetch
  const error = await assertRejects(
    () =>
      validateGoogleReceipt(
        { purchaseToken: PURCHASE_TOKEN },
        { ...okDeps(), fetchImpl: hangingFetch, timeoutMs: 15 },
      ),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})
