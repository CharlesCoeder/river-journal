// Deno unit tests for the shared, allowlist-validated, content-redacting,
// fail-open server PostHog emit helper.
//
// Run locally with: deno test --allow-env --allow-read supabase/functions/
//
// NOT wired into `yarn vitest` -- supabase/functions/** is excluded from the
// root vitest.config.mts glob (Deno 2 code: URL/npm:/jsr: imports, Deno.*
// globals). This file is `deno test`-only.
//
// Contract pinned down here (inferred from the acceptance criteria -- not
// verbatim named in the source spec, mirroring how every other Deno test file
// in this tree pins its own inferred contract):
//
//   export const SERVER_DISTINCT_ID: string -- the one documented non-user
//   distinct id shared by every anonymized/aggregate server event
//   (account_deleted, collective_reply_delivered,
//   moderation_notification_delivered). Value 'server' per the Dev Notes'
//   suggested constant.
//
//   export function applyContentSafetyNets(props): Record<string, unknown> --
//   a pure helper this file infers (not verbatim-named in the source spec),
//   extracted so the two REDUNDANT runtime nets (isContentKey key net +
//   looksLikeFreeText value net) are unit-testable in isolation. This is
//   necessary because the REAL EVENT_ALLOWLIST never actually admits a
//   content-shaped key for any event (yarn lint:posthog guarantees that), so
//   the "key survives allowlist strip" scenario the content-key net defends
//   against can never be reached through the public two-arg validation path
//   with a real event -- unlike the client's captureEvent.e2e.test.ts, Deno
//   has no vi.doMock-equivalent to fabricate a compromised allowlist. Testing
//   this pure function directly (analogous to how contentKeys.ts's own
//   isContentKey/looksLikeFreeText are unit-tested independent of any real
//   caller) pins the net's behavior without that impossible setup. Drops any
//   key isContentKey() matches; drops any string value looksLikeFreeText()
//   matches; passes every other entry through unchanged.
//
//   export async function emitServerEvent(
//     event: string,
//     distinctId: string,
//     props?: Record<string, unknown>,
//     deps?: { fetch?: typeof fetch },
//   ): Promise<void>
//
//   Enforcement order (mirrors the client captureEvent): (1) event absent from
//   EVENT_ALLOWLIST -> return without ever calling fetch, never throws; (2)
//   validateEventProps strips unpermitted keys; (3)+(4) applyContentSafetyNets
//   over the survivors. Gated on POSTHOG_API_KEY (via Deno.env.get, read
//   defensively): unset -> no-op, deps.fetch is NEVER called. When configured,
//   POSTs to `${Deno.env.get('POSTHOG_HOST') ?? 'https://eu.i.posthog.com'}/capture/`
//   with body `{ api_key, event, distinct_id, properties, timestamp }`
//   (Content-Type: application/json). Fail-open: ANY error from deps.fetch
//   (a rejected promise, a thrown error, a non-2xx response, or a stalled
//   request past the internal short timeout) is caught -- emitServerEvent
//   ALWAYS resolves, NEVER rejects/throws, regardless of what deps.fetch does.
//
// Red phase: ./posthog.ts does not exist yet, so every test in this file
// fails at import resolution before a single assertion runs.

import { assertEquals } from 'jsr:@std/assert@1'
import { applyContentSafetyNets, emitServerEvent, SERVER_DISTINCT_ID } from './posthog.ts'

function withPosthogApiKey(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const original = Deno.env.get('POSTHOG_API_KEY')
  if (value === undefined) {
    Deno.env.delete('POSTHOG_API_KEY')
  } else {
    Deno.env.set('POSTHOG_API_KEY', value)
  }
  return (async () => {
    try {
      await fn()
    } finally {
      if (original === undefined) {
        Deno.env.delete('POSTHOG_API_KEY')
      } else {
        Deno.env.set('POSTHOG_API_KEY', original)
      }
    }
  })()
}

function withPosthogHost(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const original = Deno.env.get('POSTHOG_HOST')
  if (value === undefined) {
    Deno.env.delete('POSTHOG_HOST')
  } else {
    Deno.env.set('POSTHOG_HOST', value)
  }
  return (async () => {
    try {
      await fn()
    } finally {
      if (original === undefined) {
        Deno.env.delete('POSTHOG_HOST')
      } else {
        Deno.env.set('POSTHOG_HOST', original)
      }
    }
  })()
}

// A capturing fetch double: records every call and always resolves 200 unless
// a test overrides `impl`.
function capturingFetch(
  impl?: (url: string, init?: RequestInit) => Promise<Response>,
): { fetch: typeof fetch; calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = []
  const fn = ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body as string) : undefined })
    if (impl) return impl(url, init)
    return Promise.resolve(new Response(JSON.stringify({ status: 1 }), { status: 200 }))
  }) as typeof fetch
  return { fetch: fn, calls }
}

// ---------------------------------------------------------------------------
// SERVER_DISTINCT_ID -- the one documented non-user distinct id.
// ---------------------------------------------------------------------------

Deno.test('SERVER_DISTINCT_ID is a non-empty, non-UUID-shaped constant string (never mistakable for a real user id)', () => {
  assertEquals(typeof SERVER_DISTINCT_ID, 'string')
  assertEquals(SERVER_DISTINCT_ID.length > 0, true)
})

// ---------------------------------------------------------------------------
// applyContentSafetyNets -- the two redundant runtime nets, independent of
// validateEventProps/EVENT_ALLOWLIST.
// ---------------------------------------------------------------------------

Deno.test('applyContentSafetyNets drops a content-shaped key even when it would otherwise be an allowed-looking prop', () => {
  const result = applyContentSafetyNets({ recipient_count: 5, body: 'this must never leave' })
  assertEquals(result, { recipient_count: 5 })
})

Deno.test('applyContentSafetyNets drops a content-shaped key case-insensitively', () => {
  const result = applyContentSafetyNets({ sent_count: 1, Note: 'private moderator note' })
  assertEquals(result, { sent_count: 1 })
})

Deno.test('applyContentSafetyNets drops a server-only content key (reason) not present on the client denylist', () => {
  const result = applyContentSafetyNets({ action_type: 'suspend_user', reason: 'harassment details' })
  assertEquals(result, { action_type: 'suspend_user' })
})

const LONG_PROSE =
  'I told my therapist about what happened last spring and it felt like a weight lifted ' +
  'off my chest that I did not know I was carrying for this long, finally.'

Deno.test('applyContentSafetyNets drops a long sentence-shaped VALUE under an otherwise-safe key', () => {
  const result = applyContentSafetyNets({ action_type: LONG_PROSE, sent_count: 2 })
  assertEquals(result, { sent_count: 2 })
})

Deno.test('applyContentSafetyNets preserves a short, enum/id-shaped value under a safe key', () => {
  const result = applyContentSafetyNets({ action_type: 'remove_post', sent_count: 2, failed_count: 0 })
  assertEquals(result, { action_type: 'remove_post', sent_count: 2, failed_count: 0 })
})

Deno.test('applyContentSafetyNets preserves non-string values (counts) untouched', () => {
  const result = applyContentSafetyNets({ recipient_count: 42, failed_count: 0 })
  assertEquals(result, { recipient_count: 42, failed_count: 0 })
})

Deno.test('applyContentSafetyNets never throws on an empty props object', () => {
  let threw = false
  try {
    applyContentSafetyNets({})
  } catch {
    threw = true
  }
  assertEquals(threw, false)
})

// ---------------------------------------------------------------------------
// emitServerEvent -- unknown-event no-op.
// ---------------------------------------------------------------------------

Deno.test('emitServerEvent resolves without calling fetch for an event absent from EVENT_ALLOWLIST', async () => {
  await withPosthogApiKey('phc_test_server_key', async () => {
    const { fetch: fetchDouble, calls } = capturingFetch()
    await emitServerEvent(
      'some_event_nobody_added_to_the_allowlist',
      SERVER_DISTINCT_ID,
      { x: 1 },
      { fetch: fetchDouble },
    )
    assertEquals(calls.length, 0)
  })
})

Deno.test('emitServerEvent never throws for an unknown event, even with malformed props', async () => {
  await withPosthogApiKey('phc_test_server_key', async () => {
    const { fetch: fetchDouble } = capturingFetch()
    let threw = false
    try {
      // deno-lint-ignore no-explicit-any
      await emitServerEvent('not_a_real_event', SERVER_DISTINCT_ID, undefined as any, {
        fetch: fetchDouble,
      })
    } catch {
      threw = true
    }
    assertEquals(threw, false)
  })
})

// ---------------------------------------------------------------------------
// emitServerEvent -- POSTHOG_API_KEY gating.
// ---------------------------------------------------------------------------

Deno.test('emitServerEvent no-ops (never calls fetch) when POSTHOG_API_KEY is unset, even for a fully valid known event', async () => {
  await withPosthogApiKey(undefined, async () => {
    const { fetch: fetchDouble, calls } = capturingFetch()
    await emitServerEvent(
      'collective_reply_delivered',
      SERVER_DISTINCT_ID,
      { recipient_count: 2, sent_count: 2, failed_count: 0 },
      { fetch: fetchDouble },
    )
    assertEquals(calls.length, 0)
  })
})

Deno.test('emitServerEvent calls fetch exactly once when POSTHOG_API_KEY is set and the event is known', async () => {
  await withPosthogApiKey('phc_test_server_key', async () => {
    const { fetch: fetchDouble, calls } = capturingFetch()
    await emitServerEvent(
      'collective_reply_delivered',
      SERVER_DISTINCT_ID,
      { recipient_count: 2, sent_count: 2, failed_count: 0 },
      { fetch: fetchDouble },
    )
    assertEquals(calls.length, 1)
  })
})

// ---------------------------------------------------------------------------
// emitServerEvent -- POST shape (endpoint, body, headers).
// ---------------------------------------------------------------------------

Deno.test('emitServerEvent POSTs to the default EU ingestion-only host (https://eu.i.posthog.com/capture/) when POSTHOG_HOST is unset', async () => {
  await withPosthogApiKey('phc_test_server_key', async () => {
    await withPosthogHost(undefined, async () => {
      const { fetch: fetchDouble, calls } = capturingFetch()
      await emitServerEvent(
        'collective_reply_delivered',
        SERVER_DISTINCT_ID,
        { recipient_count: 1, sent_count: 1, failed_count: 0 },
        { fetch: fetchDouble },
      )
      assertEquals(calls[0]?.url, 'https://eu.i.posthog.com/capture/')
    })
  })
})

Deno.test('emitServerEvent honors a POSTHOG_HOST override for the capture endpoint', async () => {
  await withPosthogApiKey('phc_test_server_key', async () => {
    await withPosthogHost('https://custom.posthog.example', async () => {
      const { fetch: fetchDouble, calls } = capturingFetch()
      await emitServerEvent(
        'collective_reply_delivered',
        SERVER_DISTINCT_ID,
        { recipient_count: 1, sent_count: 1, failed_count: 0 },
        { fetch: fetchDouble },
      )
      assertEquals(calls[0]?.url, 'https://custom.posthog.example/capture/')
    })
  })
})

Deno.test('emitServerEvent POST body is exactly { api_key, event, distinct_id, properties, timestamp }', async () => {
  await withPosthogApiKey('phc_test_server_key', async () => {
    const { fetch: fetchDouble, calls } = capturingFetch()
    await emitServerEvent(
      'collective_reply_delivered',
      SERVER_DISTINCT_ID,
      { recipient_count: 3, sent_count: 2, failed_count: 1 },
      { fetch: fetchDouble },
    )
    const body = calls[0]?.body as Record<string, unknown>
    assertEquals(Object.keys(body).sort(), ['api_key', 'distinct_id', 'event', 'properties', 'timestamp'])
    assertEquals(body.api_key, 'phc_test_server_key')
    assertEquals(body.event, 'collective_reply_delivered')
    assertEquals(body.distinct_id, SERVER_DISTINCT_ID)
    assertEquals(body.properties, { recipient_count: 3, sent_count: 2, failed_count: 1 })
    assertEquals(typeof body.timestamp, 'string')
    assertEquals(Number.isNaN(new Date(body.timestamp as string).getTime()), false)
  })
})

Deno.test('emitServerEvent passes distinct_id through exactly as given (a real callerUid, not always SERVER_DISTINCT_ID)', async () => {
  await withPosthogApiKey('phc_test_server_key', async () => {
    const { fetch: fetchDouble, calls } = capturingFetch()
    await emitServerEvent(
      'subscription_purchased',
      '00000000-0000-0000-0000-00000000c0de',
      { user_id: '00000000-0000-0000-0000-00000000c0de', provider: 'stripe', tier: 'paid_monthly' },
      { fetch: fetchDouble },
    )
    const body = calls[0]?.body as Record<string, unknown>
    assertEquals(body.distinct_id, '00000000-0000-0000-0000-00000000c0de')
  })
})

// ---------------------------------------------------------------------------
// emitServerEvent -- full pipeline: allowlist strip + the two runtime nets,
// through the REAL EVENT_ALLOWLIST (no mocking needed -- the free-text net is
// naturally reachable because it inspects VALUES under otherwise-allowed
// keys, unlike the content-key net).
// ---------------------------------------------------------------------------

Deno.test('emitServerEvent strips an unpermitted prop key before sending', async () => {
  await withPosthogApiKey('phc_test_server_key', async () => {
    const { fetch: fetchDouble, calls } = capturingFetch()
    await emitServerEvent(
      'collective_reply_delivered',
      SERVER_DISTINCT_ID,
      { recipient_count: 3, sent_count: 2, failed_count: 1, rogue_key: 'nope' },
      { fetch: fetchDouble },
    )
    const properties = (calls[0]?.body as Record<string, unknown>).properties as Record<
      string,
      unknown
    >
    assertEquals('rogue_key' in properties, false)
    assertEquals(properties, { recipient_count: 3, sent_count: 2, failed_count: 1 })
  })
})

Deno.test('emitServerEvent drops a free-text-shaped value under an allowed key (action_type) via the real allowlist + real nets', async () => {
  await withPosthogApiKey('phc_test_server_key', async () => {
    const { fetch: fetchDouble, calls } = capturingFetch()
    await emitServerEvent(
      'moderation_notification_delivered',
      SERVER_DISTINCT_ID,
      { action_type: LONG_PROSE, sent_count: 1, failed_count: 0 },
      { fetch: fetchDouble },
    )
    const properties = (calls[0]?.body as Record<string, unknown>).properties as Record<
      string,
      unknown
    >
    assertEquals('action_type' in properties, false)
    assertEquals(properties.sent_count, 1)
    assertEquals(properties.failed_count, 0)
  })
})

// ---------------------------------------------------------------------------
// emitServerEvent -- fail-open. NEVER throws/rejects, regardless of what the
// injected fetch does.
// ---------------------------------------------------------------------------

Deno.test('emitServerEvent resolves without throwing when fetch rejects (network error)', async () => {
  await withPosthogApiKey('phc_test_server_key', async () => {
    let threw = false
    try {
      await emitServerEvent(
        'collective_reply_delivered',
        SERVER_DISTINCT_ID,
        { recipient_count: 1, sent_count: 1, failed_count: 0 },
        { fetch: (() => Promise.reject(new Error('network unreachable'))) as typeof fetch },
      )
    } catch {
      threw = true
    }
    assertEquals(threw, false)
  })
})

Deno.test('emitServerEvent resolves without throwing when fetch throws synchronously', async () => {
  await withPosthogApiKey('phc_test_server_key', async () => {
    let threw = false
    try {
      await emitServerEvent(
        'collective_reply_delivered',
        SERVER_DISTINCT_ID,
        { recipient_count: 1, sent_count: 1, failed_count: 0 },
        {
          fetch: (() => {
            throw new Error('synchronous SDK-adjacent crash')
          }) as typeof fetch,
        },
      )
    } catch {
      threw = true
    }
    assertEquals(threw, false)
  })
})

Deno.test('emitServerEvent resolves without throwing when fetch returns a non-2xx response', async () => {
  await withPosthogApiKey('phc_test_server_key', async () => {
    let threw = false
    try {
      await emitServerEvent(
        'collective_reply_delivered',
        SERVER_DISTINCT_ID,
        { recipient_count: 1, sent_count: 1, failed_count: 0 },
        {
          fetch: (() =>
            Promise.resolve(new Response('internal error', { status: 500 }))) as typeof fetch,
        },
      )
    } catch {
      threw = true
    }
    assertEquals(threw, false)
  })
})

Deno.test('emitServerEvent resolves within a bounded time (does not hang the caller) even when fetch never settles', async () => {
  await withPosthogApiKey('phc_test_server_key', async () => {
    const neverSettles = (() => new Promise<Response>(() => {})) as typeof fetch
    const emitPromise = emitServerEvent(
      'collective_reply_delivered',
      SERVER_DISTINCT_ID,
      { recipient_count: 1, sent_count: 1, failed_count: 0 },
      { fetch: neverSettles },
    )
    const timeoutMarker = Symbol('timeout')
    const boundedRace = await Promise.race([
      emitPromise.then(() => 'resolved' as const),
      new Promise((resolve) => setTimeout(() => resolve(timeoutMarker), 6000)),
    ])
    assertEquals(boundedRace, 'resolved')
  })
})

Deno.test('a fail-open emit does not surface the props payload in any thrown/logged value the caller could observe', async () => {
  await withPosthogApiKey('phc_test_server_key', async () => {
    const secretishMarker = 'zz-should-never-surface-in-any-error-zz'
    let threw = false
    let caughtMessage = ''
    try {
      await emitServerEvent(
        'moderation_notification_delivered',
        SERVER_DISTINCT_ID,
        { action_type: secretishMarker, sent_count: 1, failed_count: 0 },
        { fetch: (() => Promise.reject(new Error('boom'))) as typeof fetch },
      )
    } catch (e) {
      threw = true
      caughtMessage = String(e)
    }
    assertEquals(threw, false)
    assertEquals(caughtMessage.includes(secretishMarker), false)
  })
})
