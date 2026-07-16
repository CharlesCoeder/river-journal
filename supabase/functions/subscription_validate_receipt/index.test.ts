// Deno unit tests for the subscription_validate_receipt handler -- the
// FIRST user-JWT-authenticated function in this repo (every prior Edge
// Function is service-role/trigger context).
//
// Run locally with: deno test --allow-env --allow-net supabase/functions/
//
// NOT wired into `yarn vitest` -- supabase/functions/** is excluded from the
// root vitest.config.mts glob (Deno 2 code: URL/npm:/jsr: imports, Deno.*
// globals). This file is `deno test`-only.
//
// Contract pinned down here (inferred from the acceptance criteria -- not
// verbatim named in the source spec, mirroring how the notify_reply
// precedent pinned an inferred client-usage contract):
//
//   handler(req: Request, deps: HandlerDeps = {}): Promise<Response>
//
//   HandlerDeps = {
//     client?: SupabaseClient          -- falls back to createServiceRoleClient()
//     resolveUser?: (req) => Promise<{ id: string } | null>  -- falls back to
//       getAuthenticatedUser(req). Tests inject this instead of standing up a
//       real Supabase Auth call, exactly mirroring the notify_reply
//       clientOverride idiom, extended here because THIS handler needs both
//       an identity seam and a DB seam.
//     validators?: Partial<Record<Provider, (rawReceipt: unknown) =>
//       Promise<ReceiptValidationResult>>>  -- falls back to the real
//       _shared/billing/{stripe,apple,google}.ts dispatch table. Injected so
//       handler-logic tests never need to fake three different providers'
//       HTTP/SDK traffic -- that per-provider correctness is covered by the
//       dedicated _shared/billing/{stripe,apple,google}.test.ts files.
//   }
//
//   Flow: resolveUser(req) -> null => 401 unauthorized (BEFORE any client or
//   validator call). Parse body as JSON -> 400 on failure. Validate
//   `provider` is EXACTLY one of 'stripe' | 'apple_iap' | 'play_iap' (no
//   case-fold/trim) and `raw_receipt` is present and not
//   whitespace-only/empty-object/empty-array -> 400 BEFORE any validator
//   call. A grossly oversized body -> 400. Any `user_id`/`subscription_tier`
//   in the body is never read for identity/entitlement purposes. Dispatch to
//   deps.validators[provider] (or the real module) with ONLY `raw_receipt`.
//   A thrown ReceiptValidationError maps to `err(message, { code, status })`
//   where status = error.status if provided, else 400 for fault:'client' or
//   502 for fault:'provider' (never a receipt/PII fragment in the body). An
//   unexpected (non-ReceiptValidationError) throw -> 500, zero DB writes.
//
//   If the validated result carries a non-null bound_user_id that does NOT
//   equal the caller's uid, that is a fail-closed provider-account-binding
//   mismatch -> the SAME generic 409 as the ownership conflict below (no
//   owner-leak), before any DB write.
//
//   Anti-hijack (two-layer): (a) SELECT subscription_receipts by
//   (provider, provider_subscription_id) via
//   `.from('subscription_receipts').select('user_id').eq('provider',
//   provider).eq('provider_subscription_id', id).maybeSingle()`; a row owned
//   by a DIFFERENT user_id -> `err('subscription could not be applied to
//   this account', { code: 'receipt_ownership_conflict', status: 409 })`,
//   generic, no owner leak, BEFORE any write. (b) Otherwise attempt
//   `.from('subscription_receipts').insert({ user_id: callerUid, provider,
//   provider_subscription_id, status, current_period_end, last_validated_at,
//   raw_receipt }).select('id')`; on a unique-violation conflict
//   (error.code === '23505') fall back to
//   `.update({...}).eq('provider', provider).eq('provider_subscription_id',
//   id).eq('user_id', callerUid).select('id')` -- an EMPTY returned array
//   under that conflict means a foreign owner won the race -> the SAME 409;
//   a non-empty array means the caller's own row was updated (legitimate
//   same-user re-validate) -> proceed.
//
//   After a successful receipt write: `.from('users').update({
//   subscription_tier: tier }).eq('id', callerUid)`. An error from this
//   update (receipt already written) -> 500 (fail-closed on a partial
//   write, never report success). Success ->
//   `ok({ subscription_tier, current_period_end })`.
//
//   Logging: logInfo/logError metadata only -- an explicit negative
//   assertion proves no captured console.log/console.error line contains a
//   receipt-content marker.
//
// Red phase: ./index.ts does not exist yet, so every test in this file fails
// at import resolution before a single assertion runs.
//
// ---------------------------------------------------------------------------
// Extension for server-side PostHog emission: HandlerDeps gains
// `emitServerEvent?: (event, distinctId, props?) => Promise<void>`, falling
// back to the real `_shared/posthog.ts` emitServerEvent (which is itself
// safely inert in test environments -- it no-ops unless POSTHOG_API_KEY is
// set, so leaving this seam unoverridden in every pre-existing test above is
// safe and requires no changes there). On the success path only (after the
// tier update, at the final `ok(...)`), the handler now calls
// `emitServerEvent('subscription_purchased', callerUid, { user_id: callerUid,
// provider, tier: result.tier })`. It does NOT fire on any failure path
// (validator throw, binding conflict, ownership conflict, write error, tier
// update error) -- no purchase completed on those.
// ---------------------------------------------------------------------------

import { assertEquals } from 'jsr:@std/assert@1'
import { ReceiptValidationError } from '../_shared/billing/types.ts'
import { handler } from './index.ts'

const CALLER_UID = '00000000-0000-0000-0000-0000000000d1'
const FOREIGN_UID = '00000000-0000-0000-0000-0000000000d2'
const PROVIDER_SUBSCRIPTION_ID = 'sub_test0000000000000001'
const CURRENT_PERIOD_END = '2026-08-12T00:00:00.000Z'

function successResult(overrides: Record<string, unknown> = {}) {
  return {
    provider_subscription_id: PROVIDER_SUBSCRIPTION_ID,
    status: 'active',
    current_period_end: CURRENT_PERIOD_END,
    tier: 'paid_monthly',
    bound_user_id: null,
    raw_metadata: { plan: 'monthly', provider_status: 'active' },
    ...overrides,
  }
}

function requestFor(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/subscription_validate_receipt', {
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
  return new Request('http://localhost/subscription_validate_receipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'stripe',
    raw_receipt: PROVIDER_SUBSCRIPTION_ID,
    ...overrides,
  }
}

function resolveCaller(): Promise<{ id: string } | null> {
  return Promise.resolve({ id: CALLER_UID })
}

// A minimal fake client builder mirroring the notify_reply buildMockClient
// idiom: every table access not explicitly configured throws, so an
// unexpected call surfaces as a loud test failure rather than a silent pass.
interface MockConfig {
  preCheck?: { data: unknown; error: unknown }
  insert?: { data: unknown; error: unknown }
  conflictUpdate?: { data: unknown; error: unknown }
  tierUpdate?: { data: unknown; error: unknown }
}

function buildMockClient(config: MockConfig) {
  return {
    from(table: string) {
      if (table === 'subscription_receipts') {
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
                        if (!config.preCheck) {
                          throw new Error('ownership pre-check not configured for this test')
                        }
                        return Promise.resolve(config.preCheck)
                      },
                    }
                  },
                }
              },
            }
          },
          insert(row: Record<string, unknown>) {
            assertEquals(row.user_id, CALLER_UID)
            return {
              select(_cols: string) {
                if (!config.insert) {
                  throw new Error('receipt insert not configured for this test')
                }
                return Promise.resolve(config.insert)
              },
            }
          },
          update(_patch: Record<string, unknown>) {
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
                        return {
                          select(_cols: string) {
                            if (!config.conflictUpdate) {
                              throw new Error('conflict-update not configured for this test')
                            }
                            return Promise.resolve(config.conflictUpdate)
                          },
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'users') {
        return {
          update(patch: { subscription_tier: string }) {
            return {
              eq(col: string, val: string) {
                assertEquals(col, 'id')
                assertEquals(val, CALLER_UID)
                void patch
                if (!config.tierUpdate) {
                  throw new Error('tier update not configured for this test')
                }
                return Promise.resolve(config.tierUpdate)
              },
            }
          },
        }
      }
      throw new Error(`unexpected table access "${table}"`)
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

function refusingValidator(name: string) {
  return () => {
    throw new Error(`validator "${name}" must never be called for this test`)
  }
}

// ---------------------------------------------------------------------------
// Auth -- the pivotal design point: user-JWT identity, BEFORE any DB or
// provider call.
// ---------------------------------------------------------------------------

Deno.test('handler returns 401 when no Authorization header is present, before any client or validator call', async () => {
  const response = await handler(requestWithNoAuthHeader(basePayload()), {
    client: neverConfiguredClient() as never,
    validators: { stripe: refusingValidator('stripe') },
  })
  assertEquals(response.status, 401)
  const body = await response.json()
  assertEquals(typeof body.error, 'string')
})

Deno.test('handler returns 401 when resolveUser resolves to null (invalid/expired JWT), before any client or validator call', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: () => Promise.resolve(null),
    client: neverConfiguredClient() as never,
    validators: { stripe: refusingValidator('stripe') },
  })
  assertEquals(response.status, 401)
})

Deno.test('handler proceeds past auth when resolveUser resolves an authenticated caller', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      preCheck: { data: null, error: null },
      insert: { data: [{ id: 'row-1' }], error: null },
      tierUpdate: { data: [{ id: CALLER_UID }], error: null },
    }),
    validators: { stripe: () => Promise.resolve(successResult()) },
  })
  assertEquals(response.status, 200)
})

// ---------------------------------------------------------------------------
// Input contract -- 400s BEFORE any provider validator call.
// ---------------------------------------------------------------------------

Deno.test('handler returns 400 for a non-JSON body, before any validator call', async () => {
  const request = new Request('http://localhost/subscription_validate_receipt', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-jwt-placeholder' },
    body: 'not json',
  })
  const response = await handler(request, {
    resolveUser: resolveCaller,
    validators: { stripe: refusingValidator('stripe') },
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 when provider is missing', async () => {
  const response = await handler(requestFor({ raw_receipt: PROVIDER_SUBSCRIPTION_ID }), {
    resolveUser: resolveCaller,
    validators: { stripe: refusingValidator('stripe') },
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 for a provider value outside the three literals', async () => {
  const response = await handler(requestFor(basePayload({ provider: 'paypal' })), {
    resolveUser: resolveCaller,
    validators: { stripe: refusingValidator('stripe') },
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 for "Stripe" (wrong case) -- exact-literal match only, no case-folding', async () => {
  const response = await handler(requestFor(basePayload({ provider: 'Stripe' })), {
    resolveUser: resolveCaller,
    validators: { stripe: refusingValidator('stripe') },
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 for " stripe " (whitespace-padded) -- exact-literal match only, no trimming', async () => {
  const response = await handler(requestFor(basePayload({ provider: ' stripe ' })), {
    resolveUser: resolveCaller,
    validators: { stripe: refusingValidator('stripe') },
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 when raw_receipt is missing', async () => {
  const response = await handler(requestFor({ provider: 'stripe' }), {
    resolveUser: resolveCaller,
    validators: { stripe: refusingValidator('stripe') },
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 for a whitespace-only raw_receipt string', async () => {
  const response = await handler(requestFor(basePayload({ raw_receipt: '   ' })), {
    resolveUser: resolveCaller,
    validators: { stripe: refusingValidator('stripe') },
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 for an empty-object raw_receipt', async () => {
  const response = await handler(requestFor(basePayload({ raw_receipt: {} })), {
    resolveUser: resolveCaller,
    validators: { stripe: refusingValidator('stripe') },
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 for an empty-array raw_receipt', async () => {
  const response = await handler(requestFor(basePayload({ raw_receipt: [] })), {
    resolveUser: resolveCaller,
    validators: { stripe: refusingValidator('stripe') },
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 for a grossly oversized body, before any validator call', async () => {
  const hugeReceipt = 'x'.repeat(5_000_000)
  const response = await handler(requestFor(basePayload({ raw_receipt: hugeReceipt })), {
    resolveUser: resolveCaller,
    validators: { stripe: refusingValidator('stripe') },
  })
  assertEquals(response.status, 400)
})

// ---------------------------------------------------------------------------
// Per-provider dispatch -- only raw_receipt crosses into the validator.
// ---------------------------------------------------------------------------

Deno.test('handler dispatches provider "stripe" to the stripe validator only', async () => {
  let called: string | null = null
  const response = await handler(requestFor(basePayload({ provider: 'stripe' })), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      preCheck: { data: null, error: null },
      insert: { data: [{ id: 'row-1' }], error: null },
      tierUpdate: { data: [{ id: CALLER_UID }], error: null },
    }),
    validators: {
      stripe: (rawReceipt) => {
        called = 'stripe'
        assertEquals(rawReceipt, PROVIDER_SUBSCRIPTION_ID)
        return Promise.resolve(successResult())
      },
      apple_iap: refusingValidator('apple_iap'),
      play_iap: refusingValidator('play_iap'),
    },
  })
  assertEquals(response.status, 200)
  assertEquals(called, 'stripe')
})

Deno.test('handler dispatches provider "apple_iap" to the apple validator only', async () => {
  const response = await handler(
    requestFor(basePayload({ provider: 'apple_iap', raw_receipt: 'base64-receipt-data' })),
    {
      resolveUser: resolveCaller,
      client: buildMockClient({
        preCheck: { data: null, error: null },
        insert: { data: [{ id: 'row-1' }], error: null },
        tierUpdate: { data: [{ id: CALLER_UID }], error: null },
      }),
      validators: {
        stripe: refusingValidator('stripe'),
        apple_iap: () => Promise.resolve(successResult()),
        play_iap: refusingValidator('play_iap'),
      },
    },
  )
  assertEquals(response.status, 200)
})

Deno.test('handler dispatches provider "play_iap" to the google validator only', async () => {
  const response = await handler(
    requestFor(basePayload({ provider: 'play_iap', raw_receipt: { purchaseToken: 'tok-abc' } })),
    {
      resolveUser: resolveCaller,
      client: buildMockClient({
        preCheck: { data: null, error: null },
        insert: { data: [{ id: 'row-1' }], error: null },
        tierUpdate: { data: [{ id: CALLER_UID }], error: null },
      }),
      validators: {
        stripe: refusingValidator('stripe'),
        apple_iap: refusingValidator('apple_iap'),
        play_iap: () => Promise.resolve(successResult()),
      },
    },
  )
  assertEquals(response.status, 200)
})

// ---------------------------------------------------------------------------
// Failure taxonomy -- 4xx vs 5xx fault split, provider-contract 502, and no
// receipt content ever reaching the response body.
// ---------------------------------------------------------------------------

Deno.test("handler maps a client-fault ReceiptValidationError to a 4xx response with the error's code, and never writes to the DB", async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    validators: {
      stripe: () =>
        Promise.reject(
          new ReceiptValidationError('receipt not found', {
            code: 'receipt_not_found',
            fault: 'client',
          }),
        ),
    },
  })
  assertEquals(response.status, 400)
  const body = await response.json()
  assertEquals(body.code, 'receipt_not_found')
})

Deno.test('handler maps a provider-fault ReceiptValidationError to a 5xx response, and never writes to the DB', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    validators: {
      stripe: () =>
        Promise.reject(
          new ReceiptValidationError('provider unreachable', {
            code: 'provider_unreachable',
            fault: 'provider',
          }),
        ),
    },
  })
  assertEquals(response.status >= 500, true)
  const body = await response.json()
  assertEquals(body.code, 'provider_unreachable')
})

Deno.test('handler honors an explicit status override on a provider-contract-violation error (502)', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    validators: {
      stripe: () =>
        Promise.reject(
          new ReceiptValidationError('provider returned a contract-violating payload', {
            code: 'provider_contract_violation',
            fault: 'provider',
            status: 502,
          }),
        ),
    },
  })
  assertEquals(response.status, 502)
})

Deno.test("handler honors a timeout error's 5xx status without ever hanging the request", async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    validators: {
      stripe: () =>
        Promise.reject(
          new ReceiptValidationError('provider request timed out', {
            code: 'provider_timeout',
            fault: 'provider',
          }),
        ),
    },
  })
  assertEquals(response.status >= 500, true)
})

Deno.test('handler returns 500 (fail-closed) on an unexpected, non-ReceiptValidationError throw from the validator, with zero DB writes', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    validators: { stripe: () => Promise.reject(new Error('unexpected SDK crash')) },
  })
  assertEquals(response.status, 500)
})

Deno.test('a validation-failure response body never contains any fragment of the submitted raw_receipt', async () => {
  const secretishReceipt = 'sub_should_never_leak_into_any_response_body'
  const response = await handler(
    requestFor(basePayload({ raw_receipt: secretishReceipt })),
    {
      resolveUser: resolveCaller,
      client: neverConfiguredClient() as never,
      validators: {
        stripe: () =>
          Promise.reject(
            new ReceiptValidationError('receipt rejected', {
              code: 'receipt_invalid',
              fault: 'client',
            }),
          ),
      },
    },
  )
  const raw = await response.text()
  assertEquals(raw.includes(secretishReceipt), false)
})

Deno.test('a success response body never contains any fragment of the submitted raw_receipt', async () => {
  const secretishReceipt = 'sub_should_never_leak_into_the_success_body_either'
  const response = await handler(requestFor(basePayload({ raw_receipt: secretishReceipt })), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      preCheck: { data: null, error: null },
      insert: { data: [{ id: 'row-1' }], error: null },
      tierUpdate: { data: [{ id: CALLER_UID }], error: null },
    }),
    validators: {
      stripe: () => Promise.resolve(successResult({ provider_subscription_id: secretishReceipt })),
    },
  })
  const raw = await response.text()
  assertEquals(raw.includes(secretishReceipt), false)
})

// ---------------------------------------------------------------------------
// Success response shape.
// ---------------------------------------------------------------------------

Deno.test('handler returns { ok: true, subscription_tier, current_period_end } on a successful validation', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      preCheck: { data: null, error: null },
      insert: { data: [{ id: 'row-1' }], error: null },
      tierUpdate: { data: [{ id: CALLER_UID }], error: null },
    }),
    validators: {
      stripe: () =>
        Promise.resolve(
          successResult({ tier: 'paid_yearly', current_period_end: CURRENT_PERIOD_END }),
        ),
    },
  })
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.ok, true)
  assertEquals(body.subscription_tier, 'paid_yearly')
  assertEquals(body.current_period_end, CURRENT_PERIOD_END)
})

// ---------------------------------------------------------------------------
// Client-supplied identity/entitlement is always ignored.
// ---------------------------------------------------------------------------

Deno.test('handler ignores a client-supplied user_id -- the receipt write always uses the JWT-resolved uid', async () => {
  // buildMockClient's insert() asserts row.user_id === CALLER_UID internally
  // and throws otherwise -- sending a DIFFERENT client-supplied user_id here
  // and still getting a 200 proves the client value had zero effect on the
  // written row.
  const client = buildMockClient({
    preCheck: { data: null, error: null },
    insert: { data: [{ id: 'row-1' }], error: null },
    tierUpdate: { data: [{ id: CALLER_UID }], error: null },
  })
  const response = await handler(
    requestFor(basePayload({ user_id: FOREIGN_UID })),
    {
      resolveUser: resolveCaller,
      client,
      validators: { stripe: () => Promise.resolve(successResult()) },
    },
  )
  assertEquals(response.status, 200)
})

Deno.test('handler ignores a client-supplied subscription_tier -- the users update always uses the server-derived tier', async () => {
  let tierUpdatePatchSeen: string | null = null
  const client = {
    from(table: string) {
      if (table === 'subscription_receipts') {
        return {
          select() {
            return {
              eq: () => ({
                eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
              }),
            }
          },
          insert(row: Record<string, unknown>) {
            assertEquals(row.user_id, CALLER_UID)
            return { select: () => Promise.resolve({ data: [{ id: 'row-1' }], error: null }) }
          },
        }
      }
      if (table === 'users') {
        return {
          update(patch: { subscription_tier: string }) {
            tierUpdatePatchSeen = patch.subscription_tier
            return { eq: () => Promise.resolve({ data: [{ id: CALLER_UID }], error: null }) }
          },
        }
      }
      throw new Error(`unexpected table access "${table}"`)
    },
    // deno-lint-ignore no-explicit-any
  } as any

  const response = await handler(
    requestFor(basePayload({ subscription_tier: 'paid_yearly' })), // client claims yearly
    {
      resolveUser: resolveCaller,
      client,
      // The server-derived tier from the (mocked) validator is monthly --
      // it must win over the client-claimed yearly tier.
      validators: { stripe: () => Promise.resolve(successResult({ tier: 'paid_monthly' })) },
    },
  )
  assertEquals(response.status, 200)
  assertEquals(tierUpdatePatchSeen, 'paid_monthly')
})

// ---------------------------------------------------------------------------
// Provider-account binding -- a present-but-mismatched bound_user_id is a
// fail-closed 409, before any DB write.
// ---------------------------------------------------------------------------

Deno.test('handler rejects with 409 when the validated result carries a bound_user_id that does not match the caller, before any DB write', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    validators: { stripe: () => Promise.resolve(successResult({ bound_user_id: FOREIGN_UID })) },
  })
  assertEquals(response.status, 409)
})

Deno.test("handler proceeds normally when the validated result's bound_user_id equals the caller's own uid", async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      preCheck: { data: null, error: null },
      insert: { data: [{ id: 'row-1' }], error: null },
      tierUpdate: { data: [{ id: CALLER_UID }], error: null },
    }),
    validators: { stripe: () => Promise.resolve(successResult({ bound_user_id: CALLER_UID })) },
  })
  assertEquals(response.status, 200)
})

// ---------------------------------------------------------------------------
// Anti-hijack -- pre-check reject, TOCTOU conflict-UPDATE owner-scoping, and
// legitimate same-user re-validation.
// ---------------------------------------------------------------------------

Deno.test('handler returns a generic 409 receipt_ownership_conflict when the pre-check finds the (provider, provider_subscription_id) already owned by a different user, before any write', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      preCheck: { data: { user_id: FOREIGN_UID }, error: null },
    }),
    validators: { stripe: () => Promise.resolve(successResult()) },
  })
  assertEquals(response.status, 409)
  const body = await response.json()
  assertEquals(body.code, 'receipt_ownership_conflict')
  // No-oracle guard: the foreign owner's id must never appear in the body.
  assertEquals(JSON.stringify(body).includes(FOREIGN_UID), false)
})

Deno.test('handler proceeds to the write when the pre-check finds no existing row for (provider, provider_subscription_id)', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      preCheck: { data: null, error: null },
      insert: { data: [{ id: 'row-1' }], error: null },
      tierUpdate: { data: [{ id: CALLER_UID }], error: null },
    }),
    validators: { stripe: () => Promise.resolve(successResult()) },
  })
  assertEquals(response.status, 200)
})

Deno.test("handler proceeds to the write when the pre-check finds the caller's OWN existing row (legitimate same-user re-validate)", async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      preCheck: { data: { user_id: CALLER_UID }, error: null },
      insert: { data: [{ id: 'row-1' }], error: null },
      tierUpdate: { data: [{ id: CALLER_UID }], error: null },
    }),
    validators: { stripe: () => Promise.resolve(successResult()) },
  })
  assertEquals(response.status, 200)
})

Deno.test('handler falls back to the owner-scoped conflict-UPDATE on an insert unique-violation, and succeeds when the caller owns the pre-existing row (TOCTOU-safe same-user path)', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      preCheck: { data: null, error: null }, // pre-check raced and missed a concurrent same-user insert
      insert: {
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      },
      conflictUpdate: { data: [{ id: 'row-1' }], error: null }, // caller's own row: 1 row updated
      tierUpdate: { data: [{ id: CALLER_UID }], error: null },
    }),
    validators: { stripe: () => Promise.resolve(successResult()) },
  })
  assertEquals(response.status, 200)
})

Deno.test('handler returns 409 when the conflict-UPDATE affects zero rows under a race -- a foreign owner won the concurrent claim (TOCTOU close)', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      preCheck: { data: null, error: null }, // pre-check raced and missed the foreign owner's concurrent insert
      insert: {
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      },
      conflictUpdate: { data: [], error: null }, // zero rows: .eq('user_id', callerUid) matched nothing
      tierUpdate: { data: null, error: null },
    }),
    validators: { stripe: () => Promise.resolve(successResult()) },
  })
  assertEquals(response.status, 409)
  const body = await response.json()
  assertEquals(body.code, 'receipt_ownership_conflict')
})

Deno.test('handler returns 500 on a genuine (non-unique-violation) insert error, and never falls back to the conflict-UPDATE path', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      preCheck: { data: null, error: null },
      insert: { data: null, error: { code: '57P01', message: 'database is shutting down' } },
      conflictUpdate: {
        data: null,
        error: new Error('must never be called for a non-conflict insert error'),
      },
    }),
    validators: { stripe: () => Promise.resolve(successResult()) },
  })
  assertEquals(response.status, 500)
})

// ---------------------------------------------------------------------------
// Partial-write fail-closed semantics.
// ---------------------------------------------------------------------------

Deno.test('handler returns 500 (never a false success) when the receipt write succeeds but the users.subscription_tier update errors', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      preCheck: { data: null, error: null },
      insert: { data: [{ id: 'row-1' }], error: null },
      tierUpdate: { data: null, error: { code: '57P01', message: 'database is shutting down' } },
    }),
    validators: { stripe: () => Promise.resolve(successResult()) },
  })
  assertEquals(response.status, 500)
})

// ---------------------------------------------------------------------------
// NFR19 -- no log line ever carries the receipt.
// ---------------------------------------------------------------------------

Deno.test('no captured console.log/console.error line contains the submitted raw_receipt across a full success run', async () => {
  const originalLog = console.log
  const originalError = console.error
  const capturedLines: string[] = []
  console.log = ((...args: unknown[]) => {
    capturedLines.push(String(args[0] ?? ''))
  }) as typeof console.log
  console.error = ((...args: unknown[]) => {
    capturedLines.push(String(args[0] ?? ''))
  }) as typeof console.error

  const secretishReceipt = 'sub_marker_must_never_appear_in_any_log_line'
  try {
    await handler(requestFor(basePayload({ raw_receipt: secretishReceipt })), {
      resolveUser: resolveCaller,
      client: buildMockClient({
        preCheck: { data: null, error: null },
        insert: { data: [{ id: 'row-1' }], error: null },
        tierUpdate: { data: [{ id: CALLER_UID }], error: null },
      }),
      validators: {
        stripe: () =>
          Promise.resolve(successResult({ provider_subscription_id: secretishReceipt })),
      },
    })
  } finally {
    console.log = originalLog
    console.error = originalError
  }

  for (const line of capturedLines) {
    assertEquals(line.includes(secretishReceipt), false, `leaked in log line: ${line}`)
  }
})

Deno.test('no captured console.log/console.error line contains the submitted raw_receipt across a validation-failure run', async () => {
  const originalLog = console.log
  const originalError = console.error
  const capturedLines: string[] = []
  console.log = ((...args: unknown[]) => {
    capturedLines.push(String(args[0] ?? ''))
  }) as typeof console.log
  console.error = ((...args: unknown[]) => {
    capturedLines.push(String(args[0] ?? ''))
  }) as typeof console.error

  const secretishReceipt = 'sub_marker_must_never_appear_in_any_failure_log_line'
  try {
    await handler(requestFor(basePayload({ raw_receipt: secretishReceipt })), {
      resolveUser: resolveCaller,
      client: neverConfiguredClient() as never,
      validators: {
        stripe: () =>
          Promise.reject(
            new ReceiptValidationError('receipt rejected', {
              code: 'receipt_invalid',
              fault: 'client',
            }),
          ),
      },
    })
  } finally {
    console.log = originalLog
    console.error = originalError
  }

  for (const line of capturedLines) {
    assertEquals(line.includes(secretishReceipt), false, `leaked in log line: ${line}`)
  }
})

Deno.test('handler returns a wrapped 500 error envelope (not an uncaught throw) when SUPABASE_URL is unset and no client override is supplied', async () => {
  const originalUrl = Deno.env.get('SUPABASE_URL')
  Deno.env.delete('SUPABASE_URL')
  try {
    // No client deps passed -- the handler must fall back to
    // createServiceRoleClient(), which throws with SUPABASE_URL unset.
    const response = await handler(requestFor(basePayload()), {
      resolveUser: resolveCaller,
      validators: { stripe: () => Promise.resolve(successResult()) },
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

// ---------------------------------------------------------------------------
// Server-side PostHog emission -- subscription_purchased fires ONLY on the
// success path, with the JWT-resolved callerUid as distinct_id (never a
// client-supplied id).
// ---------------------------------------------------------------------------

interface EmitCall {
  event: string
  distinctId: string
  props: Record<string, unknown> | undefined
}

function capturingEmit(): {
  emitServerEvent: (
    event: string,
    distinctId: string,
    props?: Record<string, unknown>,
  ) => Promise<void>
  calls: EmitCall[]
} {
  const calls: EmitCall[] = []
  return {
    emitServerEvent: (event, distinctId, props) => {
      calls.push({ event, distinctId, props })
      return Promise.resolve()
    },
    calls,
  }
}

function refusingEmit() {
  return (): Promise<void> => {
    throw new Error('emitServerEvent must never be called for this test')
  }
}

Deno.test('handler emits subscription_purchased with { user_id: callerUid, provider, tier } and distinct_id = callerUid on a successful validation', async () => {
  const emit = capturingEmit()
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      preCheck: { data: null, error: null },
      insert: { data: [{ id: 'row-1' }], error: null },
      tierUpdate: { data: [{ id: CALLER_UID }], error: null },
    }),
    validators: {
      stripe: () => Promise.resolve(successResult({ tier: 'paid_yearly', provider: 'stripe' })),
    },
    emitServerEvent: emit.emitServerEvent,
  })
  assertEquals(response.status, 200)
  assertEquals(emit.calls.length, 1)
  assertEquals(emit.calls[0]?.event, 'subscription_purchased')
  assertEquals(emit.calls[0]?.distinctId, CALLER_UID)
  assertEquals(emit.calls[0]?.props, {
    user_id: CALLER_UID,
    provider: 'stripe',
    tier: 'paid_yearly',
  })
})

Deno.test('handler does NOT call emitServerEvent when the provider validator throws (early rejection, before any DB write)', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: neverConfiguredClient() as never,
    validators: {
      stripe: () =>
        Promise.reject(
          new ReceiptValidationError('receipt not found', {
            code: 'receipt_not_found',
            fault: 'client',
          }),
        ),
    },
    emitServerEvent: refusingEmit(),
  })
  assertEquals(response.status, 400)
})

Deno.test('handler does NOT call emitServerEvent on a receipt-ownership conflict (late rejection, after an attempted write)', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      preCheck: { data: { user_id: FOREIGN_UID }, error: null },
    }),
    validators: { stripe: () => Promise.resolve(successResult()) },
    emitServerEvent: refusingEmit(),
  })
  assertEquals(response.status, 409)
})

Deno.test('handler does NOT call emitServerEvent when the receipt write succeeds but the tier update errors (partial-write fail-closed)', async () => {
  const response = await handler(requestFor(basePayload()), {
    resolveUser: resolveCaller,
    client: buildMockClient({
      preCheck: { data: null, error: null },
      insert: { data: [{ id: 'row-1' }], error: null },
      tierUpdate: { data: null, error: { code: '57P01', message: 'database is shutting down' } },
    }),
    validators: { stripe: () => Promise.resolve(successResult()) },
    emitServerEvent: refusingEmit(),
  })
  assertEquals(response.status, 500)
})
