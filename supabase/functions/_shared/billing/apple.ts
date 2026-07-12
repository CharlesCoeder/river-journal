// Apple App Store receipt validator.
//
// Validates against Apple's verifyReceipt endpoint with the mandatory
// sandbox-then-production fallback: POST the PRODUCTION url first, and on an
// HTTP-200 body carrying status 21007 (a sandbox receipt sent to production)
// retry the SAME payload against the SANDBOX url. Any other non-zero status is
// terminal — never retried against sandbox.
//
// SSRF invariant: both endpoints are hardcoded module constants — NEVER derived
// from the caller's raw_receipt (which supplies only the opaque base64 receipt).
// The APPLE_SHARED_SECRET is sent as the `password` body field, never placed in
// a URL that could be logged/echoed.

import {
  assertNonEmptyProviderId,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  deriveTierFromInterval,
  parseIso8601Period,
  ReceiptValidationError,
  type ReceiptValidationResult,
  type SubscriptionStatus,
  type SubscriptionTier,
  withTimeout,
} from './types.ts'

export const APPLE_PRODUCTION_VERIFY_RECEIPT_URL: string =
  'https://buy.itunes.apple.com/verifyReceipt'
export const APPLE_SANDBOX_VERIFY_RECEIPT_URL: string =
  'https://sandbox.itunes.apple.com/verifyReceipt'

// Apple's "sandbox receipt sent to production" signal — the ONLY status that
// triggers the sandbox retry.
const APPLE_STATUS_SANDBOX_REQUIRED = 21007
// Apple's "server temporarily unavailable" — OUR-side / transient, a provider
// fault (5xx-worthy), not the caller's receipt being bad.
const APPLE_STATUS_SERVER_UNAVAILABLE = 21005

export interface AppleDeps {
  sharedSecret: string
  fetchImpl?: typeof fetch
  productTierMap?: Record<string, SubscriptionTier>
  timeoutMs?: number
}

interface AppleEntry {
  original_transaction_id?: string
  product_id?: string
  expires_date_ms?: string
  cancellation_date_ms?: string
  subscription_period?: string
}

// Derived-state -> the 5-value receipt enum. A present cancellation date wins
// (canceled) regardless of expiry; otherwise a future expiry is active unless the
// subscription is in the billing-retry (grace) period, which is past_due; a past
// expiry with no cancellation is expired.
export function mapAppleStatus(input: {
  expiryMs: number
  nowMs: number
  cancellationDateMs: number | null
  isInBillingRetryPeriod: boolean
}): SubscriptionStatus {
  if (input.cancellationDateMs !== null) {
    return 'canceled'
  }
  if (input.expiryMs > input.nowMs) {
    return input.isInBillingRetryPeriod ? 'past_due' : 'active'
  }
  return 'expired'
}

// Apple reports timestamps as epoch-MILLISECOND strings — normalize to UTC ISO.
export function normalizeAppleTimestamp(epochMsString: string): string {
  return new Date(Number(epochMsString)).toISOString()
}

// Parse an ISO-8601 subscription period (e.g. 'P1M', 'P1Y', 'P3M') into the
// {interval, intervalCount} shape deriveTierFromInterval consumes.
export function parseApplePeriod(period: string): { interval: string; intervalCount: number } {
  return parseIso8601Period(period)
}

export async function validateAppleReceipt(
  rawReceipt: unknown,
  deps: AppleDeps,
): Promise<ReceiptValidationResult> {
  const receiptData = extractReceiptData(rawReceipt)
  const fetchImpl = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS
  const productTierMap = deps.productTierMap ?? {}

  const payload = { 'receipt-data': receiptData, password: deps.sharedSecret }

  let body = await postVerify(fetchImpl, APPLE_PRODUCTION_VERIFY_RECEIPT_URL, payload, timeoutMs)
  if (body.status === APPLE_STATUS_SANDBOX_REQUIRED) {
    body = await postVerify(fetchImpl, APPLE_SANDBOX_VERIFY_RECEIPT_URL, payload, timeoutMs)
  }

  if (body.status !== 0) {
    if (body.status === APPLE_STATUS_SERVER_UNAVAILABLE) {
      throw new ReceiptValidationError('apple verification service is unavailable', {
        code: 'provider_unavailable',
        fault: 'provider',
      })
    }
    // Every other non-zero, non-21007 status is a rejected/malformed receipt —
    // the caller must fix it (client fault).
    throw new ReceiptValidationError('apple rejected the receipt', {
      code: 'receipt_invalid',
      fault: 'client',
    })
  }

  const entries = Array.isArray(body.latest_receipt_info) ? body.latest_receipt_info : []
  const latest = pickLatestEntry(entries)
  if (!latest) {
    throw new ReceiptValidationError('apple receipt has no subscription entries', {
      code: 'provider_contract_violation',
      fault: 'provider',
      status: 502,
    })
  }

  const providerSubscriptionId = assertNonEmptyProviderId(latest.original_transaction_id)

  if (typeof latest.expires_date_ms !== 'string' || latest.expires_date_ms.trim() === '') {
    throw new ReceiptValidationError('apple entry is missing an expiry', {
      code: 'provider_contract_violation',
      fault: 'provider',
      status: 502,
    })
  }

  const { interval, intervalCount } = parseApplePeriod(String(latest.subscription_period ?? ''))
  const tier = deriveTierFromInterval(
    interval,
    intervalCount,
    latest.product_id ?? null,
    productTierMap,
  )

  const isInBillingRetryPeriod = readBillingRetry(body.pending_renewal_info)
  const cancellationDateMs = typeof latest.cancellation_date_ms === 'string'
    ? Number(latest.cancellation_date_ms)
    : null
  const status = mapAppleStatus({
    expiryMs: Number(latest.expires_date_ms),
    nowMs: Date.now(),
    cancellationDateMs,
    isInBillingRetryPeriod,
  })

  return {
    provider_subscription_id: providerSubscriptionId,
    status,
    current_period_end: normalizeAppleTimestamp(latest.expires_date_ms),
    tier,
    bound_user_id: null,
    raw_metadata: {
      provider: 'apple_iap',
      original_transaction_id: providerSubscriptionId,
      product_id: latest.product_id,
      provider_status: body.status,
    },
  }
}

// Accept a non-empty base64 string or a `{ 'receipt-data': string }` object.
function extractReceiptData(rawReceipt: unknown): string {
  if (typeof rawReceipt === 'string' && rawReceipt.trim() !== '') {
    return rawReceipt
  }
  if (
    rawReceipt !== null &&
    typeof rawReceipt === 'object' &&
    typeof (rawReceipt as { 'receipt-data'?: unknown })['receipt-data'] === 'string' &&
    (rawReceipt as { 'receipt-data': string })['receipt-data'].trim() !== ''
  ) {
    return (rawReceipt as { 'receipt-data': string })['receipt-data']
  }
  throw new ReceiptValidationError('apple receipt must be a base64 string or { receipt-data }', {
    code: 'invalid_receipt_shape',
    fault: 'client',
  })
}

interface AppleVerifyBody {
  status: number
  latest_receipt_info?: AppleEntry[]
  pending_renewal_info?: Array<{ is_in_billing_retry_period?: string }>
}

async function postVerify(
  fetchImpl: typeof fetch,
  url: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<AppleVerifyBody> {
  const response = await withTimeout(
    (signal) =>
      fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      }),
    timeoutMs,
  )
  return (await response.json()) as AppleVerifyBody
}

// The authoritative entry is the one with the greatest expires_date_ms.
function pickLatestEntry(entries: AppleEntry[]): AppleEntry | null {
  let latest: AppleEntry | null = null
  let latestMs = -Infinity
  for (const entry of entries) {
    const ms = Number(entry.expires_date_ms ?? NaN)
    if (!Number.isNaN(ms) && ms >= latestMs) {
      latestMs = ms
      latest = entry
    }
  }
  return latest ?? (entries.length > 0 ? entries[entries.length - 1]! : null)
}

function readBillingRetry(
  pending: Array<{ is_in_billing_retry_period?: string }> | undefined,
): boolean {
  if (!Array.isArray(pending)) {
    return false
  }
  return pending.some((p) => p.is_in_billing_retry_period === '1')
}
