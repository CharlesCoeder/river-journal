// Shared billing-validation contract: the normalized result every provider
// validator resolves to, the typed failure carrying a client-vs-provider fault
// discriminator, and the provider-agnostic tier deriver.
//
// This module is the single source of truth the three provider validators
// (stripe.ts / apple.ts / google.ts) and the subscription_validate_receipt
// handler all import, so the edge and each provider stay in lockstep.
//
// PCI / NFR13 invariant: `raw_metadata` (persisted to
// subscription_receipts.raw_receipt) holds provider-issued identifiers and
// metadata only — NEVER card numbers, CVVs, or full PAN data. Provider receipts
// do not carry these; nothing here ever echoes card data into a response or log.

// The two paid tiers the server may derive. Free is never derived here — a
// successful validation is always a paid entitlement.
export type SubscriptionTier = 'paid_monthly' | 'paid_yearly'

// The 5-value receipt-status enum (mirrors subscription_receipts.status).
export type SubscriptionStatus = 'active' | 'pending' | 'canceled' | 'past_due' | 'expired'

// Which side is at fault for a validation failure — the discriminator the
// handler maps to 4xx (client / bad receipt) vs 5xx (provider unreachable,
// timeout, or our own misconfiguration) without re-deriving it.
export type ValidationFault = 'client' | 'provider'

// The normalized shape every provider validator returns on success.
export interface ReceiptValidationResult {
  // Non-empty after btrim — the natural key half written to
  // subscription_receipts.provider_subscription_id.
  provider_subscription_id: string
  status: SubscriptionStatus
  // UTC ISO-8601 — providers report period-end in incompatible shapes (Stripe
  // Unix seconds, Apple/Google epoch ms / RFC-3339); each validator normalizes
  // BEFORE returning so the TIMESTAMPTZ write never sees a provider-native shape.
  current_period_end: string
  tier: SubscriptionTier
  // A provider-side ownership signal (e.g. Stripe Checkout client_reference_id /
  // metadata.user_id) when the payload surfaces one, else null. The handler
  // fails closed on a present-but-mismatched value (anti-hijack, deeper defense).
  bound_user_id: string | null
  // The provider's own validated payload/metadata — the value persisted into
  // subscription_receipts.raw_receipt (never the caller's original raw input).
  raw_metadata: Record<string, unknown>
}

// Options for a typed validation failure. `status` overrides the fault-based
// default (e.g. 502 for a provider-contract violation, which is a `provider`
// fault but must be 502 rather than the generic 5xx default).
export interface ValidationErrorOptions {
  code: string
  fault: ValidationFault
  status?: number
}

// The typed failure every validator throws. `name` is fixed to
// 'ReceiptValidationError' so a caller can distinguish it from an unexpected /
// unhandled throw (which the handler maps to a fail-closed 500). The message is
// always safe to surface — it never carries receipt content or provider PII.
export class ReceiptValidationError extends Error {
  readonly code: string
  readonly fault: ValidationFault
  readonly status?: number

  constructor(message: string, options: ValidationErrorOptions) {
    super(message)
    this.name = 'ReceiptValidationError'
    this.code = options.code
    this.fault = options.fault
    this.status = options.status
  }
}

// Interval-first tier derivation, product-id map as fallback, never a silent
// default to a paid tier.
//
// Recognizes ONLY the two exact shapes (month, 1) -> paid_monthly and
// (year, 1) -> paid_yearly directly — the map may never override these (a
// directly-recognized interval is authoritative). Any other interval/count
// (week/day, (month, 3), (month, 12), ...) falls through to
// productTierMap[productId] when productId is non-null and present in the map.
// An interval/plan neither rule resolves throws a ReceiptValidationError with
// code 'tier_unresolvable' and fault 'client' — a wrong default would grant a
// paid entitlement the user did not buy.
export function deriveTierFromInterval(
  interval: string,
  intervalCount: number,
  productId: string | null,
  productTierMap: Record<string, SubscriptionTier>,
): SubscriptionTier {
  if (interval === 'month' && intervalCount === 1) {
    return 'paid_monthly'
  }
  if (interval === 'year' && intervalCount === 1) {
    return 'paid_yearly'
  }
  if (productId !== null && Object.prototype.hasOwnProperty.call(productTierMap, productId)) {
    return productTierMap[productId]!
  }
  throw new ReceiptValidationError('subscription plan could not be resolved to a tier', {
    code: 'tier_unresolvable',
    fault: 'client',
  })
}

// Assert a provider-returned subscription id is non-empty after btrim BEFORE the
// DB write — the subscription_receipts `btrim(...) <> ''` CHECK would otherwise 500 us. An
// empty/whitespace id is a provider-contract violation (502-worthy), not the
// caller's fault.
export function assertNonEmptyProviderId(id: unknown): string {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new ReceiptValidationError('provider returned an empty subscription id', {
      code: 'provider_contract_violation',
      fault: 'provider',
      status: 502,
    })
  }
  return id
}

// Run a promise against a fixed timeout budget. Deno `fetch` and the Stripe SDK
// have no default timeout, so an unreachable provider would hang to the platform
// limit. A fired timeout throws a provider-fault ReceiptValidationError rather
// than ever hanging. `signal` (when supplied) is aborted on timeout so the
// underlying request is torn down.
export async function withTimeout<T>(
  op: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController()
  let timer: number | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(
        new ReceiptValidationError('provider request timed out', {
          code: 'provider_timeout',
          fault: 'provider',
        }),
      )
    }, timeoutMs) as unknown as number
  })
  try {
    return await Promise.race([op(controller.signal), timeout])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

// A small fixed budget for every outbound provider call.
export const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000

// Parse an ISO-8601 subscription-period duration (e.g. 'P1M', 'P1Y', 'P3M')
// into the {interval, intervalCount} shape deriveTierFromInterval consumes.
// Apple and Google both report their billing period in this shape. An
// unparseable value resolves to an unrecognized interval (count 0) so the caller
// falls through to the product-id map (and ultimately tier_unresolvable).
export function parseIso8601Period(period: string): { interval: string; intervalCount: number } {
  const match = /^P(\d+)([YMWD])$/.exec(period)
  if (!match) {
    return { interval: 'unknown', intervalCount: 0 }
  }
  const count = Number(match[1])
  const unit = match[2]
  const interval = unit === 'Y' ? 'year' : unit === 'M' ? 'month' : unit === 'W' ? 'week' : 'day'
  return { interval, intervalCount: count }
}
