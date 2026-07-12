// Deno unit tests for the Apple App Store receipt validator.
//
// Run locally with: deno test --allow-env --allow-net supabase/functions/
//
// NOT wired into `yarn vitest` -- supabase/functions/** is excluded from the
// root vitest.config.mts glob (Deno 2 code). This file is `deno test`-only.
//
// Contract pinned down here (inferred from the acceptance criteria -- not
// verbatim named in the source spec):
//   - validateAppleReceipt(rawReceipt: unknown, deps: AppleDeps):
//     Promise<ReceiptValidationResult>. `rawReceipt` must be either a
//     non-empty base64 receipt string OR an object shaped
//     `{ 'receipt-data': string }` (non-empty) -- any other shape throws
//     { code: 'invalid_receipt_shape', fault: 'client' } BEFORE any network
//     call.
//   - deps: { sharedSecret: string; fetchImpl?: typeof fetch;
//     productTierMap?: Record<string, SubscriptionTier>; timeoutMs?: number }.
//     Outbound HTTP is mocked by swapping deps.fetchImpl (defaulting to
//     globalThis.fetch in production) -- the expoPush.test.ts fetch-swap
//     idiom, injected rather than global here so a test never needs to
//     restore globalThis.fetch for this module.
//   - Sandbox-then-production fallback: POST production
//     (APPLE_PRODUCTION_VERIFY_RECEIPT_URL) first with
//     `{ 'receipt-data': ..., password: sharedSecret }`; on a response body
//     `{ status: 21007 }` retry the SAME payload against
//     APPLE_SANDBOX_VERIFY_RECEIPT_URL. Any other non-zero status is a
//     terminal failure -- NOT retried against sandbox.
//   - Status-code fault split: status 0 is success. 21003/21010 (and other
//     documented "invalid receipt" codes) are a client fault. 21005 (Apple
//     server unavailable) is a provider fault (5xx-worthy, not the user's
//     fault). Any other non-zero, non-21007 status is treated as a client
//     fault (malformed/rejected receipt) unless explicitly provider-fault
//     documented above.
//   - On success, the LATEST entry in `latest_receipt_info` (max
//     `expires_date_ms`) is used. Each entry carries `product_id`,
//     `expires_date_ms` (epoch ms as a STRING), `cancellation_date_ms`
//     (string epoch ms or absent), and `subscription_period` (an ISO-8601
//     duration, e.g. 'P1M'/'P1Y', read for tier derivation via the shared
//     deriveTierFromInterval after being parsed into {interval,
//     intervalCount} by parseApplePeriod). `pending_renewal_info[].
//     is_in_billing_retry_period` ('1'/'0') feeds past_due detection via
//     mapAppleStatus.
//   - mapAppleStatus({ expiryMs, nowMs, cancellationDateMs,
//     isInBillingRetryPeriod }): a cancellation date present -> 'canceled';
//     else expiryMs in the future -> 'active' UNLESS isInBillingRetryPeriod
//     is true, in which case -> 'past_due'; else (expired) -> 'expired'.
//   - normalizeAppleTimestamp(epochMsString): `new
//     Date(Number(epochMsString)).toISOString()`.
//   - parseApplePeriod('P1M') -> { interval: 'month', intervalCount: 1 };
//     'P1Y' -> { interval: 'year', intervalCount: 1 }; 'P3M' ->
//     { interval: 'month', intervalCount: 3 } (an unrecognized-by-the-
//     interval-rule shape, exercising the product-map fallback downstream).
//   - Every outbound POST is wrapped in a timeout (deps.timeoutMs); a fetch
//     that never settles within budget throws
//     { code: 'provider_timeout', fault: 'provider' }.
//   - An empty/whitespace `original_transaction_id` (the
//     provider_subscription_id source) or a missing `expires_date_ms` on the
//     latest entry is a provider-contract violation
//     ({ code: 'provider_contract_violation', fault: 'provider' }).
//
// Red phase: ./apple.ts does not exist yet, so every test in this file fails
// at import resolution before a single assertion runs.

import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { ReceiptValidationError } from './types.ts'
import {
  APPLE_PRODUCTION_VERIFY_RECEIPT_URL,
  APPLE_SANDBOX_VERIFY_RECEIPT_URL,
  mapAppleStatus,
  normalizeAppleTimestamp,
  parseApplePeriod,
  validateAppleReceipt,
} from './apple.ts'

const SHARED_SECRET = 'apple-test-shared-secret'
const RECEIPT_DATA = 'dGVzdC1yZWNlaXB0LWRhdGE=' // base64 placeholder, no real receipt content
const TRANSACTION_ID = '1000000123456789'
const FUTURE_MS = String(Date.now() + 30 * 24 * 60 * 60 * 1000)

function appleEntry(overrides: Record<string, unknown> = {}) {
  return {
    original_transaction_id: TRANSACTION_ID,
    product_id: 'com.riverjournal.paid.monthly',
    expires_date_ms: FUTURE_MS,
    subscription_period: 'P1M',
    ...overrides,
  }
}

function fetchStub(
  responses: Array<{ url: string; body: unknown } | ((url: string) => unknown)>,
) {
  let call = 0
  const calls: string[] = []
  const fn = ((url: string) => {
    calls.push(url)
    const entry = responses[call]
    call++
    if (!entry) {
      throw new Error(`unexpected extra fetch call to "${url}"`)
    }
    const body = typeof entry === 'function' ? entry(url) : entry.body
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  }) as typeof fetch
  return { fn, calls }
}

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

Deno.test('APPLE_PRODUCTION_VERIFY_RECEIPT_URL and APPLE_SANDBOX_VERIFY_RECEIPT_URL are distinct Apple endpoints', () => {
  assertEquals(typeof APPLE_PRODUCTION_VERIFY_RECEIPT_URL, 'string')
  assertEquals(typeof APPLE_SANDBOX_VERIFY_RECEIPT_URL, 'string')
  assertEquals(APPLE_PRODUCTION_VERIFY_RECEIPT_URL === APPLE_SANDBOX_VERIFY_RECEIPT_URL, false)
})

Deno.test('normalizeAppleTimestamp converts an epoch-ms string to a UTC ISO-8601 string', () => {
  assertEquals(normalizeAppleTimestamp('1780000000000'), new Date(1_780_000_000_000).toISOString())
})

Deno.test('parseApplePeriod parses P1M to a monthly interval', () => {
  assertEquals(parseApplePeriod('P1M'), { interval: 'month', intervalCount: 1 })
})

Deno.test('parseApplePeriod parses P1Y to a yearly interval', () => {
  assertEquals(parseApplePeriod('P1Y'), { interval: 'year', intervalCount: 1 })
})

Deno.test('parseApplePeriod parses P3M to a 3-month interval (not a recognized-by-itself tier shape)', () => {
  assertEquals(parseApplePeriod('P3M'), { interval: 'month', intervalCount: 3 })
})

Deno.test('mapAppleStatus returns active for a non-expired entry with no cancellation and not in billing retry', () => {
  const status = mapAppleStatus({
    expiryMs: Date.now() + 100_000,
    nowMs: Date.now(),
    cancellationDateMs: null,
    isInBillingRetryPeriod: false,
  })
  assertEquals(status, 'active')
})

Deno.test('mapAppleStatus returns past_due for a non-expired entry currently in the billing retry period', () => {
  const status = mapAppleStatus({
    expiryMs: Date.now() + 100_000,
    nowMs: Date.now(),
    cancellationDateMs: null,
    isInBillingRetryPeriod: true,
  })
  assertEquals(status, 'past_due')
})

Deno.test('mapAppleStatus returns canceled when a cancellation date is present, regardless of expiry', () => {
  const status = mapAppleStatus({
    expiryMs: Date.now() + 100_000,
    nowMs: Date.now(),
    cancellationDateMs: Date.now() - 1_000,
    isInBillingRetryPeriod: false,
  })
  assertEquals(status, 'canceled')
})

Deno.test('mapAppleStatus returns expired for an entry past its expiry with no cancellation', () => {
  const status = mapAppleStatus({
    expiryMs: Date.now() - 100_000,
    nowMs: Date.now(),
    cancellationDateMs: null,
    isInBillingRetryPeriod: false,
  })
  assertEquals(status, 'expired')
})

// ---------------------------------------------------------------------------
// validateAppleReceipt -- shape validation, sandbox fallback, status/fault
// mapping, tier derivation, timeout.
// ---------------------------------------------------------------------------

Deno.test('validateAppleReceipt rejects a non-string, non-{receipt-data} raw_receipt with a client fault and never calls fetch', async () => {
  const { fn, calls } = fetchStub([])
  await assertRejects(
    () => validateAppleReceipt({ wrong: 'shape' }, { sharedSecret: SHARED_SECRET, fetchImpl: fn }),
    ReceiptValidationError,
  )
  assertEquals(calls.length, 0)
})

Deno.test('validateAppleReceipt rejects an empty receipt-data string with a client fault and never calls fetch', async () => {
  const { fn, calls } = fetchStub([])
  await assertRejects(
    () =>
      validateAppleReceipt({ 'receipt-data': '' }, { sharedSecret: SHARED_SECRET, fetchImpl: fn }),
    ReceiptValidationError,
  )
  assertEquals(calls.length, 0)
})

Deno.test('validateAppleReceipt accepts a bare base64 receipt string and POSTs to production first', async () => {
  const { fn, calls } = fetchStub([
    {
      url: APPLE_PRODUCTION_VERIFY_RECEIPT_URL,
      body: {
        status: 0,
        latest_receipt_info: [appleEntry()],
        pending_renewal_info: [{ is_in_billing_retry_period: '0' }],
      },
    },
  ])
  const result = await validateAppleReceipt(RECEIPT_DATA, {
    sharedSecret: SHARED_SECRET,
    fetchImpl: fn,
  })
  assertEquals(calls, [APPLE_PRODUCTION_VERIFY_RECEIPT_URL])
  assertEquals(result.provider_subscription_id, TRANSACTION_ID)
  assertEquals(result.status, 'active')
  assertEquals(result.tier, 'paid_monthly')
  // raw_metadata is the provider metadata JSON persisted to the
  // subscription_receipts.raw_receipt column -- never the caller's original
  // raw_receipt input.
  assertEquals(typeof result.raw_metadata, 'object')
})

Deno.test('validateAppleReceipt accepts a { "receipt-data": ... } object shape identically to the bare string', async () => {
  const { fn } = fetchStub([
    {
      url: APPLE_PRODUCTION_VERIFY_RECEIPT_URL,
      body: {
        status: 0,
        latest_receipt_info: [appleEntry()],
        pending_renewal_info: [{ is_in_billing_retry_period: '0' }],
      },
    },
  ])
  const result = await validateAppleReceipt(
    { 'receipt-data': RECEIPT_DATA },
    { sharedSecret: SHARED_SECRET, fetchImpl: fn },
  )
  assertEquals(result.provider_subscription_id, TRANSACTION_ID)
})

Deno.test('validateAppleReceipt retries against sandbox on a production 21007 response, and succeeds off the sandbox result', async () => {
  const { fn, calls } = fetchStub([
    { url: APPLE_PRODUCTION_VERIFY_RECEIPT_URL, body: { status: 21007 } },
    {
      url: APPLE_SANDBOX_VERIFY_RECEIPT_URL,
      body: {
        status: 0,
        latest_receipt_info: [appleEntry()],
        pending_renewal_info: [{ is_in_billing_retry_period: '0' }],
      },
    },
  ])
  const result = await validateAppleReceipt(RECEIPT_DATA, {
    sharedSecret: SHARED_SECRET,
    fetchImpl: fn,
  })
  assertEquals(calls, [APPLE_PRODUCTION_VERIFY_RECEIPT_URL, APPLE_SANDBOX_VERIFY_RECEIPT_URL])
  assertEquals(result.status, 'active')
})

Deno.test('validateAppleReceipt treats a terminal invalid status (21003) as a client fault, without retrying sandbox', async () => {
  const { fn, calls } = fetchStub([
    { url: APPLE_PRODUCTION_VERIFY_RECEIPT_URL, body: { status: 21003 } },
  ])
  const error = await assertRejects(
    () => validateAppleReceipt(RECEIPT_DATA, { sharedSecret: SHARED_SECRET, fetchImpl: fn }),
    ReceiptValidationError,
  )
  assertEquals(calls.length, 1)
  assertEquals((error as ReceiptValidationError).fault, 'client')
})

Deno.test('validateAppleReceipt treats status 21010 (also a terminal invalid/auth code) as a client fault', async () => {
  const { fn } = fetchStub([{ url: APPLE_PRODUCTION_VERIFY_RECEIPT_URL, body: { status: 21010 } }])
  const error = await assertRejects(
    () => validateAppleReceipt(RECEIPT_DATA, { sharedSecret: SHARED_SECRET, fetchImpl: fn }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).fault, 'client')
})

Deno.test('validateAppleReceipt treats status 21005 (Apple server unavailable) as a provider fault, not the caller’s fault', async () => {
  const { fn } = fetchStub([{ url: APPLE_PRODUCTION_VERIFY_RECEIPT_URL, body: { status: 21005 } }])
  const error = await assertRejects(
    () => validateAppleReceipt(RECEIPT_DATA, { sharedSecret: SHARED_SECRET, fetchImpl: fn }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})

Deno.test('validateAppleReceipt selects the entry with the greatest expires_date_ms among multiple latest_receipt_info entries', async () => {
  const older = appleEntry({
    original_transaction_id: 'older-tx',
    expires_date_ms: String(Date.now() + 1_000),
  })
  const newer = appleEntry({
    original_transaction_id: 'newer-tx',
    expires_date_ms: String(Date.now() + 999_000),
  })
  const { fn } = fetchStub([
    {
      url: APPLE_PRODUCTION_VERIFY_RECEIPT_URL,
      body: {
        status: 0,
        latest_receipt_info: [older, newer],
        pending_renewal_info: [{ is_in_billing_retry_period: '0' }],
      },
    },
  ])
  const result = await validateAppleReceipt(RECEIPT_DATA, {
    sharedSecret: SHARED_SECRET,
    fetchImpl: fn,
  })
  assertEquals(result.provider_subscription_id, 'newer-tx')
})

Deno.test('validateAppleReceipt derives tier via the product map when the subscription_period is not one of the two recognized shapes', async () => {
  const entry = appleEntry({
    product_id: 'com.riverjournal.paid.quarterly',
    subscription_period: 'P3M',
  })
  const { fn } = fetchStub([
    {
      url: APPLE_PRODUCTION_VERIFY_RECEIPT_URL,
      body: {
        status: 0,
        latest_receipt_info: [entry],
        pending_renewal_info: [{ is_in_billing_retry_period: '0' }],
      },
    },
  ])
  const result = await validateAppleReceipt(RECEIPT_DATA, {
    sharedSecret: SHARED_SECRET,
    fetchImpl: fn,
    productTierMap: { 'com.riverjournal.paid.quarterly': 'paid_yearly' },
  })
  assertEquals(result.tier, 'paid_yearly')
})

Deno.test('validateAppleReceipt rejects with tier_unresolvable when the period is unrecognized and unmapped', async () => {
  const entry = appleEntry({ product_id: 'com.riverjournal.mystery', subscription_period: 'P3M' })
  const { fn } = fetchStub([
    {
      url: APPLE_PRODUCTION_VERIFY_RECEIPT_URL,
      body: {
        status: 0,
        latest_receipt_info: [entry],
        pending_renewal_info: [{ is_in_billing_retry_period: '0' }],
      },
    },
  ])
  const error = await assertRejects(
    () =>
      validateAppleReceipt(RECEIPT_DATA, {
        sharedSecret: SHARED_SECRET,
        fetchImpl: fn,
        productTierMap: {},
      }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'tier_unresolvable')
})

Deno.test('validateAppleReceipt treats an empty original_transaction_id as a provider-contract violation', async () => {
  const entry = appleEntry({ original_transaction_id: '' })
  const { fn } = fetchStub([
    {
      url: APPLE_PRODUCTION_VERIFY_RECEIPT_URL,
      body: {
        status: 0,
        latest_receipt_info: [entry],
        pending_renewal_info: [{ is_in_billing_retry_period: '0' }],
      },
    },
  ])
  const error = await assertRejects(
    () => validateAppleReceipt(RECEIPT_DATA, { sharedSecret: SHARED_SECRET, fetchImpl: fn }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).code, 'provider_contract_violation')
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})

Deno.test('validateAppleReceipt maps a fetch that never settles within the timeout budget to a provider-fault timeout error', async () => {
  const hangingFetch = (() => new Promise<Response>(() => {})) as typeof fetch
  const error = await assertRejects(
    () =>
      validateAppleReceipt(RECEIPT_DATA, {
        sharedSecret: SHARED_SECRET,
        fetchImpl: hangingFetch,
        timeoutMs: 15,
      }),
    ReceiptValidationError,
  )
  assertEquals((error as ReceiptValidationError).fault, 'provider')
})

Deno.test('validateAppleReceipt sends the shared secret as the password field, never inside a logged/echoed URL', async () => {
  let capturedBody: Record<string, unknown> | null = null
  const fn = ((_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string)
    return Promise.resolve(
      new Response(
        JSON.stringify({
          status: 0,
          latest_receipt_info: [appleEntry()],
          pending_renewal_info: [{ is_in_billing_retry_period: '0' }],
        }),
        { status: 200 },
      ),
    )
  }) as typeof fetch
  await validateAppleReceipt(RECEIPT_DATA, { sharedSecret: SHARED_SECRET, fetchImpl: fn })
  assertEquals((capturedBody as unknown as { password: string }).password, SHARED_SECRET)
})
