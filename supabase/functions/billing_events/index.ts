// billing_events — the repo's FIRST PUBLIC webhook Edge Function, and a THIRD
// auth posture distinct from both that exist today.
//
// AUTH POSTURE (READ FIRST). Two postures exist today: (1) user-JWT
// (subscription_validate_receipt / subscription_cancel, verify_jwt = true,
// getAuthenticatedUser for identity); (2) service-role-bearer trigger/cron
// (notify_* / streak_reminder_cron, verify_jwt = false gated by
// requireServiceRole). This function is the THIRD: a public webhook registered
// with verify_jwt = false so it is reachable at its public URL BY DESIGN — but
// there is NO bearer check and NO JWT. The Stripe-Signature HMAC over the raw
// body IS the authentication (verifyStripeWebhookSignature). DB writes use the
// RLS-bypassing service-role client because there is no caller identity to scope
// to; instead every write is keyed to the exact (provider='stripe',
// provider_subscription_id) natural key.
//
// RAW-BODY-UNMODIFIED invariant. The raw request body is read ONCE with
// req.text() and that EXACT string is passed to the HMAC verifier AND to
// JSON.parse — never re-serialized between (JSON.stringify(JSON.parse(body))
// would reorder keys / drop whitespace and reject every real event).
//
// NEVER-CREATE-A-RECEIPT-ROW invariant. This function only UPDATEs existing
// subscription_receipts rows (validated into being by subscription_validate_receipt);
// it NEVER inserts. A webhook that could mint entitlement rows from an
// unauthenticated push would be an entitlement-forgery surface. An event whose
// subscription id matches no row is an idempotent 2xx no-op.
//
// SWEEP-OWNS-THE-TIER-FLIP invariant. This endpoint keeps state FRESH; it never
// downgrades a tier. On invoice.paid / customer.subscription.updated it advances
// current_period_end/status and (on a resolvable paid plan) sets the paid tier.
// On customer.subscription.deleted it refreshes status/current_period_end ONLY —
// it NEVER writes users.subscription_tier to 'free'. Entitlement expires only
// when current_period_end passes, and the daily expire_lapsed_subscription_tiers()
// pg_cron sweep (the retained all-provider backstop) owns that actual flip.
// Racing the sweep would revoke cosmetics the user paid through their period.
//
// RETRIEVE-BY-ID / out-of-order safety. The written state ALWAYS comes from a
// fresh subscriptions.retrieve by id (refreshStripeSubscriptionState), NEVER from
// the delivered event.data.object field values (its id is the only thing read).
// So a redelivered OR out-of-order-older event converges to Stripe's live truth
// and never regresses current_period_end into the sweep window — no event-id
// dedup table and no monotonic guard are needed.
//
// Invariant: raw card data is never accepted or stored. Any Stripe
// event/subscription fields that reach the DB hold provider-issued
// identifiers/metadata and timestamps ONLY — NEVER card numbers, CVVs, or full
// PAN data (payment surfaces are provider-hosted). The minimal refresh writes
// only status / current_period_end / last_validated_at and leaves raw_receipt
// untouched.
//
// Logging discipline: logs carry metadata only — never payload contents. Log
// lines carry ONLY event_type, has_subscription_id, matched,
// outcome, duration_ms — never the raw event body, the signed payload, the
// Stripe-Signature header, raw_receipt, or the provider_subscription_id (for
// Stripe the sub id is receipt-adjacent content — same discipline as the
// validate/cancel siblings).

import { createServiceRoleClient } from '../_shared/auth.ts'
import { logError, logInfo } from '../_shared/logging.ts'
import { err, ok } from '../_shared/responses.ts'
import { ReceiptValidationError, type SubscriptionTier } from '../_shared/billing/types.ts'
import {
  buildStripeClient,
  refreshStripeSubscriptionState,
  verifyStripeWebhookSignature,
} from '../_shared/billing/stripe.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

// The authoritative-state shape refreshStripeSubscriptionState resolves to.
interface RefreshedState {
  provider_subscription_id: string
  status: string
  current_period_end: string
  tier: string | null
}

export interface HandlerDeps {
  // Falls back to createServiceRoleClient() (wrapped so a misconfigured env
  // returns a 500 envelope, never an uncaught throw).
  client?: SupabaseClient
  // Falls back to the real verifyStripeWebhookSignature over STRIPE_WEBHOOK_SECRET.
  // Injected by tests so dispatch-logic tests never compute real HMAC signatures
  // — that adapter-level correctness lives in _shared/billing/stripe.test.ts.
  // Returns the parsed event on success; throws a ReceiptValidationError on
  // failure.
  verifySignature?: (rawBody: string, signatureHeader: string | null) => unknown
  // Falls back to the real dispatch built from STRIPE_SECRET_KEY
  // (refreshStripeSubscriptionState). Injected by tests so handler-logic tests
  // never fake live Stripe HTTP traffic.
  refreshStripeState?: (subscriptionId: string) => Promise<RefreshedState>
  // Threaded into the real verifier's tolerance-window check for deterministic
  // replay/staleness tests.
  nowMs?: number
}

// Defensive body cap, measured in ACTUAL UTF-8 BYTES (not UTF-16 .length — a
// multi-byte-heavy body can be under the cap by .length while over it in bytes).
// The HMAC is still computed over the exact raw string regardless.
const MAX_BODY_BYTES = 1_000_000

// The three event types this function acts on. Any other type is acknowledged
// 2xx and ignored (a non-2xx would make Stripe redeliver an event we
// intentionally do not handle).
const HANDLED_EVENT_TYPES = [
  'invoice.paid',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]

// The generic, no-detail signature failure — returned for a missing, malformed,
// non-verifying, or stale-timestamp signature. The body reveals NOTHING (never
// the header, the computed digest, or the reason).
function signatureFailure(): Response {
  return err('invalid signature', { code: 'webhook_signature_invalid', status: 400 })
}

export async function handler(req: Request, deps: HandlerDeps = {}): Promise<Response> {
  const started = Date.now()

  // 1. Method — only POST. Any other method is a generic 4xx, before any body
  // read, DB, or provider call.
  if (req.method !== 'POST') {
    return err('method not allowed', { code: 'method_not_allowed', status: 405 })
  }

  // 2. Body — read ONCE (the exact string HMAC'd and later parsed), then the
  // byte-measured size guard. Both BEFORE verification / DB / provider call.
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return err('invalid request body', { code: 'bad_request', status: 400 })
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return err('request body too large', { code: 'bad_request', status: 400 })
  }

  // 3. Signature verification — the SOLE auth. On failure: generic 400, NO body
  // detail, NO DB read/write, NO provider call. An unset/empty
  // STRIPE_WEBHOOK_SECRET is OUR misconfiguration (config 500 BEFORE verify),
  // never a silent accept and never a signature-fault misreport.
  const signatureHeader = req.headers.get('Stripe-Signature')
  let event: Record<string, unknown>
  if (deps.verifySignature) {
    try {
      event = deps.verifySignature(rawBody, signatureHeader) as Record<string, unknown>
    } catch {
      logInfo('billing.events.signature_rejected', { duration_ms: Date.now() - started })
      return signatureFailure()
    }
  } else {
    const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
    if (secret.trim() === '') {
      logError('billing.events.webhook_secret_unset', {})
      return err('service misconfigured', { code: 'internal', status: 500 })
    }
    try {
      event = verifyStripeWebhookSignature(rawBody, signatureHeader ?? '', secret, {
        nowMs: deps.nowMs,
      }) as Record<string, unknown>
    } catch {
      logInfo('billing.events.signature_rejected', { duration_ms: Date.now() - started })
      return signatureFailure()
    }
  }

  // 4. Dispatch on event.type. An unhandled type is acknowledged 2xx with ZERO
  // DB/provider interaction (not even the row lookup). A signature-valid body of
  // literal JSON `null` (or any non-object) parses to a value with no readable
  // `.type` — treat it as an unhandled event so `typeof event.type` never throws
  // an uncaught 500; it falls through to the intended 2xx no-op below.
  const eventRecord = getRecord(event)
  const eventType = typeof eventRecord?.type === 'string' ? eventRecord.type : ''
  if (!HANDLED_EVENT_TYPES.includes(eventType)) {
    logInfo('billing.events.unhandled_type', {
      event_type: eventType,
      outcome: 'ignored',
      duration_ms: Date.now() - started,
    })
    return ok()
  }
  const tierEligible = eventType === 'invoice.paid' ||
    eventType === 'customer.subscription.updated'

  // 5. Resolve the subscription id from the delivered object (its ONLY use — the
  // written state comes from a fresh retrieve). A missing/underivable id is an
  // unknown-subscription 2xx no-op, never a 500.
  const dataObject = getRecord(getRecord(eventRecord?.data)?.object)
  const subscriptionId = eventType === 'invoice.paid'
    ? extractInvoiceSubscriptionId(dataObject)
    : nonEmptyString(dataObject?.id)
  if (subscriptionId === null) {
    logInfo('billing.events.no_subscription_id', {
      event_type: eventType,
      has_subscription_id: false,
      matched: false,
      outcome: 'noop',
      duration_ms: Date.now() - started,
    })
    return ok()
  }

  // 6. DB client — service-role. A misconfigured env is a 500 envelope, not a throw.
  let client: SupabaseClient
  try {
    client = deps.client ?? createServiceRoleClient()
  } catch {
    logError('billing.events.client_init_error', { event_type: eventType })
    return err('service misconfigured', { code: 'internal', status: 500 })
  }

  // 7. Row match by the composite natural key. No matching row → unknown-
  // subscription 2xx idempotent no-op (NEVER an insert, NEVER a write, and NO
  // provider retrieve). A lookup error → 5xx (Stripe redelivers).
  let userId: string | null
  try {
    const { data, error } = await client
      .from('subscription_receipts')
      .select('user_id, current_period_end, status')
      .eq('provider', 'stripe')
      .eq('provider_subscription_id', subscriptionId)
      .maybeSingle()
    if (error) {
      logError('billing.events.lookup_error', { event_type: eventType })
      return err('subscription lookup failed', { code: 'internal', status: 500 })
    }
    const row = data as { user_id?: string | null } | null
    if (!row) {
      logInfo('billing.events.unknown_subscription', {
        event_type: eventType,
        has_subscription_id: true,
        matched: false,
        outcome: 'noop',
        duration_ms: Date.now() - started,
      })
      return ok()
    }
    userId = typeof row.user_id === 'string' ? row.user_id : null
  } catch {
    logError('billing.events.lookup_error', { event_type: eventType })
    return err('subscription lookup failed', { code: 'internal', status: 500 })
  }

  // 8. Authoritative state — ALWAYS retrieved fresh by id (never the delivered
  // event.data.object field values). A retrieve timeout / Stripe 5xx / 429 → 5xx
  // (Stripe redelivers; the refresh is idempotent AND out-of-order-safe). A
  // provider-contract violation (bad status, malformed period end) → 502. An
  // unset/empty STRIPE_SECRET_KEY is guarded inside the default dispatch → 500
  // BEFORE any network call.
  const refresh = deps.refreshStripeState ?? defaultRefresh()
  let state: RefreshedState
  try {
    state = await refresh(subscriptionId)
  } catch (thrown) {
    if (thrown instanceof ReceiptValidationError) {
      const status = thrown.status ?? (thrown.fault === 'client' ? 400 : 502)
      logInfo('billing.events.provider_failed', {
        event_type: eventType,
        code: thrown.code,
        fault: thrown.fault,
        outcome: 'provider_fault',
        duration_ms: Date.now() - started,
      })
      return err(thrown.message, { code: thrown.code, status })
    }
    logError('billing.events.provider_error', { event_type: eventType })
    return err('subscription refresh failed', { code: 'internal', status: 500 })
  }

  // 9. Refresh the matched row (owner-agnostic — no caller identity to scope to —
  // but keyed on the exact natural key so only the one authoritative row is
  // touched). last_validated_at advances because a provider push IS a validation
  // of current state. A write error → 5xx (Stripe redelivers; idempotent).
  try {
    const { error } = await client
      .from('subscription_receipts')
      .update({
        status: state.status,
        current_period_end: state.current_period_end,
        last_validated_at: new Date().toISOString(),
      })
      .eq('provider', 'stripe')
      .eq('provider_subscription_id', subscriptionId)
    if (error) {
      logError('billing.events.receipt_write_error', { event_type: eventType })
      return err('subscription write failed', { code: 'internal', status: 500 })
    }
  } catch {
    logError('billing.events.receipt_write_error', { event_type: eventType })
    return err('subscription write failed', { code: 'internal', status: 500 })
  }

  // 10. Tier update — ONLY on invoice.paid / customer.subscription.updated with a
  // resolvable paid tier, for the user_id FOUND ON THE MATCHED ROW. NEVER on
  // customer.subscription.deleted and NEVER a 'free' write (the sweep owns
  // downgrades). A null tier (underivable plan) skips the update, keeping the
  // freshness refresh from being wedged.
  if (tierEligible && state.tier !== null && userId !== null) {
    try {
      const { error } = await client
        .from('users')
        .update({ subscription_tier: state.tier as SubscriptionTier })
        .eq('id', userId)
      if (error) {
        logError('billing.events.users_write_error', { event_type: eventType })
        return err('subscription write failed', { code: 'internal', status: 500 })
      }
    } catch {
      logError('billing.events.users_write_error', { event_type: eventType })
      return err('subscription write failed', { code: 'internal', status: 500 })
    }
  }

  logInfo('billing.events.ok', {
    event_type: eventType,
    has_subscription_id: true,
    matched: true,
    outcome: 'refreshed',
    duration_ms: Date.now() - started,
  })

  // Stripe reads ONLY the status code — the success body carries NO subscription
  // id / event content.
  return ok()
}

// Extract the subscription id from an invoice object, defensively for the pinned
// 2025-03-31.basil shape (Basil removed the top-level invoice.subscription):
// invoice.parent.subscription_details.subscription first, then the legacy
// invoice.subscription, then a line item's subscription reference. A missing id
// is an unknown-subscription 2xx no-op upstream (never a 500).
function extractInvoiceSubscriptionId(invoice: Record<string, unknown> | null): string | null {
  if (invoice === null) {
    return null
  }
  const parentDetails = getRecord(getRecord(invoice.parent)?.subscription_details)
  const fromParent = nonEmptyString(parentDetails?.subscription)
  if (fromParent !== null) {
    return fromParent
  }
  const fromTopLevel = nonEmptyString(invoice.subscription)
  if (fromTopLevel !== null) {
    return fromTopLevel
  }
  const lines = getRecord(invoice.lines)?.data
  if (Array.isArray(lines)) {
    for (const line of lines) {
      const lineRecord = getRecord(line)
      if (lineRecord === null) {
        continue
      }
      const itemDetails = getRecord(getRecord(lineRecord.parent)?.subscription_item_details)
      const fromItem = nonEmptyString(itemDetails?.subscription)
      if (fromItem !== null) {
        return fromItem
      }
      const fromLine = nonEmptyString(lineRecord.subscription)
      if (fromLine !== null) {
        return fromLine
      }
    }
  }
  return null
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

// Production authoritative-state dispatch: build the shared thin fetch adapter
// from the env-provisioned STRIPE_SECRET_KEY and retrieve-by-id via the shared
// helper. Tests inject deps.refreshStripeState and never reach this.
function defaultRefresh(): (subscriptionId: string) => Promise<RefreshedState> {
  return (subscriptionId: string) => {
    const secretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
    // An unset/empty key would produce `Authorization: Bearer ` and a Stripe 401,
    // which the fault mapping would misreport as a provider-fault 502. This is OUR
    // misconfiguration — fail closed to a config 500 BEFORE any network call
    // (status override, since the fault union has no config member), mirroring
    // subscription_cancel's defaultStripeCancel guard.
    if (secretKey.trim() === '') {
      throw new ReceiptValidationError('billing events refresh is not configured', {
        code: 'internal',
        fault: 'provider',
        status: 500,
      })
    }
    return refreshStripeSubscriptionState(subscriptionId, {
      stripeClient: buildStripeClient(secretKey),
    })
  }
}

// Bind the server only as the program entry point (the Edge Runtime runs this as
// main). Guarded so `deno test` can import the handler without a listener.
if (import.meta.main) {
  Deno.serve((req) => handler(req))
}
