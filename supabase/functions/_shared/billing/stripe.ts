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
export interface StripeClientSeam {
  subscriptions: { retrieve(id: string): Promise<unknown> }
  checkout: { sessions: { retrieve(id: string): Promise<unknown> } }
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

  return {
    provider_subscription_id: providerSubscriptionId,
    status,
    current_period_end: normalizeStripeTimestamp(currentPeriodEnd),
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
      () => Promise.resolve(client.subscriptions.retrieve(id)),
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
      () => Promise.resolve(client.checkout.sessions.retrieve(id)),
      timeoutMs,
    )) as StripeSession
  } catch (error) {
    rethrowStripeError(error)
  }
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
