// Stripe receipt validator.
//
// For THIS function — an authenticated user's client POST of a Checkout result —
// the operative action is an authenticated SDK RETRIEVE of the Subscription's
// current state (status, current_period_end, price.recurring.{interval,
// interval_count}). Webhook signature verification belongs to the SEPARATE
// customer.subscription.deleted webhook (a later follow-up) that flips tier ->
// free at period end, NOT to this validate path. No webhook signature verifier is
// built here.
//
// SSRF invariant: the provider is reached ONLY via the injected Stripe SDK
// client; no provider URL/endpoint is ever derived from the caller's raw_receipt.
// The raw_receipt supplies ONLY an opaque id (sub_... or cs_...).
//
// First-claim exposure: the subscription/session id is client-supplied and the
// retrieve succeeds regardless of who owns it upstream, so the Stripe path is the
// most exposed to first-claim hijack — which is why the handler's owner-scoped
// write plus a future Checkout-creation binding (client_reference_id /
// metadata.user_id, surfaced here as bound_user_id) matter most for this provider.

import { createHmac } from 'node:crypto'
import { constantTimeEquals } from '../auth.ts'
import {
  assertNonEmptyProviderId,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  deriveTierFromInterval,
  ReceiptValidationError,
  type ReceiptValidationResult,
  type SubscriptionStatus,
  type SubscriptionTier,
  withTimeout,
} from './types.ts'

// The minimal Stripe client surface this validator touches — narrowed so tests
// inject a stub and production injects a thin fetch adapter over the Stripe API
// (built from STRIPE_SECRET_KEY in the handler), without vendoring the SDK.
//
// Every seam method takes an OPTIONAL trailing AbortSignal so withTimeout's
// signal is threaded through to the underlying fetch — an in-flight provider
// request is actually torn down on a fired timeout, not just abandoned. The
// mutation method `subscriptions.update` powers the cancel-at-period-end path.
export interface StripeClientSeam {
  subscriptions: {
    retrieve(id: string, signal?: AbortSignal): Promise<unknown>
    update(id: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  }
  checkout: { sessions: { retrieve(id: string, signal?: AbortSignal): Promise<unknown> } }
}

export interface StripeDeps {
  stripeClient: StripeClientSeam
  productTierMap?: Record<string, SubscriptionTier>
  timeoutMs?: number
}

// Stripe subscription.status -> the 5-value receipt enum. An unrecognized status
// is a provider-contract violation (fault 'provider') — Stripe returning an
// undocumented status means OUR integration is out of date with Stripe's API,
// not the caller's receipt being bad.
export function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active'
    case 'past_due':
      return 'past_due'
    case 'canceled':
      return 'canceled'
    case 'unpaid':
    case 'incomplete_expired':
      return 'expired'
    case 'incomplete':
      return 'pending'
    default:
      throw new ReceiptValidationError('unrecognized Stripe subscription status', {
        code: 'provider_contract_violation',
        fault: 'provider',
        status: 502,
      })
  }
}

// Stripe reports current_period_end as Unix SECONDS — normalize to UTC ISO-8601.
export function normalizeStripeTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString()
}

// Normalize a Unix-seconds period end, remapping a normalization RangeError
// (an out-of-range/unparseable value) to a provider-contract violation (502)
// rather than letting it surface as a generic 500. Shared by the validate,
// cancel, and webhook-refresh paths so all three honor the same fault split on a
// malformed provider timestamp.
function normalizePeriodEndOr502(unixSeconds: number): string {
  try {
    return normalizeStripeTimestamp(unixSeconds)
  } catch {
    throw new ReceiptValidationError('provider returned an unparseable period end', {
      code: 'provider_contract_violation',
      fault: 'provider',
      status: 502,
    })
  }
}

interface StripeSubscription {
  id: unknown
  status: unknown
  // Pre-Basil (Stripe API < 2025-03-31.basil) reports period end at the
  // subscription top level; Basil+ moves it under each line item
  // (items.data[].current_period_end). Both are read (item-level first).
  current_period_end?: unknown
  items: {
    data: Array<{
      current_period_end?: unknown
      price: { id?: string; recurring?: { interval?: string; interval_count?: number } }
    }>
  }
  // client_reference_id is NOT a Subscription field — it lives on the Checkout
  // Session (see StripeSession). The only binding signal a bare Subscription
  // carries is metadata.user_id.
  metadata?: Record<string, unknown> | null
}

interface StripeSession {
  id: unknown
  payment_status: unknown
  mode: unknown
  subscription: unknown
  // The primary provider-account binding signal. client_reference_id is a
  // Checkout Session field (the purchase client sets it to the caller's uid at
  // session creation); metadata.user_id is the fallback.
  client_reference_id?: string | null
  metadata?: Record<string, unknown> | null
}

// Retrieve a subscription (or resolve a Checkout session to its subscription),
// map its state, derive its tier, and normalize its period end. Every SDK call
// is wrapped in a timeout so an unreachable Stripe hangs into a provider-fault
// error rather than the platform limit.
export async function validateStripeReceipt(
  rawReceipt: unknown,
  deps: StripeDeps,
): Promise<ReceiptValidationResult> {
  if (typeof rawReceipt !== 'string' || rawReceipt.trim() === '') {
    throw new ReceiptValidationError('stripe receipt must be a non-empty id string', {
      code: 'invalid_receipt_shape',
      fault: 'client',
    })
  }
  const id = rawReceipt.trim()
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS
  const productTierMap = deps.productTierMap ?? {}

  let subscriptionId = id
  // The Checkout Session's client_reference_id / metadata.user_id is the primary
  // provider-account binding signal, so it is captured on the cs_ path and
  // preferred over the subscription's own metadata below.
  let sessionBoundUserId: string | null = null
  // A Checkout session id must be resolved to its linked subscription first, and
  // sanity-checked (payment_status complete/paid, mode subscription) before the
  // linked subscription is trusted.
  if (id.startsWith('cs_')) {
    const session = await retrieveSession(deps.stripeClient, id, timeoutMs)
    const paymentOk = session.payment_status === 'paid' || session.payment_status === 'complete'
    if (!paymentOk || session.mode !== 'subscription') {
      throw new ReceiptValidationError(
        'checkout session is not a completed subscription purchase',
        {
          code: 'session_incomplete',
          fault: 'client',
        },
      )
    }
    if (typeof session.subscription !== 'string' || session.subscription.trim() === '') {
      throw new ReceiptValidationError('checkout session has no linked subscription', {
        code: 'session_incomplete',
        fault: 'client',
      })
    }
    subscriptionId = session.subscription
    sessionBoundUserId = resolveSessionBoundUserId(session)
  }

  const subscription = await retrieveSubscription(deps.stripeClient, subscriptionId, timeoutMs)

  const providerSubscriptionId = assertNonEmptyProviderId(subscription.id)

  const currentPeriodEnd = resolveCurrentPeriodEnd(subscription)

  const status = mapStripeStatus(String(subscription.status))
  const priceItem = subscription.items?.data?.[0]?.price
  const recurring = priceItem?.recurring
  const tier = deriveTierFromInterval(
    String(recurring?.interval ?? ''),
    Number(recurring?.interval_count ?? 0),
    priceItem?.id ?? null,
    productTierMap,
  )

  const boundUserId = sessionBoundUserId ?? resolveSubscriptionBoundUserId(subscription)

  // A missing period end already threw provider_contract_violation (502) inside
  // resolveCurrentPeriodEnd; a numerically-out-of-range value that throws on
  // normalization (RangeError) is likewise a provider-contract violation, not a
  // generic 500 (carry-in hardening: honor the fault split on a malformed ts,
  // matching the cancel/refresh paths that share this same normalization call).
  const currentPeriodEndIso = normalizePeriodEndOr502(currentPeriodEnd)

  return {
    provider_subscription_id: providerSubscriptionId,
    status,
    current_period_end: currentPeriodEndIso,
    tier,
    bound_user_id: boundUserId,
    raw_metadata: {
      provider: 'stripe',
      subscription_id: providerSubscriptionId,
      status: subscription.status,
    },
  }
}

// Stripe API 2025-03-31.basil+ (the default for accounts provisioned in 2025+)
// reports current_period_end per line item (items.data[].current_period_end)
// and no longer at the subscription top level. Read the item-level value first
// and fall back to the top-level value for pre-Basil accounts; an active
// subscription with neither is a provider-contract violation.
function resolveCurrentPeriodEnd(subscription: StripeSubscription): number {
  const itemLevel = subscription.items?.data?.[0]?.current_period_end
  const candidate = typeof itemLevel === 'number' ? itemLevel : subscription.current_period_end
  if (typeof candidate !== 'number') {
    throw new ReceiptValidationError('subscription is missing a current_period_end', {
      code: 'provider_contract_violation',
      fault: 'provider',
      status: 502,
    })
  }
  return candidate
}

// client_reference_id is a Checkout SESSION field (never a Subscription field),
// so it is the primary binding signal only on the cs_ path. The purchase client
// (the Checkout-session-creation path) MUST set client_reference_id — or
// metadata.user_id — to the caller's uid at session creation, since that is
// exactly where this function reads the binding.
function resolveSessionBoundUserId(session: StripeSession): string | null {
  if (typeof session.client_reference_id === 'string' && session.client_reference_id !== '') {
    return session.client_reference_id
  }
  return metadataUserId(session.metadata)
}

// A bare Subscription carries no client_reference_id, so metadata.user_id is the
// only binding signal available on the sub_ path.
function resolveSubscriptionBoundUserId(subscription: StripeSubscription): string | null {
  return metadataUserId(subscription.metadata)
}

function metadataUserId(metadata: Record<string, unknown> | null | undefined): string | null {
  const userId = metadata?.user_id
  return typeof userId === 'string' && userId !== '' ? userId : null
}

async function retrieveSubscription(
  client: StripeClientSeam,
  id: string,
  timeoutMs: number,
): Promise<StripeSubscription> {
  try {
    return (await withTimeout(
      (signal) => Promise.resolve(client.subscriptions.retrieve(id, signal)),
      timeoutMs,
    )) as StripeSubscription
  } catch (error) {
    rethrowStripeError(error)
  }
}

async function retrieveSession(
  client: StripeClientSeam,
  id: string,
  timeoutMs: number,
): Promise<StripeSession> {
  try {
    return (await withTimeout(
      (signal) => Promise.resolve(client.checkout.sessions.retrieve(id, signal)),
      timeoutMs,
    )) as StripeSession
  } catch (error) {
    rethrowStripeError(error)
  }
}

// Cancel-at-period-end (NOT immediate cancel — paid access must continue until
// current_period_end so the user keeps what they paid for). Calls subscriptions.update(id,
// { cancel_at_period_end: true }) via the injected seam, wrapped in withTimeout
// so an unreachable Stripe aborts into a provider-fault timeout rather than
// hanging. The updated subscription's period end is re-read with the same
// item-level-first / top-level-fallback resolution as the validate path.
//
// Idempotent: re-issuing cancel_at_period_end=true on an already-scheduled
// subscription is Stripe's own no-op, resolving normally — no special-case here.
//
// Fault mapping: a rejection carrying `status === 404` is a local↔Stripe desync
// (our receipt says the caller owns it; Stripe says it is gone) → a CLIENT-fault
// provider_resource_missing (the handler collapses this into the generic 404,
// never a 5xx alarm). Any other rejection (Stripe 5xx / 429 / network) is a
// PROVIDER-fault provider_cancel_failed. A ReceiptValidationError thrown by the
// seam itself (e.g. a fired timeout) passes through untouched. A missing or
// unparseable period end on the response is a provider-contract violation (502).
export async function cancelStripeSubscriptionAtPeriodEnd(
  id: string,
  deps: { stripeClient: StripeClientSeam; timeoutMs?: number },
): Promise<{ current_period_end: string }> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS
  let subscription: StripeSubscription
  try {
    subscription = (await withTimeout(
      (signal) =>
        Promise.resolve(
          deps.stripeClient.subscriptions.update(id, { cancel_at_period_end: true }, signal),
        ),
      timeoutMs,
    )) as StripeSubscription
  } catch (error) {
    if (error instanceof ReceiptValidationError) {
      throw error
    }
    const status = (error as { status?: unknown } | null)?.status
    if (status === 404) {
      throw new ReceiptValidationError('stripe reports no matching subscription to cancel', {
        code: 'provider_resource_missing',
        fault: 'client',
        status: 404,
      })
    }
    throw new ReceiptValidationError('stripe could not cancel the subscription', {
      code: 'provider_cancel_failed',
      fault: 'provider',
    })
  }

  // A missing period end throws provider_contract_violation (502) inside
  // resolveCurrentPeriodEnd; a numerically-out-of-range value that throws on
  // normalization (RangeError) is likewise a provider-contract violation, not a
  // generic 500 (carry-in hardening: honor the fault split on a malformed ts).
  const currentPeriodEnd = resolveCurrentPeriodEnd(subscription)
  return { current_period_end: normalizePeriodEndOr502(currentPeriodEnd) }
}

// A ReceiptValidationError (timeout, contract violation) passes through
// untouched. Any other SDK rejection is treated as a client fault — the caller's
// id does not correspond to a retrievable Stripe resource (not-found / bad id).
function rethrowStripeError(error: unknown): never {
  if (error instanceof ReceiptValidationError) {
    throw error
  }
  throw new ReceiptValidationError('stripe could not resolve the receipt', {
    code: 'receipt_not_found',
    fault: 'client',
  })
}

// Verify a Stripe webhook's `Stripe-Signature` header against the raw request
// body — the SOLE authentication for the public (verify_jwt = false)
// billing_events webhook, since it carries no user JWT and no service-role
// bearer. The scheme (Stripe's own): the header is `t=<unix>,v1=<hex>[,v1=...]`;
// the signed payload is the exact string `${t}.${rawBody}`; the digest is
// HMAC-SHA256 keyed by the endpoint's `whsec_…` secret; a signature verifies if
// ANY delivered `v1` matches within a timestamp tolerance window (default 300 s,
// Stripe's recommended default) that bounds replay.
//
// The raw body is HMAC'd UNMODIFIED — the caller reads it once with req.text()
// and passes that exact string here, never a re-serialized variant
// (JSON.stringify(JSON.parse(body)) would reorder keys / drop whitespace and
// reject every real event). On success this returns JSON.parse(rawBody) — the
// SAME string that was verified.
//
// EVERY failure (missing/malformed header, missing t or all v1, a bad timestamp,
// no matching v1, wrong secret) throws ONE error shape —
// ReceiptValidationError { code: 'webhook_signature_invalid', fault: 'client' }
// — so the handler's fail-closed generic-400 mapping is uniform and leaks
// nothing about which check failed. The v1 compare is length-gated + constant
// time (the shared constantTimeEquals), so a wrong-length v1 leaks only "wrong
// length", never content timing, and never throws on a length mismatch.
export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  opts: { toleranceSeconds?: number; nowMs?: number } = {},
): unknown {
  const toleranceSeconds = opts.toleranceSeconds ?? 300
  const nowMs = opts.nowMs ?? Date.now()

  const fail = (): never => {
    throw new ReceiptValidationError('stripe webhook signature verification failed', {
      code: 'webhook_signature_invalid',
      fault: 'client',
    })
  }

  // Defense in depth: an empty/whitespace secret keys the HMAC to a known constant,
  // so any caller could forge a matching v1 and bypass authentication. The handler
  // already fails closed on an unset STRIPE_WEBHOOK_SECRET before reaching here, but
  // a future caller that forgets that check must not open a forgeable-HMAC hole —
  // reject INSIDE the verifier with the same no-detail signature failure.
  if (typeof secret !== 'string' || secret.trim() === '') {
    return fail()
  }

  if (typeof signatureHeader !== 'string' || signatureHeader.trim() === '') {
    return fail()
  }

  let timestamp: string | null = null
  const v1Values: string[] = []
  for (const part of signatureHeader.split(',')) {
    const eq = part.indexOf('=')
    if (eq === -1) {
      continue
    }
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key === 't') {
      timestamp = value
    } else if (key === 'v1') {
      v1Values.push(value)
    }
  }

  if (timestamp === null || timestamp === '' || v1Values.length === 0) {
    return fail()
  }
  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds)) {
    return fail()
  }
  if (Math.abs(nowMs - timestampSeconds * 1000) > toleranceSeconds * 1000) {
    return fail()
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  const matches = v1Values.some((candidate) => constantTimeEquals(expected, candidate))
  if (!matches) {
    return fail()
  }

  return JSON.parse(rawBody)
}

// Retrieve a Subscription's LIVE authoritative state fresh by id and normalize it
// for a freshness refresh — the webhook path's read. It ALWAYS retrieves by id
// (never accepts a pre-fetched object and never trusts the delivered event
// snapshot), so a redelivered OR out-of-order-older webhook still writes Stripe's
// current truth: the stored current_period_end only ever moves forward for a
// renewing subscription and can never regress into the daily expiry sweep's
// window. Reuses the exact period-end resolution (item-level first, top-level
// fallback), status mapping, and timestamp normalization as validateStripeReceipt.
//
// Unlike validateStripeReceipt it does NOT hard-throw on an underivable plan: a
// tier_unresolvable is caught and returned as tier: null so a freshness refresh
// of status/current_period_end is never wedged by a plan whose interval maps to
// no tier (the handler then simply skips the tier update). A malformed/
// out-of-range period end still maps to the same provider-contract 502 as the
// validate/cancel paths (never an uncaught RangeError).
export async function refreshStripeSubscriptionState(
  subscriptionId: string,
  deps: StripeDeps,
): Promise<{
  provider_subscription_id: string
  status: SubscriptionStatus
  current_period_end: string
  tier: SubscriptionTier | null
}> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS
  const productTierMap = deps.productTierMap ?? {}

  let subscription: StripeSubscription
  try {
    subscription = (await withTimeout(
      (signal) => Promise.resolve(deps.stripeClient.subscriptions.retrieve(subscriptionId, signal)),
      timeoutMs,
    )) as StripeSubscription
  } catch (error) {
    // A fired timeout (provider_timeout) or any other ReceiptValidationError
    // passes through untouched. Any other rejection (Stripe 5xx / 429 / network)
    // is a PROVIDER fault so the handler returns a 5xx and Stripe redelivers —
    // the refresh is idempotent AND out-of-order-safe, so redelivery is safe.
    if (error instanceof ReceiptValidationError) {
      throw error
    }
    throw new ReceiptValidationError('stripe could not retrieve the subscription', {
      code: 'provider_retrieve_failed',
      fault: 'provider',
    })
  }

  const providerSubscriptionId = assertNonEmptyProviderId(subscription.id)
  const status = mapStripeStatus(String(subscription.status))
  const currentPeriodEnd = normalizePeriodEndOr502(resolveCurrentPeriodEnd(subscription))

  const priceItem = subscription.items?.data?.[0]?.price
  const recurring = priceItem?.recurring
  let tier: SubscriptionTier | null
  try {
    tier = deriveTierFromInterval(
      String(recurring?.interval ?? ''),
      Number(recurring?.interval_count ?? 0),
      priceItem?.id ?? null,
      productTierMap,
    )
  } catch (error) {
    // An underivable plan must NOT wedge the freshness refresh — swallow ONLY the
    // tier_unresolvable client fault and refresh status/period-end with tier null.
    if (error instanceof ReceiptValidationError && error.code === 'tier_unresolvable') {
      tier = null
    } else {
      throw error
    }
  }

  return {
    provider_subscription_id: providerSubscriptionId,
    status,
    current_period_end: currentPeriodEnd,
    tier,
  }
}

// The production thin fetch adapter satisfying the StripeClientSeam — shared by
// both the validate and cancel handlers (built from STRIPE_SECRET_KEY), without
// vendoring the SDK. The Stripe endpoints are hardcoded here — NEVER derived from
// caller input (SSRF guard); the caller supplies ONLY the opaque id path segment.
//
// Stripe-Version is pinned so the response shape is deterministic regardless of
// the account default (2025-03-31.basil reports current_period_end at the
// line-item level; the resolvers read that first with a top-level fallback).
//
// The withTimeout-provided AbortSignal is threaded into EVERY fetch (both the
// GETs and the cancel POST) so an in-flight request is actually torn down on a
// fired timeout. A non-2xx response throws an Error carrying the numeric `status`
// so cancelStripeSubscriptionAtPeriodEnd can distinguish a 404 desync from a 5xx.
export function buildStripeClient(secretKey: string): StripeClientSeam {
  const base = 'https://api.stripe.com/v1'
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'Stripe-Version': '2025-03-31.basil',
  }
  const request = async (
    path: string,
    init: { method: 'GET' | 'POST'; body?: string; signal?: AbortSignal },
  ): Promise<unknown> => {
    const response = await fetch(`${base}${path}`, {
      method: init.method,
      headers: init.body === undefined
        ? headers
        : { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: init.body,
      signal: init.signal,
    })
    if (!response.ok) {
      throw Object.assign(new Error(`stripe api responded ${response.status}`), {
        status: response.status,
      })
    }
    return response.json()
  }
  return {
    subscriptions: {
      retrieve: (id: string, signal?: AbortSignal) =>
        request(`/subscriptions/${encodeURIComponent(id)}`, { method: 'GET', signal }),
      update: (id: string, params: Record<string, unknown>, signal?: AbortSignal) =>
        request(`/subscriptions/${encodeURIComponent(id)}`, {
          method: 'POST',
          body: encodeStripeForm(params),
          signal,
        }),
    },
    checkout: {
      sessions: {
        retrieve: (id: string, signal?: AbortSignal) =>
          request(`/checkout/sessions/${encodeURIComponent(id)}`, { method: 'GET', signal }),
      },
    },
  }
}

// Stripe expects application/x-www-form-urlencoded bodies. The only param the
// cancel path sends is cancel_at_period_end=true.
function encodeStripeForm(params: Record<string, unknown>): string {
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    usp.set(key, String(value))
  }
  return usp.toString()
}
