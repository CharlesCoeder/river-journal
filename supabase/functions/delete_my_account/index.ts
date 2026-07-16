// delete_my_account — a user's self-service account deletion. Cancels the
// caller's still-billing subscriptions with the provider, runs the atomic
// server-side data cascade (soft-anonymize Collective contributions,
// hard-delete private/operational data), then removes the auth identity LAST.
//
// AUTH POSTURE. This is the THIRD user-JWT-authenticated Edge Function in the
// repo (subscription_validate_receipt was the first, subscription_cancel the
// second; every other function is trigger/cron service-role context, and
// billing_events is the one public-webhook posture). Same posture as the two
// subscription siblings:
//   - identity is resolved from the caller's JWT via getAuthenticatedUser(req)
//     (any authenticated user may delete their OWN account — NOT requireAdmin,
//     NOT requireServiceRole);
//   - config.toml registers this function with verify_jwt = true, so the
//     gateway rejects a missing/invalid JWT before this body runs;
//   - all DB work goes through createServiceRoleClient() (bypasses RLS — the
//     cascade touches many tables with no client write policy, and calls the
//     Auth admin API which only the service-role key authorizes).
//
// NEVER-TRUST-THE-CLIENT invariant. Every phase scopes to the JWT-resolved
// callerUid. The request body is size-capped but NEVER parsed for fields — this
// action needs no client input, and a client-supplied user_id (or any extra
// field) is ignored entirely.
//
// SAGA / PHASE ORDERING (each boundary exists so a crash between two phases
// leaves a recoverable state):
//   Phase 0 · MARKER-FIRST. Set users.deletion_requested_at as the VERY FIRST
//     db write, ahead of any provider call. The daily retry sweep can only find
//     users whose marker is set, so writing it before the irreversible external
//     cancel is what makes a mid-saga crash recoverable. Idempotent
//     (WHERE deletion_requested_at IS NULL). A failure here fails closed to 500
//     before anything external happened (trivially retryable).
//   Phase A · CANCEL (external, before any cascade mutation). Read the caller's
//     still-billing receipts (status IN ('active','past_due','pending')); cancel
//     each Stripe one via the SHARED _shared/billing/stripe.ts helper (the same
//     provider call subscription_cancel makes — NOT an internal HTTP re-invoke
//     of that function). active/past_due cancel at period end keeping paid time;
//     a 'pending'/incomplete sub has no collected payment, so the same call
//     voids an unpaid sub and closes the ghost-billing hole where a pending sub
//     could activate and bill AFTER the row is hard-deleted. An already-
//     cancelled/missing Stripe
//     subscription (typed provider_resource_missing) is treated as SUCCESS
//     (idempotent-cancel — a retry after a prior cancel), not a hard failure.
//     Any other typed error, or an unexpected throw, ABORTS the saga before the
//     cascade — the DB is still untouched so a retry can cascade later.
//     Apple/Play have no server cancel API: no provider call, and the response
//     flags that a native action is required (the client deep-links).
//   Phase B · CASCADE (one atomic Postgres txn, the delete_my_account RPC). All
//     anonymize + hard-deletes commit or roll back together — no half state.
//     Idempotent (a re-run finds nothing). An error → 500 (retryable); the
//     auth-delete is NEVER attempted after a cascade failure.
//   Phase C · AUTH FINALIZE, LAST. auth.admin.deleteUser removes the identity
//     (which FK-cascades the now-data-empty public.users row + trusted_browsers
//     and terminates sessions). Deferred so auth.users is the LAST thing to go
//     (a retry can still locate the user). ANY failure here — a genuine GoTrue
//     error, OR a retry/concurrent invocation hitting an already-removed
//     identity — is logged metadata-only and does NOT fail the request: the
//     deletion_requested_at marker + the retry sweep are the backstop, so
//     the function still returns ok and the client can complete local cleanup.
//
// Logging is metadata-only: user_id, step/outcome markers, counts,
// durations. Never email, display name, post/entry content, or a raw exception.

import { createServiceRoleClient, getAuthenticatedUser } from '../_shared/auth.ts'
import { logError, logInfo } from '../_shared/logging.ts'
import { err, ok } from '../_shared/responses.ts'
import { ReceiptValidationError } from '../_shared/billing/types.ts'
import {
  buildStripeClient,
  cancelStripeSubscriptionAtPeriodEnd,
} from '../_shared/billing/stripe.ts'
import {
  emitServerEvent as defaultEmitServerEvent,
  SERVER_DISTINCT_ID,
} from '../_shared/posthog.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

// A still-billing receipt row, read BEFORE the cascade deletes it. `provider`
// is a raw string (one of the subscription_receipts.provider CHECK values —
// 'stripe' | 'apple_iap' | 'play_iap') and is compared exactly below; only
// 'stripe' has a server cancel API, every other value routes to the
// native-action branch.
interface CancelableReceipt {
  provider: string
  provider_subscription_id: string
}

export interface HandlerDeps {
  // Falls back to createServiceRoleClient() (wrapped so a misconfigured env
  // returns a 500 envelope, never an uncaught throw). Consulted ONLY to build
  // the default implementation of any seam below that is not overridden.
  client?: SupabaseClient
  // Falls back to getAuthenticatedUser(req). Injected so identity resolution
  // never needs a live Supabase Auth call in handler-logic tests.
  resolveUser?: (req: Request) => Promise<{ id: string } | null>
  // The dedicated PRE-CANCEL marker write (marker-first recoverability): sets
  // users.deletion_requested_at as the VERY FIRST db write. Idempotent
  // (WHERE deletion_requested_at IS NULL).
  markDeletionRequested?: (userId: string) => Promise<{ error: unknown }>
  // The compensating marker CLEAR: resets users.deletion_requested_at back to
  // NULL. Invoked on every PRE-CASCADE terminal failure (before runCascade ever
  // runs) so a post-marker error the client sees as "nothing happened" does not
  // leave a one-way latch the sweep would later finalize. Mirrors
  // markDeletionRequested (the same service-role seam). NEVER called once the
  // cascade has been invoked — deletion is committed at that point.
  clearDeletionRequested?: (userId: string) => Promise<{ error: unknown }>
  // The still-billing rows (status IN ('active','past_due','pending')) for the
  // caller, read before the cascade deletes them.
  listCancelableReceipts?: (userId: string) => Promise<CancelableReceipt[]>
  // Falls back to the real Stripe dispatch built from STRIPE_SECRET_KEY (the
  // SAME shared helper subscription_cancel calls). Injected so handler-logic
  // tests never fake live Stripe HTTP traffic.
  cancelStripeSubscription?: (id: string) => Promise<{ current_period_end: string }>
  // Wraps client.rpc('delete_my_account', { p_user_id }) — the single atomic
  // DB-side cascade.
  runCascade?: (userId: string) => Promise<{ error: unknown }>
  // Wraps client.auth.admin.deleteUser(userId) — the LAST step.
  deleteAuthUser?: (userId: string) => Promise<{ error: unknown }>
  // Reads users.subscription_tier BEFORE the cascade wipes it (captured in the
  // identity/Phase-A window). A null/absent row is defaulted to 'free' by the
  // handler (not the seam). Injectable, consistent with the other seams.
  readSubscriptionTier?: (userId: string) => Promise<string | null>
  // Falls back to the real _shared/posthog.ts emitServerEvent (itself inert
  // unless POSTHOG_API_KEY is set). Injected by tests to observe the emission
  // without a live PostHog call. Best-effort — never alters the response.
  emitServerEvent?: (
    event: string,
    distinctId: string,
    props?: Record<string, unknown>,
  ) => Promise<void>
}

// Defensive body cap — a giant body cannot be used to abuse the function. The
// body is never parsed beyond this size check.
const MAX_BODY_BYTES = 1_000_000

export async function handler(req: Request, deps: HandlerDeps = {}): Promise<Response> {
  const started = Date.now()

  // 1. Identity — user JWT, resolved BEFORE any DB or provider call.
  const resolveUser = deps.resolveUser ?? getAuthenticatedUser
  const user = await resolveUser(req)
  if (!user) {
    return err('unauthorized', { code: 'unauthorized', status: 401 })
  }
  const callerUid = user.id

  // 2. Body — size guard ONLY. The content is never parsed: this action needs
  // no client input, and a client-supplied user_id would be ignored anyway
  // (never-trust-the-client). A missing/empty/non-JSON body is all fine.
  let rawText: string
  try {
    rawText = await req.text()
  } catch {
    return err('invalid request body', { code: 'bad_request', status: 400 })
  }
  if (rawText.length > MAX_BODY_BYTES) {
    return err('request body too large', { code: 'bad_request', status: 400 })
  }

  // 3. DB client — service-role, consulted ONLY to build the default
  // implementation of a DB-touching seam not explicitly overridden. Constructed
  // lazily: if every DB seam is injected (as in handler-logic tests) the client
  // is never built, so its env requirements never apply. A misconfigured env
  // when the client IS needed is a 500 envelope, never an uncaught throw. (The
  // Stripe-cancel seam builds from STRIPE_SECRET_KEY, not this client.)
  const needsDefaultClient = !deps.markDeletionRequested ||
    !deps.clearDeletionRequested ||
    !deps.listCancelableReceipts ||
    !deps.runCascade ||
    !deps.deleteAuthUser ||
    !deps.readSubscriptionTier
  let client: SupabaseClient | undefined = deps.client
  if (!client && needsDefaultClient) {
    try {
      client = createServiceRoleClient()
    } catch {
      logError('account.delete.client_init_error', { user_id: callerUid })
      return err('service misconfigured', { code: 'internal', status: 500 })
    }
  }

  // Non-null assertions below are sound: a default DB seam is only built when
  // its override is absent, and needsDefaultClient guarantees `client` is set
  // in exactly that case.
  const markDeletionRequested = deps.markDeletionRequested ??
    defaultMarkDeletionRequested(client as SupabaseClient)
  const clearDeletionRequested = deps.clearDeletionRequested ??
    defaultClearDeletionRequested(client as SupabaseClient)
  const listCancelableReceipts = deps.listCancelableReceipts ??
    defaultListCancelableReceipts(client as SupabaseClient)
  const cancelStripeSubscription = deps.cancelStripeSubscription ?? defaultStripeCancel()
  const runCascade = deps.runCascade ?? defaultRunCascade(client as SupabaseClient)
  const deleteAuthUser = deps.deleteAuthUser ?? defaultDeleteAuthUser(client as SupabaseClient)
  const readSubscriptionTier = deps.readSubscriptionTier ??
    defaultReadSubscriptionTier(client as SupabaseClient)
  const emitServerEvent = deps.emitServerEvent ?? defaultEmitServerEvent

  // 4. Phase 0 — MARKER-FIRST. The dedicated pre-cancel marker write, ahead of
  // any provider call, so a crash from this point on is recoverable by the
  // sweep. A failure fails closed to 500 before anything external happened.
  const marked = await markDeletionRequested(callerUid)
  if (marked.error) {
    logError('account.delete.marker_error', { user_id: callerUid, outcome: 'marker_failed' })
    return err('could not begin account deletion', { code: 'internal', status: 500 })
  }

  // A PRE-CASCADE terminal failure must not leave the marker latched: the client
  // sees an error ("nothing happened"), but the sweep would otherwise finalize
  // the deletion ~1h later. So on every path that returns a non-ok response
  // BEFORE runCascade is invoked, clear the marker back to NULL first. A clear
  // failure is logged metadata-only and does NOT change the returned error (the
  // sweep's un-cancelled-billing gate makes a stuck marker safe for a
  // Stripe-billing user anyway). Once runCascade has run, the marker is NEVER
  // cleared — deletion is committed. A crash (no error path executed) also
  // intentionally leaves the marker set for the sweep to pick up.
  const clearMarkerBestEffort = async () => {
    const cleared = await clearDeletionRequested(callerUid)
    if (cleared.error) {
      logError('account.delete.marker_clear_error', {
        user_id: callerUid,
        outcome: 'marker_clear_failed',
        duration_ms: Date.now() - started,
      })
    }
  }

  // 5. Phase A — CANCEL, before any cascade mutation. Read the still-billing
  // receipts, cancel each Stripe one; apple/play require a native action.
  let receipts: CancelableReceipt[]
  try {
    receipts = await listCancelableReceipts(callerUid)
  } catch {
    logError('account.delete.receipts_lookup_error', { user_id: callerUid })
    await clearMarkerBestEffort()
    return err('could not read subscriptions', { code: 'internal', status: 500 })
  }

  let requiresNativeAction = false
  let cancelledCount = 0
  for (const receipt of receipts) {
    if (receipt.provider === 'stripe') {
      try {
        await cancelStripeSubscription(receipt.provider_subscription_id)
        cancelledCount += 1
      } catch (thrown) {
        if (thrown instanceof ReceiptValidationError) {
          // provider_resource_missing is the idempotent-cancel case: Stripe
          // already reports the subscription gone (e.g. a retry after a prior
          // cancel). That is SUCCESS — proceed to the cascade, do NOT abort.
          if (thrown.code === 'provider_resource_missing') {
            logInfo('account.delete.cancel_idempotent', {
              user_id: callerUid,
              provider: receipt.provider,
              code: thrown.code,
              duration_ms: Date.now() - started,
            })
            continue
          }
          // Any other typed error aborts BEFORE the cascade (the DB is still
          // untouched, so a retry can cascade later). Map on the fault
          // discriminator: an explicit status override, else 400 client / 502
          // provider.
          const status = thrown.status ?? (thrown.fault === 'client' ? 400 : 502)
          logError('account.delete.cancel_failed', {
            user_id: callerUid,
            provider: receipt.provider,
            code: thrown.code,
            fault: thrown.fault,
            duration_ms: Date.now() - started,
          })
          await clearMarkerBestEffort()
          return err(thrown.message, { code: thrown.code, status })
        }
        // An unexpected non-typed throw fails closed to 500, still before the
        // cascade (retryable — no DB mutation from this call).
        logError('account.delete.cancel_error', {
          user_id: callerUid,
          provider: receipt.provider,
          duration_ms: Date.now() - started,
        })
        await clearMarkerBestEffort()
        return err('subscription cancellation failed', { code: 'internal', status: 500 })
      }
    } else {
      // apple_iap / play_iap: NO provider call (no server cancel API). The
      // client deep-links native subscription management.
      requiresNativeAction = true
    }
  }

  // Capture the subscription tier BEFORE the cascade, which wipes the
  // users.subscription_tier column. Best-effort and metadata-only — a null /
  // absent row defaults to 'free'. This feeds the anonymized account_deleted
  // analytics event emitted after the deletion commits (below).
  let capturedTier = 'free'
  try {
    capturedTier = (await readSubscriptionTier(callerUid)) ?? 'free'
  } catch {
    logError('account.delete.tier_read_error', { user_id: callerUid })
    capturedTier = 'free'
  }

  // 6. Phase B — CASCADE. The atomic SECURITY DEFINER RPC. An error → 500
  // (retryable; the RPC is one transaction, so nothing is half-done). The
  // auth-delete is never attempted after a cascade failure.
  const cascaded = await runCascade(callerUid)
  if (cascaded.error) {
    logError('account.delete.cascade_error', {
      user_id: callerUid,
      outcome: 'cascade_failed',
      duration_ms: Date.now() - started,
    })
    return err('account deletion failed', { code: 'internal', status: 500 })
  }

  // 7. Phase C — AUTH FINALIZE, LAST. Remove the identity. ANY failure here
  // (a genuine GoTrue error, or a retry/concurrent invocation hitting an
  // already-removed identity) is logged metadata-only and does NOT fail the
  // request — the marker + retry sweep guarantee auth removal within the backstop
  // window, and the client still needs the ok to complete local cleanup.
  const authDeleted = await deleteAuthUser(callerUid)
  if (authDeleted.error) {
    logError('account.delete.auth_finalize_deferred', {
      user_id: callerUid,
      outcome: 'auth_delete_deferred',
      duration_ms: Date.now() - started,
    })
  }

  // Best-effort, fail-open product-analytics emit — AFTER the cascade committed
  // (deletion is done even if the auth-finalize step was deferred above). The
  // event carries ONLY the tier captured before the wipe; distinct_id is the
  // fixed SERVER_DISTINCT_ID, NEVER callerUid — account_deleted intentionally
  // retains no user id, so re-using the deleted user's id as the distinct id
  // would re-associate the event with them. Awaited but returns void and never
  // throws, so it cannot change the committed-deletion ok() response.
  await emitServerEvent('account_deleted', SERVER_DISTINCT_ID, { tier: capturedTier })

  logInfo('account.delete.ok', {
    user_id: callerUid,
    requires_native_subscription_action: requiresNativeAction,
    cancelled_count: cancelledCount,
    outcome: 'ok',
    duration_ms: Date.now() - started,
  })

  return ok({
    deleted_at: new Date().toISOString(),
    requires_native_subscription_action: requiresNativeAction,
  })
}

// Default marker write: the idempotent pre-cancel UPDATE. Only reached in
// production (tests inject markDeletionRequested).
function defaultMarkDeletionRequested(
  client: SupabaseClient,
): (userId: string) => Promise<{ error: unknown }> {
  return async (userId: string) => {
    const { error } = await client
      .from('users')
      .update({ deletion_requested_at: new Date().toISOString() })
      .eq('id', userId)
      .is('deletion_requested_at', null)
    return { error }
  }
}

// Default marker clear: the compensating reset back to NULL, run on a
// pre-cascade terminal failure so a client-visible error does not leave a latch
// the sweep would finalize. Scoped to a non-null marker so it only unsets a
// marker this invocation set. Only reached in production.
function defaultClearDeletionRequested(
  client: SupabaseClient,
): (userId: string) => Promise<{ error: unknown }> {
  return async (userId: string) => {
    const { error } = await client
      .from('users')
      .update({ deletion_requested_at: null })
      .eq('id', userId)
      .not('deletion_requested_at', 'is', null)
    return { error }
  }
}

// Default receipt read: the caller's still-billing rows (the states that may
// still charge — 'pending'/incomplete included so a not-yet-collected sub that
// could activate post-deletion is cancelled/voided too). Only reached in
// production.
function defaultListCancelableReceipts(
  client: SupabaseClient,
): (userId: string) => Promise<CancelableReceipt[]> {
  return async (userId: string) => {
    const { data, error } = await client
      .from('subscription_receipts')
      .select('provider, provider_subscription_id')
      .eq('user_id', userId)
      .in('status', ['active', 'past_due', 'pending'])
    if (error) {
      throw error
    }
    return (data ?? []) as CancelableReceipt[]
  }
}

// Default cascade dispatch: the atomic SECURITY DEFINER RPC. Only reached in
// production.
function defaultRunCascade(
  client: SupabaseClient,
): (userId: string) => Promise<{ error: unknown }> {
  return async (userId: string) => {
    const { error } = await client.rpc('delete_my_account', { p_user_id: userId })
    return { error }
  }
}

// Default subscription-tier read: the caller's users.subscription_tier, read
// BEFORE the cascade wipes it. A missing row or a query error resolves to null
// (the handler defaults it to 'free'). Only reached in production.
function defaultReadSubscriptionTier(
  client: SupabaseClient,
): (userId: string) => Promise<string | null> {
  return async (userId: string) => {
    const { data, error } = await client
      .from('users')
      .select('subscription_tier')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      return null
    }
    return (data as { subscription_tier?: string | null } | null)?.subscription_tier ?? null
  }
}

// Default auth finalize: the elevated admin call authorized by the service-role
// key. Only reached in production.
function defaultDeleteAuthUser(
  client: SupabaseClient,
): (userId: string) => Promise<{ error: unknown }> {
  return async (userId: string) => {
    const { error } = await client.auth.admin.deleteUser(userId)
    return { error }
  }
}

// Production Stripe dispatch: build the shared thin fetch adapter from the
// env-provisioned STRIPE_SECRET_KEY and cancel-at-period-end via the shared
// helper. Tests inject deps.cancelStripeSubscription and never reach this.
function defaultStripeCancel(): (id: string) => Promise<{ current_period_end: string }> {
  return (id: string) => {
    const secretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
    // An unset/empty key would produce `Authorization: Bearer ` and a Stripe
    // 401, which the fault mapping would misreport as a provider outage. This
    // is OUR misconfiguration — fail closed to a config 500 BEFORE any network
    // call (status override, since the fault union has no config member).
    if (secretKey.trim() === '') {
      throw new ReceiptValidationError('account deletion is not configured', {
        code: 'internal',
        fault: 'provider',
        status: 500,
      })
    }
    return cancelStripeSubscriptionAtPeriodEnd(id, { stripeClient: buildStripeClient(secretKey) })
  }
}

// Bind the server only as the program entry point (the Edge Runtime runs this
// as main). Guarded so `deno test` can import the handler without a listener.
if (import.meta.main) {
  Deno.serve((req) => handler(req))
}
