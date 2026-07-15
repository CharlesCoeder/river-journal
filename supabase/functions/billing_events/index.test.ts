// Deno unit tests for the billing_events handler -- the repo's FIRST public
// (signature-authed, verify_jwt = false) webhook Edge Function. Every prior
// function is either service-role/trigger context (requireServiceRole) or
// user-JWT context (getAuthenticatedUser); this one has NEITHER -- the
// Stripe-Signature HMAC over the raw body IS the authentication.
//
// Run locally with: deno test --allow-env --allow-net supabase/functions/
//
// NOT wired into `yarn vitest` -- supabase/functions/** is excluded from the
// root vitest.config.mts glob (Deno 2 code: URL/npm:/jsr: imports, Deno.*
// globals). This file is `deno test`-only.
//
// Contract pinned down here (inferred from the acceptance criteria -- not
// verbatim named in the source spec, mirroring how the validate/cancel/
// notify_reply sibling test files pinned their own inferred contracts):
//
//   handler(req: Request, deps: HandlerDeps = {}): Promise<Response>
//
//   HandlerDeps = {
//     client?: SupabaseClient                -- falls back to createServiceRoleClient()
//     verifySignature?: (rawBody: string, signatureHeader: string | null) => unknown
//       -- falls back to the real verifyStripeWebhookSignature(rawBody, header,
//       STRIPE_WEBHOOK_SECRET). Returns the parsed event on success, throws a
//       ReceiptValidationError on failure. Injected so handler-dispatch-logic
//       tests never need to compute real HMAC signatures -- that adapter-level
//       correctness lives in _shared/billing/stripe.test.ts. A dedicated block
//       below exercises the REAL production verifier (no override) to prove
//       the wiring end-to-end.
//     refreshStripeState?: (subscriptionId: string) => Promise<{
//       provider_subscription_id: string; status: string; current_period_end:
//       string; tier: string | null }> -- falls back to the real dispatch
//       built from STRIPE_SECRET_KEY (refreshStripeSubscriptionState).
//       Injected so handler-logic tests never fake live Stripe HTTP traffic.
//     nowMs?: number -- threaded into the real verifier's tolerance-window
//       check for deterministic replay/staleness tests.
//   }
//
//   Flow: reject any non-POST method with a 4xx, before any client/provider
//   call. Read `rawBody = await req.text()` ONCE and measure its size in
//   ACTUAL BYTES (`new TextEncoder().encode(rawBody).byteLength`, not UTF-16
//   `.length` -- a multi-byte-heavy body can be under the cap by `.length`
//   while over it in bytes) against a MAX_BODY_BYTES cap -> 400 on overflow,
//   before any client/provider call. Guard an unset/empty
//   STRIPE_WEBHOOK_SECRET -> config 500 BEFORE verification is attempted (OUR
//   misconfiguration, never a silent accept). Verify the Stripe-Signature
//   header against the EXACT raw body string (never a re-serialized variant)
//   -- any failure (missing/malformed header, no matching v1, stale
//   timestamp, wrong secret) -> generic 400 with NO body detail, NO DB read/
//   write, and NO provider call (the injected client is never touched).
//
//   On a verified event: guard an unset/empty STRIPE_SECRET_KEY -> config 500
//   BEFORE the authoritative retrieve (verification may have already
//   succeeded). Dispatch on event.type:
//     - 'invoice.paid' / 'customer.subscription.updated' -> extract the
//       subscription id (subscription events: event.data.object.id;
//       invoices: event.data.object.parent.subscription_details.subscription
//       first, falling back to event.data.object.subscription) -> SELECT
//       subscription_receipts by (provider='stripe',
//       provider_subscription_id=subId).maybeSingle() -> no row is an
//       unknown-subscription 2xx idempotent no-op (NEVER an insert, NEVER a
//       write) with NO call to refreshStripeState at all. A matched row calls
//       refreshStripeState(subId) -- ALWAYS the live-retrieved state, NEVER
//       any field value from the delivered event.data.object -- and UPDATEs
//       the matched row's status/current_period_end/last_validated_at
//       (owner-agnostic: no .eq('user_id', ...) scoping, since the webhook
//       has no caller identity) plus, when the refreshed tier is non-null,
//       UPDATEs users.subscription_tier for the receipt's user_id.
//     - 'customer.subscription.deleted' -> the SAME row refresh, but
//       users.subscription_tier is NEVER written (the daily expiry sweep owns
//       the actual downgrade) regardless of what tier refreshStripeState
//       resolves.
//     - any OTHER event.type -> acknowledged 2xx immediately, with ZERO
//       DB/provider interaction (not even the row lookup).
//   A missing/underivable subscription id on an invoice.paid event is treated
//   the same as an unknown subscription id (2xx no-op), never a 500.
//
//   Fault mapping: a receipt-lookup or receipt/users UPDATE error -> 5xx
//   (Stripe should retry -- the refresh is idempotent). A
//   ReceiptValidationError from refreshStripeState with fault 'provider' (a
//   retrieve timeout, or a Stripe 5xx/429 rejection) -> 5xx. A
//   provider_contract_violation (status 502, e.g. a malformed period end) ->
//   502. Because the retrieve is always live-by-id, redelivering the same
//   event OR an out-of-order older event both converge to whatever Stripe
//   currently reports -- reprocessing never regresses current_period_end.
//
//   Success -> a minimal 2xx body carrying NO subscription id / event content.
//   Logging + response bodies NEVER carry the raw event body, the signed
//   payload, the Stripe-Signature header value, or the provider_subscription_id.

import { assertEquals } from 'jsr:@std/assert@1'
import { createHmac } from 'node:crypto'
import { ReceiptValidationError } from '../_shared/billing/types.ts'
import { handler } from './index.ts'

const WEBHOOK_SECRET = 'whsec_test_billing_events_signing_secret_0123456789'
const SUBSCRIPTION_ID = 'sub_test_webhook_0000000001'
const USER_ID = '00000000-0000-0000-0000-0000000000f1'
const NOW_MS = Date.parse('2026-07-15T12:00:00.000Z')
const FRESH_PERIOD_END = '2026-08-15T12:00:00.000Z'
const STORED_PERIOD_END = '2026-07-01T00:00:00.000Z'

// ---------------------------------------------------------------------------
// Fixtures + helpers.
// ---------------------------------------------------------------------------

function computeStripeV1(secret: string, timestampSeconds: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex')
}

function stripeSignatureHeader(
  secret: string,
  rawBody: string,
  timestampSeconds: number = Math.floor(NOW_MS / 1000),
): string {
  return `t=${timestampSeconds},v1=${computeStripeV1(secret, timestampSeconds, rawBody)}`
}

function webhookRequest(
  rawBody: string,
  opts: { signature?: string | null; method?: string } = {},
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const signature = opts.signature === undefined
    ? stripeSignatureHeader(WEBHOOK_SECRET, rawBody)
    : opts.signature
  if (signature !== null) {
    headers['Stripe-Signature'] = signature
  }
  const method = opts.method ?? 'POST'
  // GET/HEAD requests cannot carry a body in the Fetch/Deno Request constructor,
  // so the body is attached only for body-bearing methods (the method-guard test
  // exercises a bodyless GET).
  return new Request('http://localhost/billing_events', {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: rawBody }),
  })
}

function invoicePaidEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt_test_invoice_paid_1',
    type: 'invoice.paid',
    data: {
      object: {
        id: 'in_test_1',
        // Basil (2025-03-31.basil+) shape: no top-level invoice.subscription.
        parent: { subscription_details: { subscription: SUBSCRIPTION_ID } },
      },
    },
    ...overrides,
  }
}

function subscriptionUpdatedEvent(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'evt_test_sub_updated_1',
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: SUBSCRIPTION_ID,
        // Deliberately DIVERGENT from what the injected refreshStripeState
        // returns, so tests can prove these field values are never written.
        status: 'canceled',
        current_period_end: 1_600_000_000,
      },
    },
    ...overrides,
  }
}

function subscriptionDeletedEvent(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'evt_test_sub_deleted_1',
    type: 'customer.subscription.deleted',
    data: { object: { id: SUBSCRIPTION_ID, status: 'canceled' } },
    ...overrides,
  }
}

function unhandledEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt_test_unhandled_1',
    type: 'customer.subscription.trial_will_end',
    data: { object: { id: SUBSCRIPTION_ID } },
    ...overrides,
  }
}

function stubVerify(event: Record<string, unknown>) {
  return (_rawBody: string, _signatureHeader: string | null) => event
}

function refusingVerify() {
  return () => {
    throw new Error('verifySignature must never be called for this test')
  }
}

function refusingRefresh() {
  return (): Promise<never> => {
    throw new Error('refreshStripeState must never be called for this test')
  }
}

function matchedRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: USER_ID,
    current_period_end: STORED_PERIOD_END,
    status: 'active',
    ...overrides,
  }
}

// A minimal fake client mirroring the subscription_cancel/notify_reply
// buildMockClient idiom: every table/chain step not explicitly configured
// throws, so an unexpected call surfaces as a loud test failure rather than a
// silent pass -- this is what proves no-write / no-DB-touch invariants.
// billing_events writes are owner-agnostic (no .eq('user_id', ...) on the
// receipt UPDATE) since the webhook has no caller identity.
interface MockConfig {
  ownership?: { data: unknown; error: unknown }
  receiptUpdate?: { data: unknown; error: unknown }
  usersUpdate?: { data: unknown; error: unknown }
  onReceiptUpdatePatch?: (patch: Record<string, unknown>) => void
  onUsersUpdatePatch?: (patch: Record<string, unknown>) => void
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
                assertEquals(val1, 'stripe')
                return {
                  eq(col2: string, _val2: string) {
                    assertEquals(col2, 'provider_subscription_id')
                    return {
                      maybeSingle() {
                        if (!config.ownership) {
                          throw new Error('receipt lookup not configured for this test')
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
            config.onReceiptUpdatePatch?.(patch)
            return {
              eq(colA: string, _valA: string) {
                assertEquals(colA, 'provider')
                return {
                  eq(colB: string, _valB: string) {
                    assertEquals(colB, 'provider_subscription_id')
                    if (!config.receiptUpdate) {
                      throw new Error('receipt update not configured for this test')
                    }
                    return Promise.resolve(config.receiptUpdate)
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'users') {
        return {
          update(patch: Record<string, unknown>) {
            config.onUsersUpdatePatch?.(patch)
            return {
              eq(col: string, _val: string) {
                assertEquals(col, 'id')
                if (!config.usersUpdate) {
                  throw new Error('users update not configured for this test')
                }
                return Promise.resolve(config.usersUpdate)
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

function withEnv(key: string, value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const original = Deno.env.get(key)
  if (value === undefined) {
    Deno.env.delete(key)
  } else {
    Deno.env.set(key, value)
  }
  return (async () => {
    try {
      await fn()
    } finally {
      if (original === undefined) {
        Deno.env.delete(key)
      } else {
        Deno.env.set(key, original)
      }
    }
  })()
}

// ---------------------------------------------------------------------------
// Method guard.
// ---------------------------------------------------------------------------

Deno.test('handler returns a 4xx for a non-POST method, before any client or provider call', async () => {
  const response = await handler(webhookRequest('{}', { method: 'GET' }), {
    client: neverConfiguredClient() as never,
    verifySignature: refusingVerify(),
    refreshStripeState: refusingRefresh(),
  })
  assertEquals(response.status >= 400 && response.status < 500, true)
})

// ---------------------------------------------------------------------------
// Body size guard -- byte-measured, not UTF-16 .length.
// ---------------------------------------------------------------------------

Deno.test('handler returns 400 for a grossly oversized ASCII body, before any DB or provider call', async () => {
  const rawBody = 'x'.repeat(5_000_000)
  const response = await handler(webhookRequest(rawBody, { signature: 'garbage-signature' }), {
    client: neverConfiguredClient() as never,
    refreshStripeState: refusingRefresh(),
  })
  assertEquals(response.status, 400)
})

Deno.test('handler returns 400 for a body whose UTF-16 .length is UNDER the cap but whose actual UTF-8 byte length EXCEEDS it (multi-byte-safe cap)', async () => {
  // A 4-byte-per-codepoint emoji is 2 UTF-16 code units (surrogate pair) but 4
  // UTF-8 bytes -- so a string comfortably under MAX_BODY_BYTES (1_000_000) by
  // `.length` can still exceed it in actual bytes. `padding.length` here is
  // 600_000 (< cap); `TextEncoder().encode(padding).byteLength` is 1_200_000
  // (> cap). A `.length`-based guard (the pre-existing sibling pattern) would
  // NOT catch this; a byte-measured guard must.
  const padding = '\u{1F600}'.repeat(300_000)
  const rawBody = JSON.stringify({
    id: 'evt_oversized',
    type: 'invoice.paid',
    data: { object: { padding } },
  })
  const response = await handler(webhookRequest(rawBody, { signature: 'garbage-signature' }), {
    client: neverConfiguredClient() as never,
    refreshStripeState: refusingRefresh(),
  })
  assertEquals(response.status, 400)
})

// ---------------------------------------------------------------------------
// Config guards -- OUR misconfiguration fails closed to 500, never a silent
// accept and never a provider-fault misreport.
// ---------------------------------------------------------------------------

Deno.test('handler returns a config 500 when STRIPE_WEBHOOK_SECRET is unset, before verification and before any DB call', async () => {
  await withEnv('STRIPE_WEBHOOK_SECRET', undefined, async () => {
    const rawBody = JSON.stringify(invoicePaidEvent())
    const response = await handler(webhookRequest(rawBody), {
      client: neverConfiguredClient() as never,
    })
    assertEquals(response.status, 500)
  })
})

Deno.test('handler returns a config 500 when STRIPE_SECRET_KEY is unset, before the authoritative retrieve (signature verification succeeds)', async () => {
  await withEnv('STRIPE_SECRET_KEY', undefined, async () => {
    const rawBody = JSON.stringify(invoicePaidEvent())
    const response = await handler(webhookRequest(rawBody), {
      verifySignature: stubVerify(invoicePaidEvent()),
      // ownership is configured (a matched row exists) but receiptUpdate/
      // usersUpdate are deliberately left unconfigured -- an attempted write
      // would throw loudly, proving the guard fires before any write.
      client: buildMockClient({ ownership: { data: matchedRow(), error: null } }),
      // refreshStripeState intentionally NOT overridden -- the real default
      // dispatch must guard the empty key before ever calling Stripe.
    })
    assertEquals(response.status, 500)
  })
})

// ---------------------------------------------------------------------------
// Signature verification -- exercised via the REAL production verifier (no
// deps.verifySignature override), proving the wiring end-to-end. Failure ->
// generic 400, NO DB call, NO body/log leak.
// ---------------------------------------------------------------------------

Deno.test('handler rejects a request with no Stripe-Signature header: generic 400, no DB call, no body leak', async () => {
  await withEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET, async () => {
    const rawBody = JSON.stringify(invoicePaidEvent())
    const response = await handler(webhookRequest(rawBody, { signature: null }), {
      client: neverConfiguredClient() as never,
      refreshStripeState: refusingRefresh(),
    })
    assertEquals(response.status, 400)
    const body = await response.text()
    assertEquals(body.includes(SUBSCRIPTION_ID), false)
  })
})

Deno.test('handler rejects a malformed Stripe-Signature header (no t=/v1=): generic 400, no DB call', async () => {
  await withEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET, async () => {
    const rawBody = JSON.stringify(invoicePaidEvent())
    const response = await handler(
      webhookRequest(rawBody, { signature: 'not-a-real-signature-header' }),
      {
        client: neverConfiguredClient() as never,
        refreshStripeState: refusingRefresh(),
      },
    )
    assertEquals(response.status, 400)
  })
})

Deno.test('handler rejects a signature computed with the wrong secret: generic 400, no DB call', async () => {
  await withEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET, async () => {
    const rawBody = JSON.stringify(invoicePaidEvent())
    const badSignature = stripeSignatureHeader('whsec_a_totally_different_secret', rawBody)
    const response = await handler(webhookRequest(rawBody, { signature: badSignature }), {
      client: neverConfiguredClient() as never,
      refreshStripeState: refusingRefresh(),
    })
    assertEquals(response.status, 400)
  })
})

Deno.test('handler rejects a tampered body (signature computed for a DIFFERENT payload than the one delivered): generic 400, no DB call', async () => {
  await withEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET, async () => {
    const signedBody = JSON.stringify(invoicePaidEvent({ id: 'evt_signed_for_this_body' }))
    const deliveredBody = JSON.stringify(
      invoicePaidEvent({ id: 'evt_but_this_body_was_delivered' }),
    )
    const signature = stripeSignatureHeader(WEBHOOK_SECRET, signedBody)
    const response = await handler(webhookRequest(deliveredBody, { signature }), {
      client: neverConfiguredClient() as never,
      refreshStripeState: refusingRefresh(),
    })
    assertEquals(response.status, 400)
  })
})

Deno.test('handler rejects a stale timestamp beyond the tolerance window (replay), using the injected nowMs seam: generic 400', async () => {
  await withEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET, async () => {
    const rawBody = JSON.stringify(invoicePaidEvent())
    const staleT = Math.floor(NOW_MS / 1000) - 400 // beyond the default 300s tolerance
    const signature = stripeSignatureHeader(WEBHOOK_SECRET, rawBody, staleT)
    const response = await handler(webhookRequest(rawBody, { signature }), {
      client: neverConfiguredClient() as never,
      refreshStripeState: refusingRefresh(),
      nowMs: NOW_MS,
    })
    assertEquals(response.status, 400)
  })
})

Deno.test('handler accepts a validly signed request over the EXACT raw bytes (no re-serialization) and proceeds past verification', async () => {
  await withEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET, async () => {
    // Deliberately irregular formatting -- if the handler ever re-serialized
    // (JSON.stringify(JSON.parse(rawBody))) before verifying, this exact-byte
    // signature would no longer match and a real Stripe event would be
    // wrongly rejected.
    const rawBody =
      `{\n  "id": "evt_formatting_sensitive",\n  "type": "customer.subscription.updated",\n  "data": { "object": { "id": "${SUBSCRIPTION_ID}" } }\n}\n`
    const signature = stripeSignatureHeader(WEBHOOK_SECRET, rawBody)
    const response = await handler(webhookRequest(rawBody, { signature }), {
      // nowMs is pinned to the fixture clock so the real verifier's 300s
      // tolerance window is deterministic regardless of the wall clock (the
      // signature timestamp is derived from NOW_MS).
      nowMs: NOW_MS,
      client: buildMockClient({
        ownership: { data: matchedRow(), error: null },
        receiptUpdate: { data: [{ id: 'row-1' }], error: null },
        usersUpdate: { data: [{ id: USER_ID }], error: null },
      }),
      refreshStripeState: () =>
        Promise.resolve({
          provider_subscription_id: SUBSCRIPTION_ID,
          status: 'active',
          current_period_end: FRESH_PERIOD_END,
          tier: 'paid_monthly',
        }),
    })
    assertEquals(response.status, 200)
  })
})

// ---------------------------------------------------------------------------
// Event dispatch -- happy paths for the three handled event types.
// ---------------------------------------------------------------------------

Deno.test('invoice.paid extracts the subscription id from invoice.parent.subscription_details.subscription (Basil), retrieves fresh state, refreshes the row, and updates the paid tier -> 2xx', async () => {
  let capturedReceiptPatch: Record<string, unknown> | null = null
  let capturedUsersPatch: Record<string, unknown> | null = null
  let retrievedId: string | null = null
  const response = await handler(webhookRequest(JSON.stringify(invoicePaidEvent())), {
    verifySignature: stubVerify(invoicePaidEvent()),
    client: buildMockClient({
      ownership: { data: matchedRow(), error: null },
      receiptUpdate: { data: [{ id: 'row-1' }], error: null },
      usersUpdate: { data: [{ id: USER_ID }], error: null },
      onReceiptUpdatePatch: (p) => {
        capturedReceiptPatch = p
      },
      onUsersUpdatePatch: (p) => {
        capturedUsersPatch = p
      },
    }),
    refreshStripeState: (id) => {
      retrievedId = id
      return Promise.resolve({
        provider_subscription_id: SUBSCRIPTION_ID,
        status: 'active',
        current_period_end: FRESH_PERIOD_END,
        tier: 'paid_monthly',
      })
    },
  })
  assertEquals(response.status, 200)
  assertEquals(retrievedId, SUBSCRIPTION_ID)
  const receiptPatch = capturedReceiptPatch as unknown as Record<string, unknown>
  assertEquals(receiptPatch.status, 'active')
  assertEquals(receiptPatch.current_period_end, FRESH_PERIOD_END)
  assertEquals(typeof receiptPatch.last_validated_at, 'string')
  const usersPatch = capturedUsersPatch as unknown as Record<string, unknown>
  assertEquals(usersPatch.subscription_tier, 'paid_monthly')
})

Deno.test('customer.subscription.updated extracts the subscription id from event.data.object.id, refreshes the row, and updates the paid tier -> 2xx', async () => {
  let capturedReceiptPatch: Record<string, unknown> | null = null
  let capturedUsersPatch: Record<string, unknown> | null = null
  const event = subscriptionUpdatedEvent()
  const response = await handler(webhookRequest(JSON.stringify(event)), {
    verifySignature: stubVerify(event),
    client: buildMockClient({
      ownership: { data: matchedRow(), error: null },
      receiptUpdate: { data: [{ id: 'row-1' }], error: null },
      usersUpdate: { data: [{ id: USER_ID }], error: null },
      onReceiptUpdatePatch: (p) => {
        capturedReceiptPatch = p
      },
      onUsersUpdatePatch: (p) => {
        capturedUsersPatch = p
      },
    }),
    refreshStripeState: () =>
      Promise.resolve({
        provider_subscription_id: SUBSCRIPTION_ID,
        status: 'active',
        current_period_end: FRESH_PERIOD_END,
        tier: 'paid_yearly',
      }),
  })
  assertEquals(response.status, 200)
  const receiptPatch = capturedReceiptPatch as unknown as Record<string, unknown>
  assertEquals(receiptPatch.current_period_end, FRESH_PERIOD_END)
  const usersPatch = capturedUsersPatch as unknown as Record<string, unknown>
  assertEquals(usersPatch.subscription_tier, 'paid_yearly')
})

Deno.test('customer.subscription.deleted refreshes status/current_period_end but NEVER touches users.subscription_tier, even when a non-null tier is resolvable (the sweep owns the flip)', async () => {
  let capturedReceiptPatch: Record<string, unknown> | null = null
  const event = subscriptionDeletedEvent()
  const response = await handler(webhookRequest(JSON.stringify(event)), {
    verifySignature: stubVerify(event),
    client: buildMockClient({
      ownership: { data: matchedRow(), error: null },
      receiptUpdate: { data: [{ id: 'row-1' }], error: null },
      // usersUpdate intentionally left UNCONFIGURED -- a call to
      // users.update(...) would throw "users update not configured for this
      // test", failing loudly if the handler ever attempts the tier flip.
      onReceiptUpdatePatch: (p) => {
        capturedReceiptPatch = p
      },
    }),
    refreshStripeState: () =>
      Promise.resolve({
        provider_subscription_id: SUBSCRIPTION_ID,
        status: 'canceled',
        current_period_end: FRESH_PERIOD_END,
        // Deliberately non-null -- proves the EVENT TYPE (not merely a null
        // tier) gates the never-write-tier-on-delete invariant.
        tier: 'paid_monthly',
      }),
  })
  assertEquals(response.status, 200)
  const patch = capturedReceiptPatch as unknown as Record<string, unknown>
  assertEquals(patch.status, 'canceled')
  assertEquals(patch.current_period_end, FRESH_PERIOD_END)
})

// ---------------------------------------------------------------------------
// State-from-retrieve pin -- the write NEVER reflects event.data.object field
// values, only the live-retrieved state.
// ---------------------------------------------------------------------------

Deno.test('the write reflects the RETRIEVED Subscription state, never event.data.object -- a stale/divergent event object does not affect the write', async () => {
  const staleEvent = subscriptionUpdatedEvent() // status 'canceled' / current_period_end 1_600_000_000s baked into the fixture
  let capturedReceiptPatch: Record<string, unknown> | null = null
  const response = await handler(webhookRequest(JSON.stringify(staleEvent)), {
    verifySignature: stubVerify(staleEvent),
    client: buildMockClient({
      ownership: { data: matchedRow(), error: null },
      receiptUpdate: { data: [{ id: 'row-1' }], error: null },
      usersUpdate: { data: [{ id: USER_ID }], error: null },
      onReceiptUpdatePatch: (p) => {
        capturedReceiptPatch = p
      },
    }),
    refreshStripeState: () =>
      Promise.resolve({
        provider_subscription_id: SUBSCRIPTION_ID,
        status: 'active',
        current_period_end: FRESH_PERIOD_END,
        tier: 'paid_monthly',
      }),
  })
  assertEquals(response.status, 200)
  const patch = capturedReceiptPatch as unknown as Record<string, unknown>
  // The FRESH retrieved values win -- the stale event.data.object's
  // status ('canceled') and current_period_end (1_600_000_000s) never reach
  // the write.
  assertEquals(patch.status, 'active')
  assertEquals(patch.current_period_end, FRESH_PERIOD_END)
})

// ---------------------------------------------------------------------------
// Out-of-order / redelivery convergence -- both driven by the SAME live
// retrieve, so an older redelivery processed after a newer event never
// regresses current_period_end.
// ---------------------------------------------------------------------------

Deno.test('out-of-order redelivery converges to the live retrieved state: an OLDER event processed AFTER a NEWER one does not regress current_period_end', async () => {
  const newerEvent = subscriptionUpdatedEvent({ id: 'evt_newer' })
  const olderEvent = subscriptionUpdatedEvent({
    id: 'evt_older',
    data: { object: { id: SUBSCRIPTION_ID, current_period_end: 500_000_000 } },
  })
  const patches: Record<string, unknown>[] = []
  const client = buildMockClient({
    ownership: { data: matchedRow(), error: null },
    receiptUpdate: { data: [{ id: 'row-1' }], error: null },
    usersUpdate: { data: [{ id: USER_ID }], error: null },
    onReceiptUpdatePatch: (p) => patches.push(p),
  })
  const refreshStripeState = () =>
    Promise.resolve({
      provider_subscription_id: SUBSCRIPTION_ID,
      status: 'active',
      current_period_end: FRESH_PERIOD_END,
      tier: 'paid_monthly',
    })
  const first = await handler(webhookRequest(JSON.stringify(newerEvent)), {
    verifySignature: stubVerify(newerEvent),
    client,
    refreshStripeState,
  })
  const second = await handler(webhookRequest(JSON.stringify(olderEvent)), {
    verifySignature: stubVerify(olderEvent),
    client,
    refreshStripeState,
  })
  assertEquals(first.status, 200)
  assertEquals(second.status, 200)
  assertEquals(patches.length, 2)
  // Both writes reflect the SAME live-retrieved state -- the older
  // redelivery's event.data.object never regresses the stored value.
  assertEquals(patches[0]?.current_period_end, FRESH_PERIOD_END)
  assertEquals(patches[1]?.current_period_end, FRESH_PERIOD_END)
})

Deno.test('reprocessing the IDENTICAL event twice converges to the identical end-state (idempotent)', async () => {
  const event = invoicePaidEvent()
  const patches: Record<string, unknown>[] = []
  const client = buildMockClient({
    ownership: { data: matchedRow(), error: null },
    receiptUpdate: { data: [{ id: 'row-1' }], error: null },
    usersUpdate: { data: [{ id: USER_ID }], error: null },
    onReceiptUpdatePatch: (p) => patches.push(p),
  })
  const refreshStripeState = () =>
    Promise.resolve({
      provider_subscription_id: SUBSCRIPTION_ID,
      status: 'active',
      current_period_end: FRESH_PERIOD_END,
      tier: 'paid_monthly',
    })
  const first = await handler(webhookRequest(JSON.stringify(event)), {
    verifySignature: stubVerify(event),
    client,
    refreshStripeState,
  })
  const second = await handler(webhookRequest(JSON.stringify(event)), {
    verifySignature: stubVerify(event),
    client,
    refreshStripeState,
  })
  assertEquals(first.status, 200)
  assertEquals(second.status, 200)
  assertEquals(patches.length, 2)
  assertEquals(patches[0]?.status, patches[1]?.status)
  assertEquals(patches[0]?.current_period_end, patches[1]?.current_period_end)
})

// ---------------------------------------------------------------------------
// Unknown subscription id / unhandled type / underivable plan -- all 2xx
// no-ops with no write (Stripe retries any non-2xx, so these must never error).
// ---------------------------------------------------------------------------

Deno.test('an unknown subscription id (no matching receipt row) is acknowledged 2xx with NO write and NEVER calls the authoritative retrieve', async () => {
  const event = subscriptionUpdatedEvent()
  const response = await handler(webhookRequest(JSON.stringify(event)), {
    verifySignature: stubVerify(event),
    // receiptUpdate/usersUpdate deliberately unconfigured -- proves no write.
    client: buildMockClient({ ownership: { data: null, error: null } }),
    refreshStripeState: refusingRefresh(),
  })
  assertEquals(response.status >= 200 && response.status < 300, true)
})

Deno.test('an unhandled event type is acknowledged 2xx and NEVER touches the database or the authoritative retrieve', async () => {
  const event = unhandledEvent()
  const response = await handler(webhookRequest(JSON.stringify(event)), {
    verifySignature: stubVerify(event),
    client: neverConfiguredClient() as never,
    refreshStripeState: refusingRefresh(),
  })
  assertEquals(response.status >= 200 && response.status < 300, true)
})

Deno.test('a signature-valid body of literal JSON null (or any non-object) is treated as an unhandled event: 2xx no-op, NEVER an uncaught 500 from reading .type off null', async () => {
  // The signed payload here is the literal `null` -- a real caller could sign it.
  // Reading `event.type` off a null parse would throw an uncaught TypeError and
  // surface as a bare 500; the guard must route it to the unhandled-type 2xx no-op
  // with zero DB/provider interaction.
  for (const parsed of [null, 42, 'a string', [1, 2, 3]] as unknown[]) {
    const response = await handler(webhookRequest('null'), {
      verifySignature: () => parsed,
      client: neverConfiguredClient() as never,
      refreshStripeState: refusingRefresh(),
    })
    assertEquals(response.status >= 200 && response.status < 300, true)
  }
})

Deno.test('an underivable plan (tier: null) still refreshes status/current_period_end and SKIPS the tier update, 2xx', async () => {
  let capturedReceiptPatch: Record<string, unknown> | null = null
  const event = invoicePaidEvent()
  const response = await handler(webhookRequest(JSON.stringify(event)), {
    verifySignature: stubVerify(event),
    client: buildMockClient({
      ownership: { data: matchedRow(), error: null },
      receiptUpdate: { data: [{ id: 'row-1' }], error: null },
      // usersUpdate intentionally left unconfigured -- proves no tier-update
      // attempt when the refresh resolves tier: null.
      onReceiptUpdatePatch: (p) => {
        capturedReceiptPatch = p
      },
    }),
    refreshStripeState: () =>
      Promise.resolve({
        provider_subscription_id: SUBSCRIPTION_ID,
        status: 'active',
        current_period_end: FRESH_PERIOD_END,
        tier: null,
      }),
  })
  assertEquals(response.status, 200)
  const patch = capturedReceiptPatch as unknown as Record<string, unknown>
  assertEquals(patch.current_period_end, FRESH_PERIOD_END)
})

Deno.test('invoice.paid falls back to invoice.subscription when the Basil parent.subscription_details shape is absent', async () => {
  const event = {
    id: 'evt_legacy_invoice',
    type: 'invoice.paid',
    data: { object: { id: 'in_legacy', subscription: SUBSCRIPTION_ID } },
  }
  let retrievedId: string | null = null
  const response = await handler(webhookRequest(JSON.stringify(event)), {
    verifySignature: stubVerify(event),
    client: buildMockClient({
      ownership: { data: matchedRow(), error: null },
      receiptUpdate: { data: [{ id: 'row-1' }], error: null },
      usersUpdate: { data: [{ id: USER_ID }], error: null },
    }),
    refreshStripeState: (id) => {
      retrievedId = id
      return Promise.resolve({
        provider_subscription_id: SUBSCRIPTION_ID,
        status: 'active',
        current_period_end: FRESH_PERIOD_END,
        tier: 'paid_monthly',
      })
    },
  })
  assertEquals(response.status, 200)
  assertEquals(retrievedId, SUBSCRIPTION_ID)
})

Deno.test('invoice.paid with no derivable subscription id anywhere is an unknown-subscription 2xx no-op, never a 500', async () => {
  const event = { id: 'evt_no_sub', type: 'invoice.paid', data: { object: { id: 'in_no_sub' } } }
  const response = await handler(webhookRequest(JSON.stringify(event)), {
    verifySignature: stubVerify(event),
    client: neverConfiguredClient() as never,
    refreshStripeState: refusingRefresh(),
  })
  assertEquals(response.status >= 200 && response.status < 300, true)
})

// ---------------------------------------------------------------------------
// Fault mapping -- DB errors and provider faults on the authoritative
// retrieve.
// ---------------------------------------------------------------------------

Deno.test('an error on the initial receipt lookup maps to a 5xx', async () => {
  const event = invoicePaidEvent()
  const response = await handler(webhookRequest(JSON.stringify(event)), {
    verifySignature: stubVerify(event),
    client: buildMockClient({ ownership: { data: null, error: { message: 'connection reset' } } }),
    refreshStripeState: refusingRefresh(),
  })
  assertEquals(response.status >= 500, true)
})

Deno.test('a receipt UPDATE error maps to a 5xx (Stripe should retry)', async () => {
  const event = invoicePaidEvent()
  const response = await handler(webhookRequest(JSON.stringify(event)), {
    verifySignature: stubVerify(event),
    client: buildMockClient({
      ownership: { data: matchedRow(), error: null },
      receiptUpdate: { data: null, error: { code: '57P01', message: 'database is shutting down' } },
    }),
    refreshStripeState: () =>
      Promise.resolve({
        provider_subscription_id: SUBSCRIPTION_ID,
        status: 'active',
        current_period_end: FRESH_PERIOD_END,
        tier: 'paid_monthly',
      }),
  })
  assertEquals(response.status >= 500, true)
})

Deno.test('a provider retrieve timeout maps to a 5xx (Stripe redelivers; the refresh is idempotent)', async () => {
  const event = invoicePaidEvent()
  const response = await handler(webhookRequest(JSON.stringify(event)), {
    verifySignature: stubVerify(event),
    client: buildMockClient({ ownership: { data: matchedRow(), error: null } }),
    refreshStripeState: () =>
      Promise.reject(
        new ReceiptValidationError('provider request timed out', {
          code: 'provider_timeout',
          fault: 'provider',
        }),
      ),
  })
  assertEquals(response.status >= 500, true)
})

Deno.test('a Stripe 5xx/429 rejection on the authoritative retrieve maps to a 5xx, never a 4xx', async () => {
  const event = invoicePaidEvent()
  const response = await handler(webhookRequest(JSON.stringify(event)), {
    verifySignature: stubVerify(event),
    client: buildMockClient({ ownership: { data: matchedRow(), error: null } }),
    refreshStripeState: () =>
      Promise.reject(Object.assign(new Error('stripe api responded 503'), { status: 503 })),
  })
  assertEquals(response.status >= 500, true)
})

Deno.test('a provider-contract-violation from the authoritative retrieve (e.g. a malformed period end) maps to 502', async () => {
  const event = invoicePaidEvent()
  const response = await handler(webhookRequest(JSON.stringify(event)), {
    verifySignature: stubVerify(event),
    client: buildMockClient({ ownership: { data: matchedRow(), error: null } }),
    refreshStripeState: () =>
      Promise.reject(
        new ReceiptValidationError('provider returned an unparseable period end', {
          code: 'provider_contract_violation',
          fault: 'provider',
          status: 502,
        }),
      ),
  })
  assertEquals(response.status, 502)
})

// ---------------------------------------------------------------------------
// Misconfigured environment -- fail-closed 500 envelope, never an uncaught
// throw.
// ---------------------------------------------------------------------------

Deno.test('handler returns a wrapped 500 error envelope (not an uncaught throw) when SUPABASE_URL is unset and no client override is supplied', async () => {
  await withEnv('SUPABASE_URL', undefined, async () => {
    const event = invoicePaidEvent()
    const response = await handler(webhookRequest(JSON.stringify(event)), {
      verifySignature: stubVerify(event),
      refreshStripeState: () =>
        Promise.resolve({
          provider_subscription_id: SUBSCRIPTION_ID,
          status: 'active',
          current_period_end: FRESH_PERIOD_END,
          tier: 'paid_monthly',
        }),
    })
    assertEquals(response.status, 500)
    const body = await response.json()
    assertEquals(typeof body.error, 'string')
  })
})

// ---------------------------------------------------------------------------
// No-leak -- neither the response body nor any log line ever carries the
// event body, the provider subscription id, or the Stripe-Signature header.
// ---------------------------------------------------------------------------

Deno.test('a signature-failure response body never contains the event body, the subscription id, or the (rejected) signature header value', async () => {
  await withEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET, async () => {
    const rawBody = JSON.stringify(invoicePaidEvent())
    const badSignature = 'not-a-real-signature-header'
    const response = await handler(webhookRequest(rawBody, { signature: badSignature }), {
      client: neverConfiguredClient() as never,
      refreshStripeState: refusingRefresh(),
    })
    const text = await response.text()
    assertEquals(text.includes(SUBSCRIPTION_ID), false)
    assertEquals(text.includes(badSignature), false)
    assertEquals(text.includes(rawBody), false)
  })
})

Deno.test('a success response body never contains the event body, the subscription id, or the signature header value', async () => {
  const rawBody = JSON.stringify(invoicePaidEvent())
  const signature = stripeSignatureHeader(WEBHOOK_SECRET, rawBody)
  const response = await handler(webhookRequest(rawBody, { signature }), {
    verifySignature: stubVerify(invoicePaidEvent()),
    client: buildMockClient({
      ownership: { data: matchedRow(), error: null },
      receiptUpdate: { data: [{ id: 'row-1' }], error: null },
      usersUpdate: { data: [{ id: USER_ID }], error: null },
    }),
    refreshStripeState: () =>
      Promise.resolve({
        provider_subscription_id: SUBSCRIPTION_ID,
        status: 'active',
        current_period_end: FRESH_PERIOD_END,
        tier: 'paid_monthly',
      }),
  })
  const text = await response.text()
  assertEquals(text.includes(SUBSCRIPTION_ID), false)
  assertEquals(text.includes(signature), false)
})

Deno.test('no captured console.log/console.error line contains the event body, subscription id, or signature header across a full success run', async () => {
  const originalLog = console.log
  const originalError = console.error
  const capturedLines: string[] = []
  console.log = ((...args: unknown[]) => {
    capturedLines.push(String(args[0] ?? ''))
  }) as typeof console.log
  console.error = ((...args: unknown[]) => {
    capturedLines.push(String(args[0] ?? ''))
  }) as typeof console.error

  const rawBody = JSON.stringify(invoicePaidEvent())
  const signature = stripeSignatureHeader(WEBHOOK_SECRET, rawBody)
  try {
    await handler(webhookRequest(rawBody, { signature }), {
      verifySignature: stubVerify(invoicePaidEvent()),
      client: buildMockClient({
        ownership: { data: matchedRow(), error: null },
        receiptUpdate: { data: [{ id: 'row-1' }], error: null },
        usersUpdate: { data: [{ id: USER_ID }], error: null },
      }),
      refreshStripeState: () =>
        Promise.resolve({
          provider_subscription_id: SUBSCRIPTION_ID,
          status: 'active',
          current_period_end: FRESH_PERIOD_END,
          tier: 'paid_monthly',
        }),
    })
  } finally {
    console.log = originalLog
    console.error = originalError
  }

  for (const line of capturedLines) {
    assertEquals(
      line.includes(SUBSCRIPTION_ID),
      false,
      `leaked subscription id in log line: ${line}`,
    )
    assertEquals(line.includes(signature), false, `leaked signature header in log line: ${line}`)
    assertEquals(line.includes(rawBody), false, `leaked raw event body in log line: ${line}`)
  }
})
