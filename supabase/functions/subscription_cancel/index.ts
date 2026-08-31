// subscription_cancel — cancel a subscriber's paid tier at period end, or tell
// the client to cancel natively when the provider has no server cancel API.
//
// AUTH POSTURE. This is the SECOND user-JWT-authenticated Edge Function in the
// repo (subscription_validate_receipt was the first; every other function is
// trigger/cron/service-role context). Same posture as the validate sibling:
//   - identity is resolved from the caller's JWT via getAuthenticatedUser(req)
//     (any authenticated user may cancel their OWN subscription — NOT
//     requireAdmin, NOT requireServiceRole);
//   - config.toml registers this function with verify_jwt = true, so the gateway
//     rejects a missing/invalid JWT before this body runs;
//   - all DB reads/writes go through createServiceRoleClient() (bypasses RLS —
//     subscription_receipts has no client write policy and
//     users.subscription_tier client writes are REVOKED).
//
// NEVER-TRUST-THE-CLIENT invariant. Every read/write is scoped to the
// JWT-resolved uid — a client-supplied user_id (or any other extra body field)
// is ignored. subscription_tier is never written here at all; the period-end
// downgrade to 'free' is a separate out-of-request pg_cron sweep.
//
// CANCEL-AT-PERIOD-END (NOT immediate) invariant. Paid access and unlocked
// cosmetics continue until current_period_end — the user keeps what they paid
// for. Stripe is cancelled with
// cancel_at_period_end=true (never a DELETE / immediate revoke); Apple and Play
// have no server cancel API, so this function makes no provider call and returns
// requires_native_action=true (the client deep-links to native subscription
// management as one of the ≤3 cancel steps).
//
// OWNERSHIP is the INVERSE of the validate path. Validate rejects a receipt that
// already exists under a DIFFERENT owner (first-claim guard). Cancel REQUIRES the
// receipt to already exist AND be owned by the caller. Both "no row" and
// "foreign-owned row" return the SAME generic 404 (subscription_not_found) —
// returning distinct responses would be a (provider, subscription_id) ->
// account-existence enumeration oracle. The denial precedes any provider
// dispatch in both branches, so there is no differential-latency timing oracle.
//
// Card data never touches this system — payment surfaces are provider-hosted, so
// raw_receipt (including the merged cancellation fields) holds provider-issued
// identifiers/metadata and timestamps ONLY — never card numbers, CVVs, or PAN
// data. The receipt is never placed in a log field or an error body; logs carry
// metadata only — the provider_subscription_id is deliberately NOT logged (for
// Stripe it equals the caller's subscription_id input, i.e. receipt-adjacent).
//
// PARTIAL-WRITE ORDERING. The provider cancel precedes the receipt UPDATE; if the
// UPDATE errors after the provider cancel succeeds, the function fails closed to
// 500 (never a false success). The provider cancel-at-period-end call is
// idempotent (re-cancelling an already-scheduled cancel is a no-op returning the
// same period end) and the receipt UPDATE is idempotent by natural key, so a
// client retry converges.

import { createServiceRoleClient, getAuthenticatedUser } from '../_shared/auth.ts'
import { logError, logInfo } from '../_shared/logging.ts'
import { err, ok } from '../_shared/responses.ts'
import { ReceiptValidationError } from '../_shared/billing/types.ts'
import {
  buildStripeClient,
  cancelStripeSubscriptionAtPeriodEnd,
} from '../_shared/billing/stripe.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

// The three provider literals — matched EXACTLY against the values the
// subscription_receipts.provider CHECK admits (no case-folding, no trimming) so
// the edge and the DB stay in lockstep.
type Provider = 'stripe' | 'apple_iap' | 'play_iap'
const PROVIDERS: readonly Provider[] = ['stripe', 'apple_iap', 'play_iap']

export interface HandlerDeps {
  // Falls back to createServiceRoleClient() (wrapped so a misconfigured env
  // returns a 500 envelope, never an uncaught throw).
  client?: SupabaseClient
  // Falls back to getAuthenticatedUser(req). Injected by tests so identity
  // resolution never needs a live Supabase Auth call.
  resolveUser?: (req: Request) => Promise<{ id: string } | null>
  // Falls back to the real Stripe dispatch built from STRIPE_SECRET_KEY. Injected
  // by tests so handler-logic tests never fake live Stripe HTTP traffic — that
  // adapter-level correctness lives in _shared/billing/stripe.test.ts. apple/play
  // never call a provider, so no separate seam is needed for them.
  cancelStripeSubscription?: (id: string) => Promise<{ current_period_end: string }>
}

// Defensive body cap — a giant body cannot be used to abuse the function.
const MAX_BODY_BYTES = 1_000_000

// The generic, no-owner-leak denial — returned for BOTH "no row found" AND
// "row found but owned by a different user_id" AND a Stripe local↔provider
// desync (resource_missing on a locally-owned id). The message, code, and status
// reveal NOTHING about whether a (provider, subscription_id) exists or who owns
// it (a distinct response would be an account-existence enumeration oracle).
function subscriptionNotFound(): Response {
  return err('no active subscription found for this account', {
    code: 'subscription_not_found',
    status: 404,
  })
}

export async function handler(req: Request, deps: HandlerDeps = {}): Promise<Response> {
  const started = Date.now()

  // 1. Identity — user JWT, resolved BEFORE any DB or provider call.
  const resolveUser = deps.resolveUser ?? getAuthenticatedUser
  const user = await resolveUser(req)
  if (!user) {
    return err('unauthorized', { code: 'unauthorized', status: 401 })
  }
  const callerUid = user.id

  // 2. Body — size guard, then JSON parse. Both BEFORE any DB or provider call.
  let rawText: string
  try {
    rawText = await req.text()
  } catch {
    return err('invalid request body', { code: 'bad_request', status: 400 })
  }
  if (rawText.length > MAX_BODY_BYTES) {
    return err('request body too large', { code: 'bad_request', status: 400 })
  }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawText) as Record<string, unknown>
  } catch {
    return err('invalid JSON body', { code: 'bad_request', status: 400 })
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return err('malformed payload', { code: 'bad_request', status: 400 })
  }

  // 3. Input contract — exact provider literal + present/non-empty
  // subscription_id (after trim). Any user_id / subscription_tier in the body is
  // NEVER read (never-trust-client). BEFORE any DB or provider call.
  const provider = payload.provider
  if (typeof provider !== 'string' || !PROVIDERS.includes(provider as Provider)) {
    return err('unsupported or missing provider', { code: 'bad_request', status: 400 })
  }
  const subscriptionIdRaw = payload.subscription_id
  if (typeof subscriptionIdRaw !== 'string' || subscriptionIdRaw.trim() === '') {
    return err('missing or empty subscription_id', { code: 'bad_request', status: 400 })
  }
  const providerLiteral = provider as Provider
  // The id maps to subscription_receipts.provider_subscription_id. The stored
  // value is the exact string as written by the validate path; do not trim it for
  // the lookup (the natural key matches on the literal).
  const subscriptionId = subscriptionIdRaw

  // 4. DB client — service-role. A misconfigured env is a 500 envelope, not a throw.
  let client: SupabaseClient
  try {
    client = deps.client ?? createServiceRoleClient()
  } catch {
    logError('subscription.cancel.client_init_error', {})
    return err('service misconfigured', { code: 'internal', status: 500 })
  }

  // 5. Ownership verification (inverse of the validate path). SELECT the row by
  // the composite natural key. BOTH "no row" AND "foreign-owned row" collapse to
  // the SAME generic 404, BEFORE any provider dispatch (no enumeration oracle, no
  // timing oracle). A real id submitted under the WRONG provider literal simply
  // misses the composite key and yields the same generic 404.
  let ownedPeriodEnd: string
  let existingRawReceipt: Record<string, unknown>
  try {
    const { data, error } = await client
      .from('subscription_receipts')
      .select('user_id, current_period_end, raw_receipt')
      .eq('provider', providerLiteral)
      .eq('provider_subscription_id', subscriptionId)
      .maybeSingle()
    if (error) {
      logError('subscription.cancel.ownership_lookup_error', {
        user_id: callerUid,
        provider: providerLiteral,
      })
      return err('subscription lookup failed', { code: 'internal', status: 500 })
    }
    const row = data as
      | { user_id?: string | null; current_period_end?: string | null; raw_receipt?: unknown }
      | null
    if (!row || row.user_id !== callerUid) {
      logInfo('subscription.cancel.not_found', {
        user_id: callerUid,
        provider: providerLiteral,
        duration_ms: Date.now() - started,
      })
      return subscriptionNotFound()
    }
    // Normalize the stored TIMESTAMPTZ (PostgREST renders it in +00:00 form) to
    // the same UTC ISO-8601 Z-form the Stripe path returns, for a consistent
    // response contract across providers.
    ownedPeriodEnd = new Date(String(row.current_period_end)).toISOString()
    existingRawReceipt = isPlainObject(row.raw_receipt) ? row.raw_receipt : {}
  } catch {
    logError('subscription.cancel.ownership_lookup_error', {
      user_id: callerUid,
      provider: providerLiteral,
    })
    return err('subscription lookup failed', { code: 'internal', status: 500 })
  }

  // 6. Provider dispatch — cancel-at-period-end, NEVER immediate. Access must
  // continue until current_period_end in every case.
  const requiresNativeAction = providerLiteral !== 'stripe'
  let effectivePeriodEnd = ownedPeriodEnd
  const nowIso = new Date().toISOString()

  if (providerLiteral === 'stripe') {
    // Stripe is the ONLY server-cancelable provider. A typed
    // provider_resource_missing (a local↔Stripe desync) collapses into the SAME
    // generic 404 as the ownership check — functionally there is nothing to
    // cancel, and reusing the 404 avoids both a false 5xx alarm and any signal
    // that the receipt existed locally. Any other typed error maps on its fault
    // discriminator (status override, else 400 client / 502 provider). An
    // unexpected non-typed throw fails closed to 500. NO write is attempted on a
    // failed dispatch.
    const cancelStripe = deps.cancelStripeSubscription ?? defaultStripeCancel()
    try {
      const result = await cancelStripe(subscriptionId)
      effectivePeriodEnd = result.current_period_end
    } catch (thrown) {
      if (thrown instanceof ReceiptValidationError) {
        if (thrown.code === 'provider_resource_missing') {
          logInfo('subscription.cancel.provider_desync', {
            user_id: callerUid,
            provider: providerLiteral,
            duration_ms: Date.now() - started,
          })
          return subscriptionNotFound()
        }
        const status = thrown.status ?? (thrown.fault === 'client' ? 400 : 502)
        logInfo('subscription.cancel.provider_failed', {
          user_id: callerUid,
          provider: providerLiteral,
          code: thrown.code,
          fault: thrown.fault,
          duration_ms: Date.now() - started,
        })
        return err(thrown.message, { code: thrown.code, status })
      }
      logError('subscription.cancel.provider_error', {
        user_id: callerUid,
        provider: providerLiteral,
        duration_ms: Date.now() - started,
      })
      return err('subscription cancellation failed', { code: 'internal', status: 500 })
    }
  }
  // apple_iap / play_iap: NO provider call. Apple has no server cancel API;
  // Play's cancel endpoint is intentionally NOT used at v1.0 (the client is
  // routed to native subscription management for Apple/Play parity). The period
  // end is the stored receipt value.

  // 7. Owner-scoped receipt write (raw_receipt merge — subscription_receipts has
  // NO metadata column). Merge the cancellation fields into the existing
  // raw_receipt JSONB rather than overwriting it. Stripe: flip status='canceled'
  // (the cancel is confirmed server-side) and record canceled_at. apple/play:
  // leave status UNCHANGED (the cancellation is not confirmed until the user
  // completes the native flow) and record cancellation_requested_at instead.
  const mergedRawReceipt: Record<string, unknown> = {
    ...existingRawReceipt,
    cancel_at_period_end: true,
    requires_native_action: requiresNativeAction,
  }
  // last_validated_at is deliberately NOT touched (no re-validation happened);
  // updated_at advances via the handle_times trigger.
  const patch: Record<string, unknown> = {}
  if (providerLiteral === 'stripe') {
    mergedRawReceipt.canceled_at = nowIso
    patch.status = 'canceled'
    // Persist the provider-fresh period end so the stored column (which governs
    // the tier-expiry sweep) matches exactly what the response reports — the two
    // must never diverge. apple/play make no provider call, so their stored value
    // is already authoritative and is left untouched.
    patch.current_period_end = effectivePeriodEnd
  } else {
    mergedRawReceipt.cancellation_requested_at = nowIso
  }
  patch.raw_receipt = mergedRawReceipt

  // Fail closed: if the provider cancel already succeeded but this UPDATE errors,
  // return 500 (never a false success). The write is idempotent by natural key,
  // so a client retry converges.
  try {
    const { error: updateError } = await client
      .from('subscription_receipts')
      .update(patch)
      .eq('provider', providerLiteral)
      .eq('provider_subscription_id', subscriptionId)
      .eq('user_id', callerUid)
    if (updateError) {
      logError('subscription.cancel.write_error', {
        user_id: callerUid,
        provider: providerLiteral,
      })
      return err('subscription write failed', { code: 'internal', status: 500 })
    }
  } catch {
    logError('subscription.cancel.write_error', {
      user_id: callerUid,
      provider: providerLiteral,
    })
    return err('subscription write failed', { code: 'internal', status: 500 })
  }

  logInfo('subscription.cancel.ok', {
    user_id: callerUid,
    provider: providerLiteral,
    requires_native_action: requiresNativeAction,
    duration_ms: Date.now() - started,
  })

  // Success body carries ONLY the period end + native-action flag — never the
  // provider_subscription_id / raw_receipt / provider PII.
  return ok({
    current_period_end: effectivePeriodEnd,
    requires_native_action: requiresNativeAction,
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Production Stripe dispatch: build the shared thin fetch adapter from the
// env-provisioned STRIPE_SECRET_KEY and cancel-at-period-end via the shared
// helper. Tests inject deps.cancelStripeSubscription and never reach this.
function defaultStripeCancel(): (id: string) => Promise<{ current_period_end: string }> {
  return (id: string) => {
    const secretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
    // An unset/empty key would produce `Authorization: Bearer ` and a Stripe 401,
    // which the desync/fault mapping would misreport as a provider-fault 502. This
    // is OUR misconfiguration, not a provider outage — fail closed to a config
    // 500 BEFORE any network call (status override, since the fault union has no
    // config member).
    if (secretKey.trim() === '') {
      throw new ReceiptValidationError('subscription cancellation is not configured', {
        code: 'internal',
        fault: 'provider',
        status: 500,
      })
    }
    return cancelStripeSubscriptionAtPeriodEnd(id, { stripeClient: buildStripeClient(secretKey) })
  }
}

// Bind the server only as the program entry point (the Edge Runtime runs this as
// main). Guarded so `deno test` can import the handler without a listener.
if (import.meta.main) {
  Deno.serve((req) => handler(req))
}
