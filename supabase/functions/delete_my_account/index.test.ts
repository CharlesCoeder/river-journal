// Deno unit tests for the delete_my_account handler -- the THIRD user-JWT-
// authenticated function in this repo (subscription_validate_receipt was the
// first, subscription_cancel the second). Every trigger/cron function stays
// service-role-bearer context; billing_events is the one public-webhook
// posture. This function shares subscription_cancel's user-JWT posture.
//
// Run locally with: deno test --allow-env --allow-net supabase/functions/
//
// NOT wired into `yarn vitest` -- supabase/functions/** is excluded from the
// root vitest.config.mts glob (Deno 2 code: URL/npm:/jsr: imports, Deno.*
// globals). This file is `deno test`-only.
//
// Contract pinned down here (inferred from the acceptance criteria, mirroring
// how subscription_cancel's test file pinned its own inferred contract):
//
//   handler(req: Request, deps: HandlerDeps = {}): Promise<Response>
//
//   HandlerDeps = {
//     client?: SupabaseClient -- falls back to createServiceRoleClient(); only
//       ever consulted to build the DEFAULT implementation of the seams below
//       when a given seam is not explicitly overridden. Every test in this
//       file overrides every DB-touching seam individually except the
//       misconfigured-env test, so `client`/`createServiceRoleClient()` is
//       never actually reached except there.
//     resolveUser?: (req) => Promise<{ id: string } | null> -- falls back to
//       getAuthenticatedUser(req).
//     markDeletionRequested?: (userId) => Promise<{ error: unknown }> -- the
//       dedicated PRE-CANCEL marker write (marker-first recoverability): sets
//       users.deletion_requested_at as the VERY FIRST db write, ahead of any
//       provider call, so a crash from this point on is recoverable by the
//       retry sweep. Idempotent (WHERE deletion_requested_at IS NULL).
//     clearDeletionRequested?: (userId) => Promise<{ error: unknown }> -- the
//       compensating marker CLEAR (resets deletion_requested_at to NULL). Called
//       on every PRE-CASCADE terminal failure (before runCascade), so a
//       client-visible error does not leave a latch the sweep would finalize. A
//       clear failure is logged metadata-only and does NOT change the returned
//       error. NEVER called once runCascade has been invoked (deletion committed).
//     listCancelableReceipts?: (userId) => Promise<Array<{ provider: 'stripe'
//       | 'apple_iap' | 'play_iap', provider_subscription_id: string }>> --
//       the still-billing rows (status IN ('active','past_due')) for the
//       caller, read BEFORE the cascade deletes them.
//     cancelStripeSubscription?: (id) => Promise<{ current_period_end:
//       string }> -- falls back to the real Stripe dispatch built from
//       STRIPE_SECRET_KEY (the SAME shared helper subscription_cancel calls).
//       Injected so handler-logic tests never fake live Stripe HTTP traffic.
//     runCascade?: (userId) => Promise<{ error: unknown }> -- wraps
//       client.rpc('delete_my_account', { p_user_id: userId }), the single
//       atomic DB-side cascade.
//     deleteAuthUser?: (userId) => Promise<{ error: unknown }> -- wraps
//       client.auth.admin.deleteUser(userId), the LAST step.
//   }
//
//   Flow (phase-ordered -- every phase-ordering assertion in this file exists
//   because a crash between any two phases must leave the system in a
//   recoverable state):
//
//   1. Identity -- resolveUser(req) -> null => 401 unauthorized, BEFORE any
//      DB or provider call.
//
//   2. Body -- read once; a defensive MAX_BODY_BYTES cap rejects a grossly
//      oversized body with 400, BEFORE any DB or provider call. The body is
//      NEVER parsed for fields -- this action needs no client-supplied input,
//      and per the never-trust-the-client invariant a client-supplied
//      `user_id` (or any other field) would be ignored even if read. A
//      missing body, an empty body, and a non-JSON body are all equally fine.
//
//   3. Client/seam init -- deps.client ?? createServiceRoleClient() (wrapped
//      so a misconfigured env returns a 500 envelope, never an uncaught
//      throw), used ONLY to build the default implementation of any seam not
//      explicitly overridden.
//
//   4. Phase 0 -- MARKER-FIRST. markDeletionRequested(callerUid) is the VERY
//      FIRST db write, ahead of Phase A. An error here fails closed to 500
//      BEFORE any provider call or cascade (nothing external has happened
//      yet, so this is trivially retryable).
//
//   5. Phase A -- CANCEL (before any cascade mutation). Read
//      listCancelableReceipts(callerUid) -- a THROW here (receipts lookup
//      failure) is a pre-cascade terminal failure: the marker is cleared, then
//      500. For each row:
//        - provider 'stripe': cancelStripeSubscription(provider_subscription_id).
//          A thrown ReceiptValidationError with code 'provider_resource_missing'
//          (the idempotent-cancel case -- Stripe already reports the
//          subscription gone, e.g. a retry after a prior cancel) is SUCCESS,
//          not a hard failure -- the saga proceeds to Phase B. Any OTHER
//          typed error (fault-mapped: status override, else 400 client / 502
//          provider) or an unexpected non-typed throw ABORTS the saga BEFORE
//          Phase B runs (retryable; no DB mutation from this call). Every such
//          pre-cascade abort clears the marker (clearDeletionRequested) BEFORE
//          returning; a clear failure is logged metadata-only and the ORIGINAL
//          error is still returned.
//        - provider 'apple_iap' | 'play_iap': NO provider call at all;
//          requiresNativeAction is set true.
//      requiresNativeAction is true iff AT LEAST ONE cancelled receipt was
//      apple_iap/play_iap.
//
//   6. Phase B -- CASCADE. runCascade(callerUid) (the atomic SECURITY DEFINER
//      RPC). An error -> 500 (retryable; the RPC is one transaction, so
//      nothing is half-done). deleteAuthUser is NEVER called after a Phase B
//      failure.
//
//   7. Phase C -- AUTH FINALIZE, LAST. deleteAuthUser(callerUid). ANY failure
//      here (a genuine GoTrue error, OR a retry/concurrent invocation hitting
//      an identity a prior invocation already removed) is logged
//      metadata-only and does NOT fail the request -- the deletion_requested_at
//      marker + the retry sweep are the backstop (NFR14). The handler STILL
//      returns ok.
//
//   8. Success -> ok({ deleted_at: <ISO-8601 string, now>,
//      requires_native_subscription_action: boolean }). Nothing else is in
//      the body.
//
//   Never-trust-the-client: every phase scopes to the JWT-resolved callerUid.
//   A client-supplied user_id anywhere in the body has zero effect on which
//   id any seam is invoked with.
//
//   Logging: logInfo/logError metadata only (user_id, per-step outcome
//   markers, counts, duration_ms) -- explicit assertions prove no captured
//   console.log/console.error line ever carries an unexpected field.
//
// Red phase: ./index.ts does not exist yet, so every test in this file fails
// at import resolution before a single assertion runs.

import { assertEquals } from 'jsr:@std/assert@1'
import { ReceiptValidationError } from '../_shared/billing/types.ts'
import { handler } from './index.ts'

const CALLER_UID = '00000000-0000-0000-0000-0000000000f1'
const FOREIGN_UID = '00000000-0000-0000-0000-0000000000f2'
const STRIPE_SUBSCRIPTION_ID = 'sub_test0000000000000003'
const PROVIDER_FRESH_PERIOD_END = '2026-09-01T00:00:00.000Z'

function requestFor(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/delete_my_account', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer user-jwt-placeholder',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
  })
}

function requestWithNoBody(): Request {
  return new Request('http://localhost/delete_my_account', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-jwt-placeholder' },
  })
}

function requestWithNoAuthHeader(body: unknown = {}): Request {
  return new Request('http://localhost/delete_my_account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function resolveCaller(): Promise<{ id: string } | null> {
  return Promise.resolve({ id: CALLER_UID })
}

function neverConfiguredClient(): unknown {
  return {
    from(table: string) {
      throw new Error(`unexpected table access ("${table}")`)
    },
    rpc(fn: string) {
      throw new Error(`unexpected rpc call ("${fn}")`)
    },
    auth: {
      admin: {
        deleteUser() {
          throw new Error('unexpected auth.admin.deleteUser call')
        },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Refusing seam stubs -- each throws loudly if invoked, so a phase-ordering or
// abort-before-mutation test fails clearly rather than silently passing.
// ---------------------------------------------------------------------------

function refusingMark() {
  return (): Promise<{ error: unknown }> => {
    throw new Error('markDeletionRequested must never be called for this test')
  }
}

function refusingListReceipts() {
  return (): Promise<Array<{ provider: string; provider_subscription_id: string }>> => {
    throw new Error('listCancelableReceipts must never be called for this test')
  }
}

function refusingClear() {
  return (): Promise<{ error: unknown }> => {
    throw new Error('clearDeletionRequested must never be called for this test')
  }
}

function refusingCancel() {
  return (): Promise<{ current_period_end: string }> => {
    throw new Error('cancelStripeSubscription must never be called for this test')
  }
}

function refusingCascade() {
  return (): Promise<{ error: unknown }> => {
    throw new Error('runCascade must never be called for this test')
  }
}

function refusingDeleteAuthUser() {
  return (): Promise<{ error: unknown }> => {
    throw new Error('deleteAuthUser must never be called for this test')
  }
}

// A no-op success stub for a seam whose invocation is expected but whose
// return value is irrelevant to the assertion at hand.
function okMark(onCall?: (userId: string) => void) {
  return (userId: string): Promise<{ error: unknown }> => {
    onCall?.(userId)
    return Promise.resolve({ error: null })
  }
}

function okClear(onCall?: (userId: string) => void) {
  return (userId: string): Promise<{ error: unknown }> => {
    onCall?.(userId)
    return Promise.resolve({ error: null })
  }
}

function okCascade(onCall?: (userId: string) => void) {
  return (userId: string): Promise<{ error: unknown }> => {
    onCall?.(userId)
    return Promise.resolve({ error: null })
  }
}

function okDeleteAuthUser(onCall?: (userId: string) => void) {
  return (userId: string): Promise<{ error: unknown }> => {
    onCall?.(userId)
    return Promise.resolve({ error: null })
  }
}

// A full, all-seams-overridden "happy path" deps builder, so individual tests
// only need to override the one or two seams relevant to what they assert.
function happyPathDeps(overrides: Record<string, unknown> = {}) {
  return {
    resolveUser: resolveCaller,
    markDeletionRequested: okMark(),
    // The happy path and every post-cascade path must NEVER clear the marker;
    // a refusing stub makes an errant clear fail loudly. Pre-cascade-failure
    // tests override this with a capturing okClear().
    clearDeletionRequested: refusingClear(),
    listCancelableReceipts: () => Promise.resolve([]),
    cancelStripeSubscription: refusingCancel(),
    runCascade: okCascade(),
    deleteAuthUser: okDeleteAuthUser(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Auth -- user-JWT identity, BEFORE any DB or provider call.
// ---------------------------------------------------------------------------

Deno.test('handler returns 401 when no Authorization header is present, before any client or provider call', async () => {
  const response = await handler(requestWithNoAuthHeader(), {
    client: neverConfiguredClient() as never,
    markDeletionRequested: refusingMark(),
    listCancelableReceipts: refusingListReceipts(),
    cancelStripeSubscription: refusingCancel(),
    runCascade: refusingCascade(),
    deleteAuthUser: refusingDeleteAuthUser(),
  })
  assertEquals(response.status, 401)
  const body = await response.json()
  assertEquals(typeof body.error, 'string')
})

Deno.test('handler returns 401 when resolveUser resolves to null (invalid/expired JWT), before any client or provider call', async () => {
  const response = await handler(requestFor({}), {
    resolveUser: () => Promise.resolve(null),
    client: neverConfiguredClient() as never,
    markDeletionRequested: refusingMark(),
    listCancelableReceipts: refusingListReceipts(),
    cancelStripeSubscription: refusingCancel(),
    runCascade: refusingCascade(),
    deleteAuthUser: refusingDeleteAuthUser(),
  })
  assertEquals(response.status, 401)
})

// ---------------------------------------------------------------------------
// Body -- defensive size cap only; content is never parsed or consumed.
// ---------------------------------------------------------------------------

Deno.test('handler returns 400 for a grossly oversized body, before any DB or provider call', async () => {
  const hugePadding = 'x'.repeat(5_000_000)
  const response = await handler(requestFor({ padding: hugePadding }), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    markDeletionRequested: refusingMark(),
    listCancelableReceipts: refusingListReceipts(),
    cancelStripeSubscription: refusingCancel(),
    runCascade: refusingCascade(),
    deleteAuthUser: refusingDeleteAuthUser(),
  })
  assertEquals(response.status, 400)
})

Deno.test('handler succeeds with NO request body at all -- nothing is read from it', async () => {
  const response = await handler(requestWithNoBody(), happyPathDeps())
  assertEquals(response.status, 200)
})

Deno.test('handler succeeds with a non-JSON body -- the body is never parsed, only size-capped', async () => {
  const request = new Request('http://localhost/delete_my_account', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-jwt-placeholder' },
    body: 'this is not json at all',
  })
  const response = await handler(request, happyPathDeps())
  assertEquals(response.status, 200)
})

// ---------------------------------------------------------------------------
// Phase ordering -- marker-first, cancel-before-mutation, auth-delete last.
// Each assertion here exists because a crash between phases must leave a
// recoverable state (marker set before the irreversible external cancel;
// cascade only after cancellation; identity removal only after the atomic
// cascade committed).
// ---------------------------------------------------------------------------

Deno.test('marker-first: markDeletionRequested is called BEFORE cancelStripeSubscription (recoverability ordering)', async () => {
  const callOrder: string[] = []
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      markDeletionRequested: okMark(() => callOrder.push('mark')),
      listCancelableReceipts: () =>
        Promise.resolve([{ provider: 'stripe', provider_subscription_id: STRIPE_SUBSCRIPTION_ID }]),
      cancelStripeSubscription: () => {
        callOrder.push('cancel')
        return Promise.resolve({ current_period_end: PROVIDER_FRESH_PERIOD_END })
      },
      runCascade: okCascade(() => callOrder.push('cascade')),
      deleteAuthUser: okDeleteAuthUser(() => callOrder.push('auth_delete')),
    }),
  )
  assertEquals(response.status, 200)
  assertEquals(callOrder, ['mark', 'cancel', 'cascade', 'auth_delete'])
})

Deno.test('cancel-before-mutation: cancellation (Phase A) completes before the cascade RPC (Phase B) runs', async () => {
  const callOrder: string[] = []
  await handler(
    requestFor({}),
    happyPathDeps({
      markDeletionRequested: okMark(),
      listCancelableReceipts: () =>
        Promise.resolve([{ provider: 'apple_iap', provider_subscription_id: 'apple-tx-001' }]),
      cancelStripeSubscription: refusingCancel(),
      runCascade: okCascade(() => callOrder.push('cascade')),
      deleteAuthUser: okDeleteAuthUser(() => callOrder.push('auth_delete')),
    }),
  )
  assertEquals(callOrder, ['cascade', 'auth_delete'])
})

Deno.test('auth-delete-last: deleteAuthUser is called strictly AFTER runCascade resolves', async () => {
  const callOrder: string[] = []
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      markDeletionRequested: okMark(),
      runCascade: okCascade(() => callOrder.push('cascade')),
      deleteAuthUser: okDeleteAuthUser(() => callOrder.push('auth_delete')),
    }),
  )
  assertEquals(response.status, 200)
  assertEquals(callOrder, ['cascade', 'auth_delete'])
})

// ---------------------------------------------------------------------------
// Marker-write failure -- fails closed BEFORE any provider call or cascade.
// ---------------------------------------------------------------------------

Deno.test('handler returns 500 when the pre-cancel marker write fails, before any provider call or cascade', async () => {
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      markDeletionRequested: () => Promise.resolve({ error: { message: 'connection reset' } }),
      listCancelableReceipts: refusingListReceipts(),
      cancelStripeSubscription: refusingCancel(),
      runCascade: refusingCascade(),
      deleteAuthUser: refusingDeleteAuthUser(),
    }),
  )
  assertEquals(response.status, 500)
})

// ---------------------------------------------------------------------------
// Happy path -- Stripe, apple_iap, play_iap, mixed, and zero-receipts.
// ---------------------------------------------------------------------------

Deno.test('happy path: an active Stripe receipt is cancelled, the cascade runs, auth is deleted, and requires_native_subscription_action is false', async () => {
  let cancelledId: string | null = null
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      listCancelableReceipts: () =>
        Promise.resolve([{ provider: 'stripe', provider_subscription_id: STRIPE_SUBSCRIPTION_ID }]),
      cancelStripeSubscription: (id: string) => {
        cancelledId = id
        return Promise.resolve({ current_period_end: PROVIDER_FRESH_PERIOD_END })
      },
    }),
  )
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.ok, true)
  assertEquals(body.requires_native_subscription_action, false)
  assertEquals(typeof body.deleted_at, 'string')
  assertEquals(cancelledId, STRIPE_SUBSCRIPTION_ID)
})

Deno.test('an apple_iap receipt: NO provider call is made, and requires_native_subscription_action is true', async () => {
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      listCancelableReceipts: () =>
        Promise.resolve([{ provider: 'apple_iap', provider_subscription_id: 'apple-tx-002' }]),
      cancelStripeSubscription: refusingCancel(),
    }),
  )
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.requires_native_subscription_action, true)
})

Deno.test('a play_iap receipt: NO provider call is made, and requires_native_subscription_action is true', async () => {
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      listCancelableReceipts: () =>
        Promise.resolve([{ provider: 'play_iap', provider_subscription_id: 'play-token-002' }]),
      cancelStripeSubscription: refusingCancel(),
    }),
  )
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.requires_native_subscription_action, true)
})

Deno.test('a mix of a cancelled Stripe receipt and an apple_iap receipt: Stripe IS cancelled AND requires_native_subscription_action is true', async () => {
  let stripeCancelled = false
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      listCancelableReceipts: () =>
        Promise.resolve([
          { provider: 'stripe', provider_subscription_id: STRIPE_SUBSCRIPTION_ID },
          { provider: 'apple_iap', provider_subscription_id: 'apple-tx-003' },
        ]),
      cancelStripeSubscription: () => {
        stripeCancelled = true
        return Promise.resolve({ current_period_end: PROVIDER_FRESH_PERIOD_END })
      },
    }),
  )
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(stripeCancelled, true)
  assertEquals(body.requires_native_subscription_action, true)
})

Deno.test('zero cancelable receipts: the marker, cascade, and auth-delete phases still all run, and requires_native_subscription_action is false', async () => {
  const callOrder: string[] = []
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      markDeletionRequested: okMark(() => callOrder.push('mark')),
      listCancelableReceipts: () => Promise.resolve([]),
      runCascade: okCascade(() => callOrder.push('cascade')),
      deleteAuthUser: okDeleteAuthUser(() => callOrder.push('auth_delete')),
    }),
  )
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.requires_native_subscription_action, false)
  assertEquals(callOrder, ['mark', 'cascade', 'auth_delete'])
})

// ---------------------------------------------------------------------------
// Data-rights are unconditional -- nothing gates on suspension state. The
// handler never reads user_suspensions / moderation_actions at all, so a
// suspended caller with open moderation actions deletes exactly like any
// other caller (there is no separate code path to exercise -- this test
// documents and pins the absence of any such gate).
// ---------------------------------------------------------------------------

Deno.test('a suspended user (or one with open moderation actions) still deletes -- deletion is unconditional (GDPR/CCPA), no suspension gate exists', async () => {
  const response = await handler(requestFor({}), happyPathDeps())
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.ok, true)
})

// ---------------------------------------------------------------------------
// Subscription cancellation faults -- a hard failure aborts BEFORE the
// cascade; the idempotent-cancel case (provider_resource_missing) proceeds.
// ---------------------------------------------------------------------------

Deno.test('a Stripe-cancel HARD failure (untyped throw) aborts the saga BEFORE the cascade runs -- retryable, no DB mutation from the cascade', async () => {
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      listCancelableReceipts: () =>
        Promise.resolve([{ provider: 'stripe', provider_subscription_id: STRIPE_SUBSCRIPTION_ID }]),
      cancelStripeSubscription: () => Promise.reject(new Error('unexpected SDK crash')),
      clearDeletionRequested: okClear(),
      runCascade: refusingCascade(),
      deleteAuthUser: refusingDeleteAuthUser(),
    }),
  )
  assertEquals(response.status, 500)
})

Deno.test('a Stripe-cancel typed failure OTHER than provider_resource_missing (e.g. provider_cancel_failed) aborts BEFORE the cascade, mapped via its fault', async () => {
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      listCancelableReceipts: () =>
        Promise.resolve([{ provider: 'stripe', provider_subscription_id: STRIPE_SUBSCRIPTION_ID }]),
      cancelStripeSubscription: () =>
        Promise.reject(
          new ReceiptValidationError('stripe could not cancel the subscription', {
            code: 'provider_cancel_failed',
            fault: 'provider',
          }),
        ),
      clearDeletionRequested: okClear(),
      runCascade: refusingCascade(),
      deleteAuthUser: refusingDeleteAuthUser(),
    }),
  )
  assertEquals(response.status >= 500, true)
})

Deno.test('a Stripe-cancel typed failure honors an explicit status override (e.g. 502 provider-contract violation), still BEFORE the cascade', async () => {
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      listCancelableReceipts: () =>
        Promise.resolve([{ provider: 'stripe', provider_subscription_id: STRIPE_SUBSCRIPTION_ID }]),
      cancelStripeSubscription: () =>
        Promise.reject(
          new ReceiptValidationError('provider returned a contract-violating payload', {
            code: 'provider_contract_violation',
            fault: 'provider',
            status: 502,
          }),
        ),
      clearDeletionRequested: okClear(),
      runCascade: refusingCascade(),
      deleteAuthUser: refusingDeleteAuthUser(),
    }),
  )
  assertEquals(response.status, 502)
})

Deno.test('an already-cancelled/missing Stripe subscription (provider_resource_missing) does NOT abort -- it proceeds to the cascade (idempotent-cancel path)', async () => {
  let cascadeRan = false
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      listCancelableReceipts: () =>
        Promise.resolve([{ provider: 'stripe', provider_subscription_id: STRIPE_SUBSCRIPTION_ID }]),
      cancelStripeSubscription: () =>
        Promise.reject(
          new ReceiptValidationError('stripe reports no matching subscription to cancel', {
            code: 'provider_resource_missing',
            fault: 'client',
            status: 404,
          }),
        ),
      runCascade: okCascade(() => {
        cascadeRan = true
      }),
    }),
  )
  assertEquals(response.status, 200)
  assertEquals(cascadeRan, true)
  const body = await response.json()
  assertEquals(body.ok, true)
})

// ---------------------------------------------------------------------------
// Cascade (Phase B) failure -- 500, retryable, auth-delete never attempted.
// ---------------------------------------------------------------------------

Deno.test('handler returns 500 when the cascade RPC errors, and deleteAuthUser is never called (nothing half-done -- the RPC is atomic)', async () => {
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      runCascade: () => Promise.resolve({ error: { message: 'deadlock detected' } }),
      deleteAuthUser: refusingDeleteAuthUser(),
    }),
  )
  assertEquals(response.status, 500)
})

// ---------------------------------------------------------------------------
// Auth finalize (Phase C) failure -- still returns ok; the marker + sweep are
// the backstop. Covers BOTH a genuine GoTrue failure AND a retry/concurrent
// invocation hitting an already-removed identity.
// ---------------------------------------------------------------------------

Deno.test('an auth-admin deleteUser failure AFTER a committed cascade still returns ok (the deletion_requested_at marker + retry sweep are the backstop)', async () => {
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      deleteAuthUser: () => Promise.resolve({ error: { message: 'gotrue unavailable' } }),
    }),
  )
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.ok, true)
})

Deno.test('a second (concurrent/retry) invocation whose auth-delete hits an already-removed identity still returns ok', async () => {
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      deleteAuthUser: () => Promise.resolve({ error: { message: 'User not found', status: 404 } }),
    }),
  )
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.ok, true)
})

// ---------------------------------------------------------------------------
// Marker-clear on PRE-CASCADE terminal failures -- deletion_requested_at is
// written marker-first (Phase 0); any failure BEFORE runCascade returns an
// error to the client ("nothing happened"), so the marker must be cleared
// back to NULL first or the sweep would silently finalize the deletion ~1h
// later (a one-way latch). Once runCascade has been invoked the marker is
// NEVER cleared -- deletion is committed.
// ---------------------------------------------------------------------------

Deno.test('a Stripe-cancel HARD failure clears the deletion marker BEFORE returning the error (no one-way latch)', async () => {
  let clearedId: string | null = null
  const callOrder: string[] = []
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      listCancelableReceipts: () =>
        Promise.resolve([{ provider: 'stripe', provider_subscription_id: STRIPE_SUBSCRIPTION_ID }]),
      cancelStripeSubscription: () => {
        callOrder.push('cancel')
        return Promise.reject(new Error('unexpected SDK crash'))
      },
      clearDeletionRequested: okClear((id) => {
        clearedId = id
        callOrder.push('clear')
      }),
      runCascade: refusingCascade(),
      deleteAuthUser: refusingDeleteAuthUser(),
    }),
  )
  assertEquals(response.status, 500)
  assertEquals(clearedId, CALLER_UID)
  // The clear happens AFTER the failed cancel and BEFORE the error return.
  assertEquals(callOrder, ['cancel', 'clear'])
})

Deno.test('a Stripe-cancel typed failure (other than provider_resource_missing) clears the deletion marker before returning the mapped error', async () => {
  let cleared = false
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      listCancelableReceipts: () =>
        Promise.resolve([{ provider: 'stripe', provider_subscription_id: STRIPE_SUBSCRIPTION_ID }]),
      cancelStripeSubscription: () =>
        Promise.reject(
          new ReceiptValidationError('stripe could not cancel the subscription', {
            code: 'provider_cancel_failed',
            fault: 'provider',
          }),
        ),
      clearDeletionRequested: okClear(() => {
        cleared = true
      }),
      runCascade: refusingCascade(),
      deleteAuthUser: refusingDeleteAuthUser(),
    }),
  )
  assertEquals(response.status >= 500, true)
  assertEquals(cleared, true)
})

Deno.test('a receipts-list failure clears the deletion marker BEFORE returning the 500', async () => {
  let clearedId: string | null = null
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      listCancelableReceipts: () => Promise.reject(new Error('db unreachable')),
      clearDeletionRequested: okClear((id) => {
        clearedId = id
      }),
      cancelStripeSubscription: refusingCancel(),
      runCascade: refusingCascade(),
      deleteAuthUser: refusingDeleteAuthUser(),
    }),
  )
  assertEquals(response.status, 500)
  assertEquals(clearedId, CALLER_UID)
})

Deno.test('the marker is NOT cleared once the cascade has run -- a Phase B (cascade) failure returns 500 without clearing (deletion is committed at runCascade)', async () => {
  // clearDeletionRequested stays the refusingClear() from happyPathDeps: it
  // throws if invoked, so this test fails loudly if the cascade-failure path
  // ever tries to clear the marker.
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      runCascade: () => Promise.resolve({ error: { message: 'deadlock detected' } }),
      deleteAuthUser: refusingDeleteAuthUser(),
    }),
  )
  assertEquals(response.status, 500)
})

Deno.test('the marker is NOT cleared on a post-cascade auth-finalize failure -- the response is still ok and clear is never invoked', async () => {
  // refusingClear() (from happyPathDeps) would throw if the auth-finalize path
  // tried to clear the marker; it must not, because the cascade already ran.
  const response = await handler(
    requestFor({}),
    happyPathDeps({
      deleteAuthUser: () => Promise.resolve({ error: { message: 'gotrue unavailable' } }),
    }),
  )
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.ok, true)
})

Deno.test('a marker-clear FAILURE on a pre-cascade abort still returns the ORIGINAL error and logs metadata-only (the sweep gate makes a stuck marker safe)', async () => {
  const capture = captureConsole()
  let response: Response
  try {
    response = await handler(
      requestFor({}),
      happyPathDeps({
        listCancelableReceipts: () =>
          Promise.resolve([{
            provider: 'stripe',
            provider_subscription_id: STRIPE_SUBSCRIPTION_ID,
          }]),
        cancelStripeSubscription: () =>
          Promise.reject(
            new ReceiptValidationError('provider returned a contract-violating payload', {
              code: 'provider_contract_violation',
              fault: 'provider',
              status: 502,
            }),
          ),
        clearDeletionRequested: () =>
          Promise.resolve({ error: { message: 'connection reset', stack: 'at fakeStack()' } }),
        runCascade: refusingCascade(),
        deleteAuthUser: refusingDeleteAuthUser(),
      }),
    )
  } finally {
    capture.restore()
  }
  // The clear failed, but the ORIGINAL cancel error (502) is what the client sees.
  assertEquals(response.status, 502)
  for (const line of capture.lines) {
    assertEquals(line.includes('fakeStack'), false, `leaked a stack fragment: ${line}`)
    const parsed = JSON.parse(line)
    const fieldKeys = Object.keys(parsed.fields ?? {})
    for (const key of fieldKeys) {
      assertEquals(
        ALLOWED_LOG_FIELD_KEYS.has(key),
        true,
        `unexpected log field key "${key}" in line: ${line}`,
      )
    }
  }
})

// ---------------------------------------------------------------------------
// Never-trust-the-client -- every seam is invoked with the JWT-resolved
// callerUid, never a client-supplied value.
// ---------------------------------------------------------------------------

Deno.test('handler ignores a client-supplied user_id -- every seam is invoked with the JWT-resolved callerUid', async () => {
  const observedIds = new Set<string>()
  const response = await handler(
    requestFor({ user_id: FOREIGN_UID }),
    happyPathDeps({
      markDeletionRequested: okMark((id) => observedIds.add(id)),
      listCancelableReceipts: (id: string) => {
        observedIds.add(id)
        return Promise.resolve([])
      },
      runCascade: okCascade((id) => observedIds.add(id)),
      deleteAuthUser: okDeleteAuthUser((id) => observedIds.add(id)),
    }),
  )
  assertEquals(response.status, 200)
  assertEquals(Array.from(observedIds), [CALLER_UID])
})

Deno.test('handler ignores unknown extra body fields entirely', async () => {
  const response = await handler(
    requestFor({ some_unrelated_field: 'irrelevant', nested: { a: 1 } }),
    happyPathDeps(),
  )
  assertEquals(response.status, 200)
})

// ---------------------------------------------------------------------------
// Response shape -- exactly { ok, deleted_at, requires_native_subscription_action }.
// ---------------------------------------------------------------------------

Deno.test('success response is exactly { ok, deleted_at, requires_native_subscription_action } and nothing else', async () => {
  const response = await handler(requestFor({}), happyPathDeps())
  const body = await response.json()
  assertEquals(
    Object.keys(body).sort(),
    ['deleted_at', 'ok', 'requires_native_subscription_action'],
  )
})

Deno.test('deleted_at is a fresh ISO-8601 timestamp close to the moment of the call', async () => {
  const before = Date.now()
  const response = await handler(requestFor({}), happyPathDeps())
  const after = Date.now()
  const body = await response.json()
  const deletedAtMs = new Date(body.deleted_at).getTime()
  assertEquals(Number.isNaN(deletedAtMs), false)
  assertEquals(deletedAtMs >= before && deletedAtMs <= after, true)
})

// ---------------------------------------------------------------------------
// Logging -- metadata-only (NFR19). No captured log line ever carries an
// unexpected field (no email, no free text, no raw exception).
// ---------------------------------------------------------------------------

const ALLOWED_LOG_FIELD_KEYS = new Set([
  'user_id',
  'duration_ms',
  'outcome',
  'requires_native_subscription_action',
  'cancelled_count',
  'provider',
  'code',
  'fault',
])

function captureConsole(): { lines: string[]; restore: () => void } {
  const originalLog = console.log
  const originalError = console.error
  const lines: string[] = []
  console.log = ((...args: unknown[]) => {
    lines.push(String(args[0] ?? ''))
  }) as typeof console.log
  console.error = ((...args: unknown[]) => {
    lines.push(String(args[0] ?? ''))
  }) as typeof console.error
  return {
    lines,
    restore: () => {
      console.log = originalLog
      console.error = originalError
    },
  }
}

Deno.test('a full success run logs metadata-only lines -- every field key is on the known-safe allow-list', async () => {
  const capture = captureConsole()
  try {
    await handler(
      requestFor({}),
      happyPathDeps({
        listCancelableReceipts: () =>
          Promise.resolve([{
            provider: 'stripe',
            provider_subscription_id: STRIPE_SUBSCRIPTION_ID,
          }]),
        cancelStripeSubscription: () =>
          Promise.resolve({ current_period_end: PROVIDER_FRESH_PERIOD_END }),
      }),
    )
  } finally {
    capture.restore()
  }
  for (const line of capture.lines) {
    const parsed = JSON.parse(line)
    const fieldKeys = Object.keys(parsed.fields ?? {})
    for (const key of fieldKeys) {
      assertEquals(
        ALLOWED_LOG_FIELD_KEYS.has(key),
        true,
        `unexpected log field key "${key}" in line: ${line}`,
      )
    }
  }
})

Deno.test('a cascade-failure run logs metadata-only lines and never echoes a raw error/stack/cause', async () => {
  const capture = captureConsole()
  let response: Response
  try {
    response = await handler(
      requestFor({}),
      happyPathDeps({
        runCascade: () =>
          Promise.resolve({ error: { message: 'db unreachable', stack: 'at fakeStack()' } }),
        deleteAuthUser: refusingDeleteAuthUser(),
      }),
    )
  } finally {
    capture.restore()
  }
  assertEquals(response.status, 500)
  for (const line of capture.lines) {
    assertEquals(line.includes('fakeStack'), false, `leaked a stack fragment: ${line}`)
    const parsed = JSON.parse(line)
    const fieldKeys = Object.keys(parsed.fields ?? {})
    for (const key of fieldKeys) {
      assertEquals(
        ALLOWED_LOG_FIELD_KEYS.has(key),
        true,
        `unexpected log field key "${key}" in line: ${line}`,
      )
    }
  }
})

Deno.test('the success response body never carries a stack, cause, or raw exception object', async () => {
  const response = await handler(requestFor({}), happyPathDeps())
  const raw = await response.text()
  assertEquals(raw.includes('stack'), false)
  assertEquals(raw.includes('cause'), false)
})

// ---------------------------------------------------------------------------
// Misconfigured environment -- fail-closed 500 envelope, never an uncaught
// throw. No seam is overridden here (mirrors subscription_cancel's
// misconfigured-env test) so the real createServiceRoleClient() path is hit.
// ---------------------------------------------------------------------------

Deno.test('handler returns a wrapped 500 error envelope (not an uncaught throw) when SUPABASE_URL is unset and no seam overrides are supplied', async () => {
  const originalUrl = Deno.env.get('SUPABASE_URL')
  Deno.env.delete('SUPABASE_URL')
  try {
    const response = await handler(requestFor({}), { resolveUser: resolveCaller })
    assertEquals(response.status, 500)
    const body = await response.json()
    assertEquals(typeof body.error, 'string')
  } finally {
    if (originalUrl === undefined) {
      Deno.env.delete('SUPABASE_URL')
    } else {
      Deno.env.set('SUPABASE_URL', originalUrl)
    }
  }
})
