// Deno unit tests for the subscription_cancel handler -- the SECOND
// user-JWT-authenticated function in this repo (subscription_validate_receipt
// was the first). Every prior Edge Function is service-role/trigger context.
//
// Run locally with: deno test --allow-env --allow-net supabase/functions/
//
// NOT wired into `yarn vitest` -- supabase/functions/** is excluded from the
// root vitest.config.mts glob (Deno 2 code: URL/npm:/jsr: imports, Deno.*
// globals). This file is `deno test`-only.
//
// Contract pinned down here (inferred from the acceptance criteria -- not
// verbatim named in the source spec, mirroring how subscription_validate_receipt's
// test file pinned its own inferred contract):
//
//   handler(req: Request, deps: HandlerDeps = {}): Promise<Response>
//
//   HandlerDeps = {
//     client?: SupabaseClient           -- falls back to createServiceRoleClient()
//     resolveUser?: (req) => Promise<{ id: string } | null>  -- falls back to
//       getAuthenticatedUser(req).
//     cancelStripeSubscription?: (id: string) =>
//       Promise<{ current_period_end: string }>  -- falls back to the real
//       Stripe dispatch built from STRIPE_SECRET_KEY. Injected so handler-logic
//       tests never fake live Stripe HTTP traffic -- that adapter-level
//       correctness lives in _shared/billing/stripe.test.ts.
//   }
//
//   Flow: resolveUser(req) -> null => 401 unauthorized (BEFORE any client or
//   provider call). Parse body as JSON -> 400 on failure (non-JSON, oversized
//   past a defensive MAX_BODY_BYTES cap, non-object/array). Validate `provider`
//   is EXACTLY one of 'stripe' | 'apple_iap' | 'play_iap' (no case-fold/trim)
//   and `subscription_id` is present and non-empty after trim -> 400 BEFORE any
//   DB or provider call. Any `user_id` (or other extra field) in the body is
//   NEVER read for scoping.
//
//   Ownership check (the inverse of the validate path -- the receipt MUST
//   already exist AND be owned by the caller): SELECT subscription_receipts
//   (user_id, current_period_end, raw_receipt) by
//   .eq('provider', provider).eq('provider_subscription_id', subscription_id)
//   .maybeSingle(). BOTH "no row" AND "row owned by a different user_id"
//   return the exact SAME generic response --
//   err('no active subscription found for this account',
//       { code: 'subscription_not_found', status: 404 }) -- no distinguishable
//   message/code/status between the two cases (no enumeration oracle). A real
//   id submitted under the WRONG provider literal (cross-provider id
//   confusion) simply misses the composite natural key and yields the SAME
//   generic 404. This denial is returned BEFORE any provider dispatch in every
//   branch.
//
//   Dispatch (cancel-at-period-end, NEVER immediate):
//     - stripe: call (deps.cancelStripeSubscription ?? the real dispatch)
//       (subscription_id). Success -> current_period_end is the FRESH value
//       read back from the provider; requires_native_action = false. A thrown
//       error with code 'provider_resource_missing' (a local-vs-provider
//       desync -- our DB says the user owns it, the provider says it's gone)
//       maps to the SAME generic 404 subscription_not_found as the ownership
//       check (never a distinguishable message, never a 502). Any OTHER typed
//       provider error maps via its fault discriminator (status override, else
//       400 for fault:'client' / 502 for fault:'provider'). An unexpected
//       (non-typed) throw -> 500.
//     - apple_iap / play_iap: NO provider call at all; current_period_end is
//       the STORED value from the ownership row (never re-fetched);
//       requires_native_action = true.
//
//   Write (owner-scoped, raw_receipt-merge, fail-closed on partial write):
//   .update(patch).eq('provider', provider).eq('provider_subscription_id',
//   subscription_id).eq('user_id', callerUid). `patch.raw_receipt` MERGES the
//   cancellation fields into the ownership row's existing raw_receipt object
//   (never overwrites it) -- `cancel_at_period_end: true`,
//   `requires_native_action`, plus `canceled_at` (stripe) OR
//   `cancellation_requested_at` (apple/play). ONLY the stripe patch also sets
//   `status: 'canceled'` -- apple/play leave `status` untouched (the
//   cancellation is not yet confirmed). An UPDATE error -> 500 (fail-closed --
//   the provider cancel may have already succeeded, so a partial write must
//   never report success).
//
//   Success -> ok({ current_period_end, requires_native_action }). The body
//   NEVER carries provider_subscription_id / raw_receipt / any provider PII.
//
//   Logging: logInfo/logError metadata only (user_id, provider, outcome,
//   requires_native_action, duration_ms) -- an explicit negative assertion
//   proves no captured console.log/console.error line, and no response body,
//   ever contains the submitted subscription_id.
//
// Red phase: ./index.ts does not exist yet, so every test in this file fails
// at import resolution before a single assertion runs.

import { assertEquals } from 'jsr:@std/assert@1'
import { ReceiptValidationError } from '../_shared/billing/types.ts'
import { handler } from './index.ts'

const CALLER_UID = '00000000-0000-0000-0000-0000000000e1'
const FOREIGN_UID = '00000000-0000-0000-0000-0000000000e2'
const STRIPE_SUBSCRIPTION_ID = 'sub_test0000000000000002'
const STORED_PERIOD_END = '2026-08-01T00:00:00.000Z'
const PROVIDER_FRESH_PERIOD_END = '2026-09-01T00:00:00.000Z'

function requestFor(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/subscription_cancel', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer user-jwt-placeholder',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function requestWithNoAuthHeader(body: unknown): Request {
  return new Request('http://localhost/subscription_cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'stripe',
    subscription_id: STRIPE_SUBSCRIPTION_ID,
    ...overrides,
  }
}

function resolveCaller(): Promise<{ id: string } | null> {
  return Promise.resolve({ id: CALLER_UID })
}

// A minimal fake client mirroring the subscription_validate_receipt
// buildMockClient idiom: every table access not explicitly configured throws,
// so an unexpected call surfaces as a loud test failure rather than a silent
// pass. subscription_cancel only ever touches subscription_receipts -- the
// users.subscription_tier flip is a separate, out-of-request pg_cron sweep,
// never written synchronously by this handler.
interface MockConfig {
  ownership?: { data: unknown; error: unknown }
  update?: { data: unknown; error: unknown }
  onUpdatePatch?: (patch: Record<string, unknown>) => void
}

function buildMockClient(config: MockConfig) {
  return {
    from(table: string) {
      if (table !== 'subscription_receipts') {
        throw new Error(`unexpected table access "${table}"`)
      }
      return {
        select(_cols: string) {
          return {
            eq(col1: string, val1: string) {
              assertEquals(col1, 'provider')
              return {
                eq(col2: string, val2: string) {
                  assertEquals(col2, 'provider_subscription_id')
                  void val1
                  void val2
                  return {
                    maybeSingle() {
                      if (!config.ownership) {
                        throw new Error('ownership lookup not configured for this test')
                      }
                      return Promise.resolve(config.ownership)
                    },
                  }
                },
              }
            },
          }
        },
        update(patch: Record<string, unknown>) {
          config.onUpdatePatch?.(patch)
          return {
            eq(colA: string, valA: string) {
              assertEquals(colA, 'provider')
              return {
                eq(colB: string, valB: string) {
                  assertEquals(colB, 'provider_subscription_id')
                  void valA
                  void valB
                  return {
                    eq(colC: string, valC: string) {
                      assertEquals(colC, 'user_id')
                      assertEquals(valC, CALLER_UID)
                      if (!config.update) {
                        throw new Error('receipt update not configured for this test')
                      }
                      return Promise.resolve(config.update)
                    },
                  }
                },
              }
            },
          }
        },
      }
    },
    // deno-lint-ignore no-explicit-any
  } as any
}

function neverConfiguredClient(): unknown {
  return {
    from(table: string) {
      throw new Error(`unexpected table access ("${table}")`)
    },
  }
}

function refusingCancel() {
  return () => {
    throw new Error('cancelStripeSubscription must never be called for this test')
  }
}

function ownedRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: CALLER_UID,
    current_period_end: STORED_PERIOD_END,
    raw_receipt: { plan: 'monthly' },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Auth -- user-JWT identity, BEFORE any DB or provider call.
// ---------------------------------------------------------------------------

Deno.test('handler returns 401 when no Authorization header is present, before any client or provider call', async () => {
  const response = await handler(requestWithNoAuthHeader(basePayload()), {
    client: neverConfiguredClient() as never,
    cancelStripeSubscription: refusingCancel(),
  })
  assertEquals(response.status, 401)
  const body = await response.json()
  assertEquals(typeof body.error, 'string')
})

Deno.test('handler returns 401 when resolveUser resolves to null (invalid/expired JWT), before any client or provider call', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: () => Promise.resolve(null),
    client: neverConfiguredClient() as never,
    cancelStripeSubscription: refusingCancel(),
  })
  assertEquals(response.status, 401)
})

// ---------------------------------------------------------------------------
// Input contract -- 400s BEFORE any DB or provider call.
// ---------------------------------------------------------------------------

Deno.test('handler returns 400 for a non-JSON body, before any DB or provider call', async () => {
  const request = new Request('http://localhost/subscription_cancel', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-jwt-placeholder' },
    body: 'not json',
  })
  const response = await handler(request, {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    cancelStripeSubscription: refusingCancel(),
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 for a grossly oversized body, before any DB or provider call', async () => {
  const hugeId = 'x'.repeat(5_000_000)
  const response = await handler(requestFor(basePayload({ subscription_id: hugeId })), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    cancelStripeSubscription: refusingCancel(),
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 for a non-object JSON body (array)', async () => {
  const response = await handler(requestFor([1, 2, 3]), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    cancelStripeSubscription: refusingCancel(),
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 when provider is missing', async () => {
  const response = await handler(
    requestFor({ subscription_id: STRIPE_SUBSCRIPTION_ID }),
    {
      resolveUser: resolveCaller,
      client: neverConfiguredClient() as never,
      cancelStripeSubscription: refusingCancel(),
    },
  )
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 for a provider value outside the three literals', async () => {
  const response = await handler(requestFor(basePayload({ provider: 'paypal' })), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    cancelStripeSubscription: refusingCancel(),
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 for "Stripe" (wrong case) -- exact-literal match only, no case-folding', async () => {
  const response = await handler(requestFor(basePayload({ provider: 'Stripe' })), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    cancelStripeSubscription: refusingCancel(),
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 for " stripe " (whitespace-padded) -- exact-literal match only, no trimming', async () => {
  const response = await handler(requestFor(basePayload({ provider: ' stripe ' })), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    cancelStripeSubscription: refusingCancel(),
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 when subscription_id is missing', async () => {
  const response = await handler(requestFor({ provider: 'stripe' }), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    cancelStripeSubscription: refusingCancel(),
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 for a whitespace-only subscription_id', async () => {
  const response = await handler(requestFor(basePayload({ subscription_id: '   ' })), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    cancelStripeSubscription: refusingCancel(),
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 for an empty-string subscription_id', async () => {
  const response = await handler(requestFor(basePayload({ subscription_id: '' })), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    cancelStripeSubscription: refusingCancel(),
  })
  assertEquals(response.status, 400)
})

// ---------------------------------------------------------------------------
// Ownership verification -- inverse of the validate path, no enumeration
// oracle: not-found, foreign-owned, and cross-provider id confusion all
// collapse to the SAME generic 404, before any provider dispatch.
// ---------------------------------------------------------------------------

Deno.test('handler returns a generic 404 when no receipt row matches (provider, subscription_id), before any provider dispatch', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({ ownership: { data: null, error: null } }),
    cancelStripeSubscription: refusingCancel(),
  })
  assertEquals(response.status, 404)
  const body = await response.json()
  assertEquals(body.code, 'subscription_not_found')
})

Deno.test('handler returns the SAME generic 404 when the matched receipt row is owned by a DIFFERENT user, before any provider dispatch', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      ownership: { data: ownedRow({ user_id: FOREIGN_UID }), error: null },
    }),
    cancelStripeSubscription: refusingCancel(),
  })
  assertEquals(response.status, 404)
  const body = await response.json()
  assertEquals(body.code, 'subscription_not_found')
  // No-oracle guard: the foreign owner's id must never appear in the body.
  assertEquals(JSON.stringify(body).includes(FOREIGN_UID), false)
})

Deno.test('not-found and foreign-owned responses are byte-for-byte indistinguishable (no enumeration oracle)', async () => {
  const notFound = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({ ownership: { data: null, error: null } }),
    cancelStripeSubscription: refusingCancel(),
  })
  const foreignOwned = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      ownership: { data: ownedRow({ user_id: FOREIGN_UID }), error: null },
    }),
    cancelStripeSubscription: refusingCancel(),
  })
  assertEquals(notFound.status, foreignOwned.status)
  const [notFoundBody, foreignOwnedBody] = await Promise.all([notFound.text(), foreignOwned.text()])
  assertEquals(notFoundBody, foreignOwnedBody)
})

Deno.test('handler returns the SAME generic 404 for cross-provider id confusion -- a real id owned under a DIFFERENT provider literal', async () => {
  // The caller genuinely owns STRIPE_SUBSCRIPTION_ID under 'stripe', but
  // submits it tagged as 'apple_iap'. The composite natural key
  // (provider, provider_subscription_id) simply misses -- the mock's
  // ownership lookup (keyed on the submitted provider) returns no row,
  // exactly like the plain not-found case, never a distinguishable response.
  const response = await handler(
    requestFor(basePayload({ provider: 'apple_iap', subscription_id: STRIPE_SUBSCRIPTION_ID })),
    {
      resolveUser: resolveCaller,
      client: buildMockClient({ ownership: { data: null, error: null } }),
      cancelStripeSubscription: refusingCancel(),
    },
  )
  assertEquals(response.status, 404)
  const body = await response.json()
  assertEquals(body.code, 'subscription_not_found')
})

Deno.test('handler returns 500 when the ownership lookup itself errors', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      ownership: { data: null, error: { message: 'connection reset' } },
    }),
    cancelStripeSubscription: refusingCancel(),
  })
  assertEquals(response.status, 500)
})

// ---------------------------------------------------------------------------
// Stripe dispatch -- cancel-at-period-end, status flip, raw_receipt merge.
// ---------------------------------------------------------------------------

Deno.test('handler cancels a Stripe subscription: dispatches to the provider, flips status to canceled, merges raw_receipt, and returns requires_native_action: false', async () => {
  let capturedId: string | null = null
  let capturedPatch: Record<string, unknown> | null = null
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      ownership: { data: ownedRow(), error: null },
      update: { data: [{ id: 'row-1' }], error: null },
      onUpdatePatch: (patch) => {
        capturedPatch = patch
      },
    }),
    cancelStripeSubscription: (id) => {
      capturedId = id
      return Promise.resolve({ current_period_end: PROVIDER_FRESH_PERIOD_END })
    },
  })
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.ok, true)
  assertEquals(body.current_period_end, PROVIDER_FRESH_PERIOD_END)
  assertEquals(body.requires_native_action, false)
  assertEquals(capturedId, STRIPE_SUBSCRIPTION_ID)

  const patch = capturedPatch as unknown as Record<string, unknown>
  assertEquals(patch.status, 'canceled')
  const rawReceipt = patch.raw_receipt as Record<string, unknown>
  // The merge preserves the pre-existing raw_receipt content...
  assertEquals(rawReceipt.plan, 'monthly')
  // ...and adds the cancellation fields, never overwriting the object.
  assertEquals(rawReceipt.cancel_at_period_end, true)
  assertEquals(typeof rawReceipt.canceled_at, 'string')
  assertEquals(rawReceipt.cancellation_requested_at, undefined)
  // The provider-fresh period end is PERSISTED to the stored column (which
  // governs the tier-expiry sweep), never left to diverge from the response.
  assertEquals(patch.current_period_end, PROVIDER_FRESH_PERIOD_END)
})

Deno.test('a re-cancel of an already-scheduled Stripe subscription succeeds idempotently (not an error)', async () => {
  // Stripe's cancel_at_period_end=true is idempotent -- calling it again on a
  // subscription already scheduled for cancellation is a successful no-op
  // that returns the same period end, not an error.
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      ownership: { data: ownedRow(), error: null },
      update: { data: [{ id: 'row-1' }], error: null },
    }),
    cancelStripeSubscription: () =>
      Promise.resolve({ current_period_end: PROVIDER_FRESH_PERIOD_END }),
  })
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.ok, true)
  assertEquals(body.current_period_end, PROVIDER_FRESH_PERIOD_END)
})

Deno.test('a Stripe resource_missing/404 on a locally-owned id maps to the SAME generic 404 subscription_not_found, never a 502', async () => {
  // Local <-> Stripe desync: our receipt says the caller owns this
  // subscription, but Stripe reports it no longer exists. This is
  // functionally "nothing to cancel" -- reuse the generic 404 rather than a
  // provider-fault 5xx (a false alarm) or a message that would reveal the
  // receipt existed locally.
  const notFound = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({ ownership: { data: null, error: null } }),
    cancelStripeSubscription: refusingCancel(),
  })
  const desync = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({ ownership: { data: ownedRow(), error: null } }),
    cancelStripeSubscription: () =>
      Promise.reject(
        new ReceiptValidationError('stripe reports no matching subscription to cancel', {
          code: 'provider_resource_missing',
          fault: 'client',
          status: 404,
        }),
      ),
  })
  assertEquals(desync.status, 404)
  // .clone() so the body remains readable for the byte-equality check below (a
  // Response body can only be consumed once).
  const desyncBody = await desync.clone().json()
  assertEquals(desyncBody.code, 'subscription_not_found')
  assertEquals(desync.status, notFound.status)
  const [notFoundText, desyncText] = await Promise.all([notFound.text(), desync.text()])
  assertEquals(notFoundText, desyncText)
})

Deno.test('handler never attempts the receipt write when the Stripe dispatch fails', async () => {
  // config.update is intentionally left unset -- an attempted call to
  // .update(...) throws "receipt update not configured for this test",
  // failing the test loudly if the handler tries to write after a failed
  // dispatch.
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({ ownership: { data: ownedRow(), error: null } }),
    cancelStripeSubscription: () =>
      Promise.reject(
        new ReceiptValidationError('provider request timed out', {
          code: 'provider_timeout',
          fault: 'provider',
        }),
      ),
  })
  assertEquals(response.status >= 500, true)
})

Deno.test('handler maps a provider-fault Stripe timeout to a 5xx response, never a hang', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({ ownership: { data: ownedRow(), error: null } }),
    cancelStripeSubscription: () =>
      Promise.reject(
        new ReceiptValidationError('provider request timed out', {
          code: 'provider_timeout',
          fault: 'provider',
        }),
      ),
  })
  assertEquals(response.status >= 500, true)
})

Deno.test('handler honors an explicit status override on a provider-contract-violation error (502)', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({ ownership: { data: ownedRow(), error: null } }),
    cancelStripeSubscription: () =>
      Promise.reject(
        new ReceiptValidationError('provider returned a contract-violating payload', {
          code: 'provider_contract_violation',
          fault: 'provider',
          status: 502,
        }),
      ),
  })
  assertEquals(response.status, 502)
})

Deno.test('handler returns 500 (fail-closed) on an unexpected, non-typed throw from the Stripe dispatch', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({ ownership: { data: ownedRow(), error: null } }),
    cancelStripeSubscription: () => Promise.reject(new Error('unexpected SDK crash')),
  })
  assertEquals(response.status, 500)
})

// ---------------------------------------------------------------------------
// Partial-write fail-closed semantics.
// ---------------------------------------------------------------------------

Deno.test('handler returns 500 (never a false success) when the Stripe cancel succeeds but the receipt UPDATE errors', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      ownership: { data: ownedRow(), error: null },
      update: { data: null, error: { code: '57P01', message: 'database is shutting down' } },
    }),
    cancelStripeSubscription: () =>
      Promise.resolve({ current_period_end: PROVIDER_FRESH_PERIOD_END }),
  })
  assertEquals(response.status, 500)
})

// ---------------------------------------------------------------------------
// apple_iap / play_iap -- no provider call, native-action response, status
// left unchanged, cancellation_requested_at recorded.
// ---------------------------------------------------------------------------

Deno.test('handler cancels an apple_iap subscription: NO provider call, requires_native_action: true, status untouched, cancellation_requested_at recorded, period end from the stored receipt', async () => {
  let capturedPatch: Record<string, unknown> | null = null
  const response = await handler(
    requestFor(basePayload({ provider: 'apple_iap', subscription_id: 'apple-original-tx-001' })),
    {
      resolveUser: resolveCaller,
      client: buildMockClient({
        ownership: { data: ownedRow(), error: null },
        update: { data: [{ id: 'row-1' }], error: null },
        onUpdatePatch: (patch) => {
          capturedPatch = patch
        },
      }),
      cancelStripeSubscription: refusingCancel(),
    },
  )
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.ok, true)
  assertEquals(body.requires_native_action, true)
  // Period end comes from the STORED receipt row, never re-fetched.
  assertEquals(body.current_period_end, STORED_PERIOD_END)

  const patch = capturedPatch as unknown as Record<string, unknown>
  assertEquals('status' in patch, false)
  // apple/play make no provider call, so the stored period end is already
  // authoritative and is NOT rewritten (unlike the Stripe branch).
  assertEquals('current_period_end' in patch, false)
  const rawReceipt = patch.raw_receipt as Record<string, unknown>
  assertEquals(rawReceipt.plan, 'monthly')
  assertEquals(rawReceipt.cancel_at_period_end, true)
  assertEquals(typeof rawReceipt.cancellation_requested_at, 'string')
  assertEquals(rawReceipt.canceled_at, undefined)
})

Deno.test('handler cancels a play_iap subscription: NO provider call, requires_native_action: true, status untouched, cancellation_requested_at recorded', async () => {
  let capturedPatch: Record<string, unknown> | null = null
  const response = await handler(
    requestFor(basePayload({ provider: 'play_iap', subscription_id: 'play-purchase-token-001' })),
    {
      resolveUser: resolveCaller,
      client: buildMockClient({
        ownership: { data: ownedRow(), error: null },
        update: { data: [{ id: 'row-1' }], error: null },
        onUpdatePatch: (patch) => {
          capturedPatch = patch
        },
      }),
      cancelStripeSubscription: refusingCancel(),
    },
  )
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.requires_native_action, true)
  assertEquals(body.current_period_end, STORED_PERIOD_END)

  const patch = capturedPatch as unknown as Record<string, unknown>
  assertEquals('status' in patch, false)
  const rawReceipt = patch.raw_receipt as Record<string, unknown>
  assertEquals(typeof rawReceipt.cancellation_requested_at, 'string')
})

Deno.test('apple/play normalize the stored TIMESTAMPTZ to UTC Z-form even when it arrives in PostgREST +00:00 form', async () => {
  // PostgREST renders a stored timestamptz as `...+00:00`; the response must
  // report the same UTC Z-form the Stripe path emits, for a consistent contract.
  const response = await handler(
    requestFor(basePayload({ provider: 'apple_iap', subscription_id: 'apple-tz-form' })),
    {
      resolveUser: resolveCaller,
      client: buildMockClient({
        ownership: {
          data: ownedRow({ current_period_end: '2026-08-01T00:00:00+00:00' }),
          error: null,
        },
        update: { data: [{ id: 'row-1' }], error: null },
      }),
      cancelStripeSubscription: refusingCancel(),
    },
  )
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.current_period_end, '2026-08-01T00:00:00.000Z')
})

// ---------------------------------------------------------------------------
// Config fault -- an unset/empty STRIPE_SECRET_KEY is OUR misconfiguration and
// must fail closed to a 500 BEFORE any network call, never a provider-fault 502.
// ---------------------------------------------------------------------------

Deno.test('handler returns 500 (config fault, no network call) when STRIPE_SECRET_KEY is unset and the real Stripe dispatch is used', async () => {
  const originalKey = Deno.env.get('STRIPE_SECRET_KEY')
  Deno.env.delete('STRIPE_SECRET_KEY')
  try {
    // No cancelStripeSubscription override -> the real defaultStripeCancel runs
    // and must guard the empty key before building any client or issuing a fetch.
    // config.update is intentionally unset: a network call or a write would throw
    // loudly, proving neither happened.
    const response = await handler(requestFor(basePayload()), {
      resolveUser: resolveCaller,
      client: buildMockClient({ ownership: { data: ownedRow(), error: null } }),
    })
    assertEquals(response.status, 500)
  } finally {
    if (originalKey === undefined) {
      Deno.env.delete('STRIPE_SECRET_KEY')
    } else {
      Deno.env.set('STRIPE_SECRET_KEY', originalKey)
    }
  }
})

// ---------------------------------------------------------------------------
// Client-supplied identity is always ignored.
// ---------------------------------------------------------------------------

Deno.test('handler ignores a client-supplied user_id -- the ownership check and write always scope to the JWT-resolved uid', async () => {
  // buildMockClient's update() chain asserts .eq('user_id', CALLER_UID)
  // internally and throws otherwise -- sending a DIFFERENT client-supplied
  // user_id here and still getting a 200 proves the client value had zero
  // effect on the write scope.
  const response = await handler(
    requestFor(basePayload({ user_id: FOREIGN_UID })),
    {
      resolveUser: resolveCaller,
      client: buildMockClient({
        ownership: { data: ownedRow(), error: null },
        update: { data: [{ id: 'row-1' }], error: null },
      }),
      cancelStripeSubscription: () =>
        Promise.resolve({ current_period_end: PROVIDER_FRESH_PERIOD_END }),
    },
  )
  assertEquals(response.status, 200)
})

Deno.test('handler ignores unknown extra body fields', async () => {
  const response = await handler(
    requestFor(basePayload({ some_unrelated_field: 'irrelevant', nested: { a: 1 } })),
    {
      resolveUser: resolveCaller,
      client: buildMockClient({
        ownership: { data: ownedRow(), error: null },
        update: { data: [{ id: 'row-1' }], error: null },
      }),
      cancelStripeSubscription: () =>
        Promise.resolve({ current_period_end: PROVIDER_FRESH_PERIOD_END }),
    },
  )
  assertEquals(response.status, 200)
})

// ---------------------------------------------------------------------------
// Success response shape -- no receipt/subscription_id/provider PII.
// ---------------------------------------------------------------------------

Deno.test('handler returns { ok: true, current_period_end, requires_native_action } and nothing else identifying', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      ownership: { data: ownedRow(), error: null },
      update: { data: [{ id: 'row-1' }], error: null },
    }),
    cancelStripeSubscription: () =>
      Promise.resolve({ current_period_end: PROVIDER_FRESH_PERIOD_END }),
  })
  const body = await response.json()
  assertEquals(Object.keys(body).sort(), ['current_period_end', 'ok', 'requires_native_action'])
})

// ---------------------------------------------------------------------------
// No leak -- neither the response body nor any log line ever carries the
// submitted subscription_id (logs carry metadata only + no-oracle discipline).
// ---------------------------------------------------------------------------

Deno.test('a success response body never contains any fragment of the submitted subscription_id', async () => {
  const secretishId = 'sub_should_never_leak_into_the_success_body'
  const response = await handler(requestFor(basePayload({ subscription_id: secretishId })), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      ownership: { data: ownedRow(), error: null },
      update: { data: [{ id: 'row-1' }], error: null },
    }),
    cancelStripeSubscription: () =>
      Promise.resolve({ current_period_end: PROVIDER_FRESH_PERIOD_END }),
  })
  const raw = await response.text()
  assertEquals(raw.includes(secretishId), false)
})

Deno.test('a failure response body never contains any fragment of the submitted subscription_id', async () => {
  const secretishId = 'sub_should_never_leak_into_any_failure_body'
  const response = await handler(requestFor(basePayload({ subscription_id: secretishId })), {
    resolveUser: resolveCaller,
    client: buildMockClient({ ownership: { data: null, error: null } }),
    cancelStripeSubscription: refusingCancel(),
  })
  const raw = await response.text()
  assertEquals(raw.includes(secretishId), false)
})

Deno.test('no captured console.log/console.error line contains the submitted subscription_id across a full success run', async () => {
  const originalLog = console.log
  const originalError = console.error
  const capturedLines: string[] = []
  console.log = ((...args: unknown[]) => {
    capturedLines.push(String(args[0] ?? ''))
  }) as typeof console.log
  console.error = ((...args: unknown[]) => {
    capturedLines.push(String(args[0] ?? ''))
  }) as typeof console.error

  const secretishId = 'sub_marker_must_never_appear_in_any_success_log_line'
  try {
    await handler(requestFor(basePayload({ subscription_id: secretishId })), {
      resolveUser: resolveCaller,
      client: buildMockClient({
        ownership: { data: ownedRow(), error: null },
        update: { data: [{ id: 'row-1' }], error: null },
      }),
      cancelStripeSubscription: () =>
        Promise.resolve({ current_period_end: PROVIDER_FRESH_PERIOD_END }),
    })
  } finally {
    console.log = originalLog
    console.error = originalError
  }

  for (const line of capturedLines) {
    assertEquals(line.includes(secretishId), false, `leaked in log line: ${line}`)
  }
})

Deno.test('no captured console.log/console.error line contains the submitted subscription_id across a not-found run', async () => {
  const originalLog = console.log
  const originalError = console.error
  const capturedLines: string[] = []
  console.log = ((...args: unknown[]) => {
    capturedLines.push(String(args[0] ?? ''))
  }) as typeof console.log
  console.error = ((...args: unknown[]) => {
    capturedLines.push(String(args[0] ?? ''))
  }) as typeof console.error

  const secretishId = 'sub_marker_must_never_appear_in_any_not_found_log_line'
  try {
    await handler(requestFor(basePayload({ subscription_id: secretishId })), {
      resolveUser: resolveCaller,
      client: buildMockClient({ ownership: { data: null, error: null } }),
      cancelStripeSubscription: refusingCancel(),
    })
  } finally {
    console.log = originalLog
    console.error = originalError
  }

  for (const line of capturedLines) {
    assertEquals(line.includes(secretishId), false, `leaked in log line: ${line}`)
  }
})

// ---------------------------------------------------------------------------
// Misconfigured environment -- fail-closed 500 envelope, never an uncaught
// throw.
// ---------------------------------------------------------------------------

Deno.test('handler returns a wrapped 500 error envelope (not an uncaught throw) when SUPABASE_URL is unset and no client override is supplied', async () => {
  const originalUrl = Deno.env.get('SUPABASE_URL')
  Deno.env.delete('SUPABASE_URL')
  try {
    const response = await handler(requestFor(basePayload()), {
      resolveUser: resolveCaller,
      cancelStripeSubscription: () =>
        Promise.resolve({ current_period_end: PROVIDER_FRESH_PERIOD_END }),
    })
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
