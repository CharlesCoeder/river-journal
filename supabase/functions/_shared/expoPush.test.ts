// Deno unit tests for the shared Expo fan-out module extracted from
// streak_reminder_cron so notify_reply (and future push-sending functions)
// stop duplicating the chunking + response-shape-guard + DeviceNotRegistered
// soft-delete logic.
//
// Run locally with: deno test --allow-env --allow-net supabase/functions/
//
// NOT wired into `yarn vitest` -- supabase/functions/** is excluded from the
// root vitest.config.mts glob (Deno 2 code: URL/npm:/jsr: imports, Deno.*
// globals). This file is `deno test`-only.
//
// Contract pinned down here (per the shared module's documented spec):
//   - EXPO_PUSH_ENDPOINT: 'https://exp.host/--/api/v2/push/send' -- MUST
//     equal streak_reminder_cron's pre-extraction value verbatim (the
//     extraction is a zero-behavior-change refactor for streak).
//   - ExpoMessage<TData>: { to: string; title: string; body: string;
//     data: TData }.
//   - chunkExpoMessages<T>(messages: T[], size = 100): T[][] -- splits an
//     array into chunks of at most `size`, preserving order; 101 messages at
//     the default size produce two chunks of 100 and 1.
//   - parseExpoTickets(response: unknown, orderedTokens: string[]): string[]
//     -- returns the subset of orderedTokens whose positionally-aligned
//     ticket is `{ status: 'error', details: { error: 'DeviceNotRegistered' } }`.
//     Mapping is positional and ONLY performed when `response` is a JSON
//     object whose `data` is an array of EXACTLY orderedTokens.length -- any
//     other shape (length mismatch, or a request-level `{ errors }` body with
//     no `data` at all) returns an EMPTY array (prune nothing). A ticket with
//     a non-DeviceNotRegistered error code is never included.
//   - fanOutExpoPush(client, messages): Promise<{ sentCount: number;
//     deviceNotRegisteredCount: number; errorTicketCount: number;
//     chunkFailureCount: number }> -- chunks the messages, POSTs each chunk to
//     EXPO_PUSH_ENDPOINT, and on a shape-valid response inspects EVERY ticket:
//     `status === 'ok'` increments sentCount, anything else (DeviceNotRegistered,
//     MessageRateExceeded, MessageTooBig, ...) increments errorTicketCount --
//     an error-heavy chunk is never misreported as fully sent. DeviceNotRegistered
//     tickets additionally soft-delete (`user_push_tokens.is_deleted = true`)
//     their positional token via the injected client; a THROWN rejection from
//     that soft-delete (as opposed to a normally-resolved `{ error }`) is
//     caught so it never aborts the loop or skips remaining tokens/chunks.
//     The loop continues to the next chunk on a per-chunk network error or
//     malformed response (never aborts the whole run). Never hits the real
//     network -- tests mock `fetch` and the client.
//
// Red phase: ./expoPush.ts does not exist yet, so every test in this file
// fails at import resolution before a single assertion runs.

import { assertEquals } from 'jsr:@std/assert@1'
import {
  chunkExpoMessages,
  EXPO_PUSH_ENDPOINT,
  fanOutExpoPush,
  parseExpoTickets,
} from './expoPush.ts'

// ---------------------------------------------------------------------------
// EXPO_PUSH_ENDPOINT -- must equal streak_reminder_cron's pre-extraction value
// verbatim (behavior-identity beats DRY: a changed endpoint would be a real
// production behavior change smuggled into a "pure refactor").
// ---------------------------------------------------------------------------

Deno.test('EXPO_PUSH_ENDPOINT equals the documented Expo hosted push endpoint verbatim', () => {
  assertEquals(EXPO_PUSH_ENDPOINT, 'https://exp.host/--/api/v2/push/send')
})

// ---------------------------------------------------------------------------
// chunkExpoMessages -- <=100-per-chunk batching (identical contract to the
// pre-extraction streak_reminder_cron helper).
// ---------------------------------------------------------------------------

Deno.test('chunkExpoMessages splits 101 messages into chunks of 100 and 1', () => {
  const messages = Array.from({ length: 101 }, (_, i) => ({ to: `token-${i}` }))
  const chunks = chunkExpoMessages(messages)
  assertEquals(chunks.length, 2)
  assertEquals(chunks[0]?.length, 100)
  assertEquals(chunks[1]?.length, 1)
})

Deno.test('chunkExpoMessages preserves message order across chunk boundaries', () => {
  const messages = Array.from({ length: 101 }, (_, i) => ({ to: `token-${i}` }))
  const chunks = chunkExpoMessages(messages)
  assertEquals(chunks[0]?.[0]?.to, 'token-0')
  assertEquals(chunks[0]?.[99]?.to, 'token-99')
  assertEquals(chunks[1]?.[0]?.to, 'token-100')
})

Deno.test('chunkExpoMessages returns a single chunk when exactly at the size boundary (100)', () => {
  const messages = Array.from({ length: 100 }, (_, i) => ({ to: `token-${i}` }))
  const chunks = chunkExpoMessages(messages)
  assertEquals(chunks.length, 1)
  assertEquals(chunks[0]?.length, 100)
})

Deno.test('chunkExpoMessages returns an empty array of chunks for an empty input', () => {
  const chunks = chunkExpoMessages([])
  assertEquals(chunks.length, 0)
})

Deno.test('chunkExpoMessages honors a custom chunk size', () => {
  const messages = Array.from({ length: 5 }, (_, i) => ({ to: `token-${i}` }))
  const chunks = chunkExpoMessages(messages, 2)
  assertEquals(chunks.length, 3)
  assertEquals(chunks[0]?.length, 2)
  assertEquals(chunks[1]?.length, 2)
  assertEquals(chunks[2]?.length, 1)
})

// ---------------------------------------------------------------------------
// parseExpoTickets -- DeviceNotRegistered extraction + the response-shape
// guard (the worst self-inflicted failure mode here: mapping a shifted/short
// ticket array by position would soft-delete healthy, still-valid tokens).
// ---------------------------------------------------------------------------

Deno.test('parseExpoTickets flags exactly the tokens whose ticket is a DeviceNotRegistered error', () => {
  const tokens = ['tok-a', 'tok-b', 'tok-c']
  const response = {
    data: [
      { status: 'ok', id: 'ticket-1' },
      { status: 'error', message: 'device gone', details: { error: 'DeviceNotRegistered' } },
      { status: 'ok', id: 'ticket-3' },
    ],
  }
  const flagged = parseExpoTickets(response, tokens)
  assertEquals(flagged, ['tok-b'])
})

Deno.test('parseExpoTickets does not flag a non-DeviceNotRegistered error ticket', () => {
  const tokens = ['tok-a', 'tok-b']
  const response = {
    data: [
      { status: 'error', message: 'rate limited', details: { error: 'MessageRateExceeded' } },
      { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
    ],
  }
  const flagged = parseExpoTickets(response, tokens)
  assertEquals(flagged, [])
})

Deno.test('parseExpoTickets flags zero tokens when data length does not match the chunk length (never map a shifted/short array by position)', () => {
  const tokens = ['tok-a', 'tok-b', 'tok-c']
  const response = {
    data: [
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
      { status: 'ok' },
      // Missing a third ticket -- length mismatch (2 tickets for 3 tokens).
    ],
  }
  const flagged = parseExpoTickets(response, tokens)
  assertEquals(flagged, [])
})

Deno.test('parseExpoTickets flags zero tokens on a request-level { errors } body (no data array at all)', () => {
  const tokens = ['tok-a', 'tok-b']
  const response = { errors: [{ code: 'API_ERROR', message: 'batch rejected' }] }
  const flagged = parseExpoTickets(response, tokens)
  assertEquals(flagged, [])
})

Deno.test('parseExpoTickets flags zero tokens on a malformed (non-object) response body', () => {
  const flagged = parseExpoTickets('not even json', ['tok-a'])
  assertEquals(flagged, [])
})

Deno.test('parseExpoTickets flags zero tokens when data is present but is not an array', () => {
  const flagged = parseExpoTickets({ data: 'unexpected-string' }, ['tok-a'])
  assertEquals(flagged, [])
})

// ---------------------------------------------------------------------------
// fanOutExpoPush -- the chunk -> POST -> shape-guard -> DeviceNotRegistered
// soft-delete loop, mocking the injected client + global fetch.
// ---------------------------------------------------------------------------

interface Message {
  to: string
  title: string
  body: string
  data: Record<string, unknown>
}

function makeMessage(token: string): Message {
  return { to: token, title: 'New reply', body: 'someone replied', data: {} }
}

function fakeClient(onPrune: (token: string) => void) {
  return {
    from(table: string) {
      if (table !== 'user_push_tokens') {
        throw new Error(`unexpected table access "${table}" during fan-out`)
      }
      return {
        update(patch: { is_deleted: boolean }) {
          if (patch.is_deleted !== true) {
            throw new Error('fanOutExpoPush must only ever set is_deleted = true')
          }
          return {
            eq(col: string, value: string) {
              assertEquals(col, 'expo_push_token')
              onPrune(value)
              return Promise.resolve({ error: null })
            },
          }
        },
      }
    },
    // deno-lint-ignore no-explicit-any
  } as any
}

Deno.test('fanOutExpoPush sends every message in a single chunk and reports the full sent count with zero errors', async () => {
  const originalFetch = globalThis.fetch
  let callCount = 0
  globalThis.fetch = ((url: string) => {
    callCount++
    assertEquals(url, EXPO_PUSH_ENDPOINT)
    return Promise.resolve(
      new Response(
        JSON.stringify({ data: [{ status: 'ok' }, { status: 'ok' }] }),
        { status: 200 },
      ),
    )
  }) as typeof fetch

  try {
    const client = fakeClient(() => {
      throw new Error('no token should be pruned when every ticket is ok')
    })
    const messages = [makeMessage('tok-a'), makeMessage('tok-b')]
    const result = await fanOutExpoPush(client, messages)

    assertEquals(callCount, 1)
    assertEquals(result.sentCount, 2)
    assertEquals(result.deviceNotRegisteredCount, 0)
    assertEquals(result.errorTicketCount, 0)
    assertEquals(result.chunkFailureCount, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('fanOutExpoPush POSTs one request per 100-message chunk for a 101-message run', async () => {
  const originalFetch = globalThis.fetch
  const chunkSizes: number[] = []
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    const sent = JSON.parse(init?.body as string) as unknown[]
    chunkSizes.push(sent.length)
    const tickets = sent.map(() => ({ status: 'ok' }))
    return Promise.resolve(new Response(JSON.stringify({ data: tickets }), { status: 200 }))
  }) as typeof fetch

  try {
    const client = fakeClient(() => {
      throw new Error('no token should be pruned when every ticket is ok')
    })
    const messages = Array.from({ length: 101 }, (_, i) => makeMessage(`tok-${i}`))
    const result = await fanOutExpoPush(client, messages)

    assertEquals(chunkSizes, [100, 1])
    assertEquals(result.sentCount, 101)
    assertEquals(result.errorTicketCount, 0)
    assertEquals(result.chunkFailureCount, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('fanOutExpoPush soft-deletes exactly the tokens Expo reports as DeviceNotRegistered, and counts only the ok ticket toward sentCount', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            { status: 'ok' },
            { status: 'error', details: { error: 'DeviceNotRegistered' } },
          ],
        }),
        { status: 200 },
      ),
    )) as typeof fetch

  try {
    const pruned: string[] = []
    const client = fakeClient((token) => pruned.push(token))
    const messages = [makeMessage('tok-live'), makeMessage('tok-dead')]
    const result = await fanOutExpoPush(client, messages)

    assertEquals(pruned, ['tok-dead'])
    // Only the single `status: 'ok'` ticket counts as sent -- the
    // DeviceNotRegistered error ticket must NOT inflate sentCount.
    assertEquals(result.sentCount, 1)
    assertEquals(result.deviceNotRegisteredCount, 1)
    assertEquals(result.errorTicketCount, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('fanOutExpoPush counts only status==="ok" tickets as sent; non-DeviceNotRegistered error tickets inflate errorTicketCount, not sentCount', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            { status: 'ok' },
            { status: 'error', details: { error: 'MessageRateExceeded' } },
            { status: 'error', details: { error: 'MessageTooBig' } },
          ],
        }),
        { status: 200 },
      ),
    )) as typeof fetch

  try {
    const client = fakeClient(() => {
      throw new Error('no token should be pruned -- neither error ticket is DeviceNotRegistered')
    })
    const messages = [makeMessage('tok-a'), makeMessage('tok-b'), makeMessage('tok-c')]
    const result = await fanOutExpoPush(client, messages)

    assertEquals(result.sentCount, 1)
    assertEquals(result.errorTicketCount, 2)
    assertEquals(result.deviceNotRegisteredCount, 0)
    assertEquals(result.chunkFailureCount, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('fanOutExpoPush prunes nothing on a malformed (length-mismatched) chunk response and counts it as a chunk failure', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        // Only one ticket for two messages -- a length mismatch. A positional
        // map here would risk soft-deleting a healthy token.
        JSON.stringify({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }),
        { status: 200 },
      ),
    )) as typeof fetch

  try {
    const client = fakeClient(() => {
      throw new Error('a length-mismatched response must prune nothing')
    })
    const messages = [makeMessage('tok-a'), makeMessage('tok-b')]
    const result = await fanOutExpoPush(client, messages)

    assertEquals(result.sentCount, 0)
    assertEquals(result.deviceNotRegisteredCount, 0)
    assertEquals(result.chunkFailureCount, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('fanOutExpoPush prunes nothing on a request-level { errors } body with no data array', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ errors: [{ code: 'API_ERROR' }] }), { status: 200 }),
    )) as typeof fetch

  try {
    const client = fakeClient(() => {
      throw new Error('a request-level errors body must prune nothing')
    })
    const result = await fanOutExpoPush(client, [makeMessage('tok-a')])

    assertEquals(result.sentCount, 0)
    assertEquals(result.chunkFailureCount, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('fanOutExpoPush counts a non-2xx response as a chunk failure and prunes nothing', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
    )) as typeof fetch

  try {
    const client = fakeClient(() => {
      throw new Error('a non-2xx response must prune nothing')
    })
    const result = await fanOutExpoPush(client, [makeMessage('tok-a')])

    assertEquals(result.sentCount, 0)
    assertEquals(result.chunkFailureCount, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('fanOutExpoPush counts a per-chunk network error as a chunk failure and continues to the remaining chunks (never aborts the run)', async () => {
  const originalFetch = globalThis.fetch
  let call = 0
  globalThis.fetch = (() => {
    call++
    if (call === 1) {
      return Promise.reject(new Error('simulated network failure'))
    }
    return Promise.resolve(
      new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 }),
    )
  }) as typeof fetch

  try {
    const client = fakeClient(() => {
      throw new Error('no prune expected in this test')
    })
    // 101 messages produce two chunks (100 + 1) at the default chunk size --
    // the first (100-message) chunk fails at the network level, and the
    // second (1-message) chunk must still be attempted and counted.
    const messages = Array.from({ length: 101 }, (_, i) => makeMessage(`tok-${i}`))
    const result = await fanOutExpoPush(client, messages)

    assertEquals(call, 2)
    assertEquals(result.chunkFailureCount, 1)
    assertEquals(result.sentCount, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('fanOutExpoPush returns zeroed counts and never calls fetch for an empty message array', async () => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = (() => {
    called = true
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as typeof fetch

  try {
    const client = fakeClient(() => {
      throw new Error('no prune expected for an empty run')
    })
    const result = await fanOutExpoPush(client, [])

    assertEquals(called, false)
    assertEquals(result, {
      sentCount: 0,
      deviceNotRegisteredCount: 0,
      errorTicketCount: 0,
      chunkFailureCount: 0,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// fanOutExpoPush -- a THROWN soft-delete rejection (as opposed to a normally
// resolved { error }) must not escape the loop, skip remaining tokens/chunks,
// or propagate out of fanOutExpoPush as a bare, unenveloped exception.
// ---------------------------------------------------------------------------

Deno.test('fanOutExpoPush does not abort the run when a soft-delete prune throws -- remaining flagged tokens and remaining chunks are still processed, and a result is still returned', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    const sent = JSON.parse(init?.body as string) as unknown[]
    // Every message in every chunk is reported DeviceNotRegistered so this
    // test proves the loop survives a mid-chunk throw AND still processes a
    // later chunk.
    const tickets = sent.map(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } }))
    return Promise.resolve(new Response(JSON.stringify({ data: tickets }), { status: 200 }))
  }) as typeof fetch

  try {
    let call = 0
    const pruned: string[] = []
    const client = {
      from(table: string) {
        if (table !== 'user_push_tokens') {
          throw new Error(`unexpected table access "${table}" during fan-out`)
        }
        return {
          update(patch: { is_deleted: boolean }) {
            assertEquals(patch.is_deleted, true)
            return {
              eq(col: string, token: string) {
                assertEquals(col, 'expo_push_token')
                call++
                if (call === 1) {
                  // Simulate a THROWN rejection escaping the client call
                  // underneath the very first flagged token's prune.
                  return Promise.reject(new Error('simulated client throw'))
                }
                pruned.push(token)
                return Promise.resolve({ error: null })
              },
            }
          },
        }
      },
      // deno-lint-ignore no-explicit-any
    } as any

    // 101 messages -> two chunks (100 + 1), every token flagged
    // DeviceNotRegistered -- 101 total prune attempts, the first of which
    // throws.
    const messages = Array.from({ length: 101 }, (_, i) => makeMessage(`tok-${i}`))
    const result = await fanOutExpoPush(client, messages)

    assertEquals(call, 101)
    assertEquals(pruned.length, 100)
    assertEquals(result.deviceNotRegisteredCount, 101)
    assertEquals(result.errorTicketCount, 101)
    assertEquals(result.sentCount, 0)
    // Both chunks were still delivered successfully (2xx, shape-valid) --
    // the thrown prune must not be misreported as a chunk failure.
    assertEquals(result.chunkFailureCount, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
