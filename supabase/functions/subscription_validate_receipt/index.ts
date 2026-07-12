// subscription_validate_receipt — validate a purchase receipt with its provider
// and unlock the caller's paid tier.
//
// AUTH POSTURE (the pivotal design point). This is the FIRST user-JWT-
// authenticated Edge Function in the repo. Every prior function
// (notify_moderation_action, streak_reminder_cron, notify_reply) is
// trigger/cron/service-role context (config verify_jwt = false +
// requireServiceRole). This one is invoked by an authenticated USER's client
// POSTing a receipt, so:
//   - identity is resolved from the caller's JWT via getAuthenticatedUser(req)
//     (any authenticated user may validate their OWN receipt — NOT requireAdmin,
//     NOT requireServiceRole);
//   - config.toml registers this function with verify_jwt = true, so the gateway
//     rejects a missing/invalid JWT before this body runs;
//   - all DB reads/writes go through createServiceRoleClient() (bypasses RLS —
//     subscription_receipts has no client write policy and users.subscription_tier
//     client writes are REVOKED).
//
// NEVER-TRUST-THE-CLIENT invariant. The user_id written to any row is ALWAYS the
// JWT-resolved uid — a client-supplied user_id is ignored. subscription_tier is
// ALWAYS server-derived from the provider receipt — a client-supplied tier is
// never trusted.
//
// PCI / NFR13 invariant. raw_receipt holds provider-issued identifiers and
// metadata ONLY — never card numbers, CVVs, or PAN data (provider receipts do
// not carry these). NFR19: the receipt is never placed in a log field or an
// error body; log lines carry ids/counts/durations/outcome/provider/tier only.
// The provider_subscription_id is deliberately NOT logged — for the Stripe path
// it equals the caller's raw_receipt, so logging it would echo receipt content.
//
// PARTIAL-WRITE ORDERING. The receipt upsert precedes the users.subscription_tier
// update; if the tier update errors after the receipt is written, the function
// fails closed to 500 (never a false success). Both writes are idempotent by
// natural key (receipt: (provider, provider_subscription_id); tier: id =
// callerUid), so a client retry converges.

import { createServiceRoleClient, getAuthenticatedUser } from '../_shared/auth.ts'
import { logError, logInfo } from '../_shared/logging.ts'
import { err, ok } from '../_shared/responses.ts'
import { ReceiptValidationError, type SubscriptionTier } from '../_shared/billing/types.ts'
import { type StripeClientSeam, validateStripeReceipt } from '../_shared/billing/stripe.ts'
import { validateAppleReceipt } from '../_shared/billing/apple.ts'
import { validateGoogleReceipt } from '../_shared/billing/google.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

// The three provider literals — matched EXACTLY against the values the
// subscription_receipts.provider CHECK admits (no case-folding, no trimming) so
// the edge and the DB stay in lockstep.
type Provider = 'stripe' | 'apple_iap' | 'play_iap'
const PROVIDERS: readonly Provider[] = ['stripe', 'apple_iap', 'play_iap']

// The structural boundary a validator resolves to. Intentionally looser than the
// providers' ReceiptValidationResult (status/tier as plain string) so an injected
// test validator and the real strict providers are both assignable — the real
// per-provider modules constrain status/tier to their unions at their own edge.
interface ValidatedReceipt {
  provider_subscription_id: string
  status: string
  current_period_end: string
  tier: string
  bound_user_id: string | null
  raw_metadata: Record<string, unknown>
}

type ProviderValidator = (rawReceipt: unknown) => Promise<ValidatedReceipt>

export interface HandlerDeps {
  // Falls back to createServiceRoleClient() (wrapped so a misconfigured env
  // returns a 500 envelope, never an uncaught throw).
  client?: SupabaseClient
  // Falls back to getAuthenticatedUser(req). Injected by tests so identity
  // resolution never needs a live Supabase Auth call.
  resolveUser?: (req: Request) => Promise<{ id: string } | null>
  // Falls back to the real per-provider dispatch table. Injected by tests so
  // handler-logic tests never fake three providers' HTTP/SDK traffic.
  validators?: Partial<Record<Provider, ProviderValidator>>
}

// Defensive body cap — a giant raw_receipt cannot be used to abuse the function.
const MAX_BODY_BYTES = 1_000_000

// The generic, no-owner-leak conflict — used for BOTH a provider-account-binding
// mismatch and an ownership pre-check/TOCTOU conflict. The message and code
// reveal NOTHING about any other owner (a distinct "belongs to X" error would be
// a subscription-id -> account-existence enumeration oracle).
function ownershipConflict(): Response {
  return err('subscription could not be applied to this account', {
    code: 'receipt_ownership_conflict',
    status: 409,
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

  // 2. Body — size guard, then JSON parse. Both BEFORE any provider call.
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

  // 3. Input contract — exact provider literal + present/non-empty raw_receipt.
  // Any user_id / subscription_tier in the body is NEVER read (never-trust-client).
  const provider = payload.provider
  if (typeof provider !== 'string' || !PROVIDERS.includes(provider as Provider)) {
    return err('unsupported or missing provider', { code: 'bad_request', status: 400 })
  }
  const rawReceipt = payload.raw_receipt
  if (isEmptyReceipt(rawReceipt)) {
    return err('missing or empty receipt', { code: 'bad_request', status: 400 })
  }

  // 4. Provider validation — only raw_receipt crosses the boundary. A typed
  // ReceiptValidationError maps to 4xx (client) vs 5xx (provider) on its fault
  // discriminator, honoring an explicit status override (e.g. 502). An
  // unexpected throw fails closed to 500. NO receipt content ever enters a log
  // or the error body.
  let result: ValidatedReceipt
  try {
    const validator = deps.validators?.[provider as Provider] ??
      defaultValidatorFor(provider as Provider)
    result = await validator(rawReceipt)
  } catch (thrown) {
    if (thrown instanceof ReceiptValidationError) {
      const status = thrown.status ?? (thrown.fault === 'client' ? 400 : 502)
      logInfo('subscription.receipt.validate.failed', {
        user_id: callerUid,
        provider,
        code: thrown.code,
        fault: thrown.fault,
        duration_ms: Date.now() - started,
      })
      return err(thrown.message, { code: thrown.code, status })
    }
    logError('subscription.receipt.validate.error', {
      user_id: callerUid,
      provider,
      duration_ms: Date.now() - started,
    })
    return err('receipt validation failed', { code: 'internal', status: 500 })
  }

  // 5. Provider-account binding (deeper anti-hijack defense): a present-but-
  // mismatched bound_user_id fails closed to the SAME generic 409, before any DB
  // write. (When absent — before the purchase client sets the binding — the
  // first-claim pre-check below is the fallback.)
  if (result.bound_user_id !== null && result.bound_user_id !== callerUid) {
    logInfo('subscription.receipt.validate.binding_conflict', {
      user_id: callerUid,
      provider,
      duration_ms: Date.now() - started,
    })
    return ownershipConflict()
  }

  // 6. DB client — service-role. A misconfigured env is a 500 envelope, not a throw.
  let client: SupabaseClient
  try {
    client = deps.client ?? createServiceRoleClient()
  } catch {
    logError('subscription.receipt.validate.client_init_error', {})
    return err('service misconfigured', { code: 'internal', status: 500 })
  }

  // 7. Ownership pre-check (fast reject, anti-hijack layer a): a row owned by a
  // DIFFERENT user_id -> generic 409, before any write.
  try {
    const { data, error } = await client
      .from('subscription_receipts')
      .select('user_id')
      .eq('provider', provider)
      .eq('provider_subscription_id', result.provider_subscription_id)
      .maybeSingle()
    if (error) {
      logError('subscription.receipt.validate.precheck_error', { user_id: callerUid, provider })
      return err('receipt lookup failed', { code: 'internal', status: 500 })
    }
    const existingOwner = (data as { user_id?: string | null } | null)?.user_id ?? null
    if (existingOwner !== null && existingOwner !== callerUid) {
      logInfo('subscription.receipt.validate.ownership_conflict', { user_id: callerUid, provider })
      return ownershipConflict()
    }
  } catch {
    logError('subscription.receipt.validate.precheck_error', { user_id: callerUid, provider })
    return err('receipt lookup failed', { code: 'internal', status: 500 })
  }

  // 8. Owner-scoped write (anti-hijack layer b, closes the TOCTOU). Attempt an
  // INSERT; on a unique-constraint conflict (23505) fall back to an
  // owner-scoped UPDATE whose .eq('user_id', callerUid) predicate is Postgres-
  // atomic — zero rows updated under a conflict means a foreign owner won the
  // race -> the same generic 409. user_id is ALWAYS callerUid, never a client
  // value.
  const nowIso = new Date().toISOString()
  const receiptRow = {
    user_id: callerUid,
    provider,
    provider_subscription_id: result.provider_subscription_id,
    status: result.status,
    current_period_end: result.current_period_end,
    last_validated_at: nowIso,
    raw_receipt: result.raw_metadata,
  }
  try {
    const { error: insertError } = await client
      .from('subscription_receipts')
      .insert(receiptRow)
      .select('id')
    if (insertError) {
      if ((insertError as { code?: string }).code === '23505') {
        const { data: updated, error: updateError } = await client
          .from('subscription_receipts')
          .update({
            status: result.status,
            current_period_end: result.current_period_end,
            last_validated_at: nowIso,
            raw_receipt: result.raw_metadata,
          })
          .eq('provider', provider)
          .eq('provider_subscription_id', result.provider_subscription_id)
          .eq('user_id', callerUid)
          .select('id')
        if (updateError) {
          logError('subscription.receipt.validate.write_error', { user_id: callerUid, provider })
          return err('receipt write failed', { code: 'internal', status: 500 })
        }
        if (!Array.isArray(updated) || updated.length === 0) {
          logInfo('subscription.receipt.validate.ownership_conflict', {
            user_id: callerUid,
            provider,
          })
          return ownershipConflict()
        }
      } else {
        logError('subscription.receipt.validate.write_error', { user_id: callerUid, provider })
        return err('receipt write failed', { code: 'internal', status: 500 })
      }
    }
  } catch {
    logError('subscription.receipt.validate.write_error', { user_id: callerUid, provider })
    return err('receipt write failed', { code: 'internal', status: 500 })
  }

  // 9. Tier update (service-role), AFTER the receipt write. Fail closed to 500 on
  // error — a partial write must never report success.
  try {
    const { error: tierError } = await client
      .from('users')
      .update({ subscription_tier: result.tier })
      .eq('id', callerUid)
    if (tierError) {
      logError('subscription.receipt.validate.tier_update_error', { user_id: callerUid, provider })
      return err('entitlement update failed', { code: 'internal', status: 500 })
    }
  } catch {
    logError('subscription.receipt.validate.tier_update_error', { user_id: callerUid, provider })
    return err('entitlement update failed', { code: 'internal', status: 500 })
  }

  logInfo('subscription.receipt.validate.ok', {
    user_id: callerUid,
    provider,
    tier: result.tier,
    status: result.status,
    duration_ms: Date.now() - started,
  })

  // Success body carries ONLY the caller's own derived entitlement — never the
  // provider_subscription_id / raw_receipt.
  return ok({ subscription_tier: result.tier, current_period_end: result.current_period_end })
}

// A raw_receipt that is null/undefined, whitespace-only, an empty object, or an
// empty array is treated as MISSING (mirrors the subscription_receipts btrim(...) <> '' on the
// id). The per-provider SHAPE is validated inside each validator.
function isEmptyReceipt(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true
  }
  if (typeof value === 'string') {
    return value.trim() === ''
  }
  if (Array.isArray(value)) {
    return value.length === 0
  }
  if (typeof value === 'object') {
    return Object.keys(value).length === 0
  }
  return false
}

// Production dispatch: build the real provider validator from env-provisioned
// secrets. Tests inject deps.validators and never reach this. Actual product
// ids / price points are ops-provisioned per environment; the product-tier map
// stays empty until the operator provisions it.
function defaultValidatorFor(provider: Provider): ProviderValidator {
  return (rawReceipt: unknown) => {
    const productTierMap = readProductTierMap()
    if (provider === 'stripe') {
      const secretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
      return validateStripeReceipt(rawReceipt, {
        stripeClient: buildStripeClient(secretKey),
        productTierMap,
      })
    }
    if (provider === 'apple_iap') {
      return validateAppleReceipt(rawReceipt, {
        sharedSecret: Deno.env.get('APPLE_SHARED_SECRET') ?? '',
        productTierMap,
      })
    }
    return validateGoogleReceipt(rawReceipt, {
      serviceAccountJson: Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') ?? '',
      packageName: Deno.env.get('GOOGLE_PLAY_PACKAGE_NAME') ?? '',
      productTierMap,
    })
  }
}

// A thin fetch adapter satisfying the StripeClientSeam. The Stripe provider
// endpoints are hardcoded here — NEVER derived from the caller's raw_receipt
// (SSRF guard); the raw_receipt supplies only the opaque id path segment.
//
// Stripe-Version is pinned explicitly so the response shape is deterministic
// regardless of the account's default API version. 2025-03-31.basil reports
// current_period_end at the line-item level (items.data[].current_period_end),
// which the validator reads (with a top-level fallback for older versions).
function buildStripeClient(secretKey: string): StripeClientSeam {
  const base = 'https://api.stripe.com/v1'
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'Stripe-Version': '2025-03-31.basil',
  }
  const getJson = async (path: string): Promise<unknown> => {
    const response = await fetch(`${base}${path}`, { headers })
    if (!response.ok) {
      throw new Error(`stripe api responded ${response.status}`)
    }
    return response.json()
  }
  return {
    subscriptions: {
      retrieve: (id: string) => getJson(`/subscriptions/${encodeURIComponent(id)}`),
    },
    checkout: {
      sessions: {
        retrieve: (id: string) => getJson(`/checkout/sessions/${encodeURIComponent(id)}`),
      },
    },
  }
}

// The env-configured product-id -> tier fallback map (interval-first is primary;
// this resolves plans an interval cannot cleanly express). Empty until ops
// provisions SUBSCRIPTION_PRODUCT_TIER_MAP.
function readProductTierMap(): Record<string, SubscriptionTier> {
  const raw = Deno.env.get('SUBSCRIPTION_PRODUCT_TIER_MAP')
  if (!raw) {
    return {}
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, SubscriptionTier>
    }
    return {}
  } catch {
    return {}
  }
}

// Bind the server only as the program entry point (the Edge Runtime runs this as
// main). Guarded so `deno test` can import the handler without a listener.
if (import.meta.main) {
  Deno.serve((req) => handler(req))
}
