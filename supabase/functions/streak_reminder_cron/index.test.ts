// Deno unit tests for streak_reminder_cron's pure, exported helpers plus the
// service-role-gated handler shape. Run locally with:
//   deno test --allow-env --allow-net supabase/functions/
//
// NOT wired into `yarn vitest` -- supabase/functions/** is excluded from the
// root vitest.config.mts glob (Deno 2 code: URL/npm:/jsr: imports, Deno.*
// globals). This file is `deno test`-only.
//
// Contract pinned down here (per the Edge Function's documented spec):
//   - composeStreakCopy(streakLen: number): { title: string; body: string }
//     -- streakLen <= 2 selects the light-touch copy tier; streakLen >= 3
//     selects the gentle-persistence tier. Boundary is between 2 and 3.
//   - chunkExpoMessages<T>(messages: T[], size = 100): T[][]
//     -- splits an array into chunks of at most `size`, preserving order;
//     101 messages at the default size produce two chunks of 100 and 1.
//   - parseExpoTickets(response: unknown, orderedTokens: string[]): string[]
//     -- returns the subset of orderedTokens whose positionally-aligned
//     ticket is `{ status: 'error', details: { error: 'DeviceNotRegistered' } }`.
//     Mapping is positional and ONLY performed when `response` is a JSON
//     object whose `data` is an array of EXACTLY orderedTokens.length --
//     any other shape (a length mismatch, or a request-level `{ errors }`
//     body with no `data` at all) returns an EMPTY array (prune nothing).
//     A ticket with a non-DeviceNotRegistered error code is never included.
//   - handler(req: Request, clientOverride?: SupabaseClient): Promise<Response>
//     -- mirrors notify_moderation_action's shape: requireServiceRole(req)
//     gates the request (401 on a missing/wrong bearer, before any client
//     call); a valid bearer with an empty `{}` body runs a full pass via
//     streak_reminder_candidates() and returns a minimal ok() (no candidate
//     data echoed back -- same enumeration-oracle guard as
//     notify_moderation_action). `clientOverride` exists so tests can inject
//     a mocked Supabase client without a live database; production callers
//     (Deno.serve) never pass it.
//
// Client-usage contract this file also pins down for the handler's
// token-first claim-ordering test (the RPC/table names are already fixed by
// the migration this function reads from, but the exact query-builder
// chaining is an implementation choice -- documented here so the implementer
// has one concrete shape to build to):
//   - client.rpc('streak_reminder_candidates') -> { data: Array<{ user_id,
//     reminder_streak_len }>, error }
//   - client.from('user_push_tokens').select(...).eq('is_deleted', false)
//     .in('user_id', candidateIds) -> { data: Array<{ user_id,
//     expo_push_token }>, error }
//   - client.from('streak_reminder_log').upsert({ user_id, local_send_date },
//     { onConflict: 'user_id,local_send_date', ignoreDuplicates: true })
//     .select('user_id') -> { data, error } (empty data = already claimed
//     today, mirrors notify_moderation_action's ledger-claim shape)
//
// Red phase: ./index.ts does not exist yet, so every test in this file fails
// at import resolution before a single assertion runs.

import { assertEquals } from 'jsr:@std/assert@1'
import { chunkExpoMessages, composeStreakCopy, handler, parseExpoTickets } from './index.ts'

const SERVICE_ROLE_KEY = 'streak-cron-test-service-role-key-0123456789abcdef'

function withServiceRoleKey(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const original = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (value === undefined) {
    Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
  } else {
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', value)
  }
  return (async () => {
    try {
      await fn()
    } finally {
      if (original === undefined) {
        Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
      } else {
        Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', original)
      }
    }
  })()
}

function cronRequest(body: unknown = {}): Request {
  return new Request('http://localhost/streak_reminder_cron', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function badBearerRequest(): Request {
  return new Request('http://localhost/streak_reminder_cron', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer not-the-right-key',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })
}

// ---------------------------------------------------------------------------
// composeStreakCopy -- copy-tier boundaries.
// ---------------------------------------------------------------------------

Deno.test('composeStreakCopy selects the light-touch tier at streakLen 0', () => {
  const copy = composeStreakCopy(0)
  assertEquals(typeof copy.title, 'string')
  assertEquals(typeof copy.body, 'string')
  assertEquals(copy.body, 'Want to write today?')
})

Deno.test('composeStreakCopy selects the light-touch tier at streakLen 1', () => {
  const copy = composeStreakCopy(1)
  assertEquals(copy.body, 'Want to write today?')
})

Deno.test('composeStreakCopy selects the light-touch tier at the upper boundary, streakLen 2', () => {
  const copy = composeStreakCopy(2)
  assertEquals(copy.body, 'Want to write today?')
})

Deno.test('composeStreakCopy selects the gentle-persistence tier at the lower boundary, streakLen 3', () => {
  const copy = composeStreakCopy(3)
  assertEquals(copy.body, 'A few quiet minutes keeps your streak going.')
})

Deno.test('composeStreakCopy selects the gentle-persistence tier at streakLen 10', () => {
  const copy = composeStreakCopy(10)
  assertEquals(copy.body, 'A few quiet minutes keeps your streak going.')
})

Deno.test('composeStreakCopy always returns the same title ("River") across both tiers', () => {
  assertEquals(composeStreakCopy(0).title, 'River')
  assertEquals(composeStreakCopy(5).title, 'River')
})

// ---------------------------------------------------------------------------
// chunkExpoMessages -- ≤100-per-chunk batching.
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
// handler -- manual-invoke posture.
// ---------------------------------------------------------------------------

Deno.test('handler returns 401 for a bad bearer, before any client call', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = {
      rpc(name: string) {
        throw new Error(`unexpected client access ("${name}") before the bearer check`)
      },
      from(table: string) {
        throw new Error(`unexpected client access (table "${table}") before the bearer check`)
      },
      // deno-lint-ignore no-explicit-any
    } as any

    const response = await handler(badBearerRequest(), client)
    assertEquals(response.status, 401)
    const body = await response.json()
    assertEquals(typeof body.error, 'string')
  })
})

Deno.test('handler returns ok() for a valid bearer + empty body when there are zero due candidates', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = {
      rpc(name: string) {
        assertEquals(name, 'streak_reminder_candidates')
        return Promise.resolve({ data: [], error: null })
      },
      from(table: string) {
        throw new Error(`unexpected access to table "${table}" with zero candidates`)
      },
      // deno-lint-ignore no-explicit-any
    } as any

    const response = await handler(cronRequest({}), client)
    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.ok, true)
  })
})

Deno.test('handler never echoes candidate data back in the response body (enumeration-oracle guard)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = {
      rpc(name: string) {
        assertEquals(name, 'streak_reminder_candidates')
        return Promise.resolve({ data: [], error: null })
      },
      from(table: string) {
        throw new Error(`unexpected access to table "${table}"`)
      },
      // deno-lint-ignore no-explicit-any
    } as any

    const response = await handler(cronRequest({}), client)
    const body = await response.json()
    assertEquals(Object.keys(body).sort(), ['ok'])
  })
})

// ---------------------------------------------------------------------------
// handler -- token-first claim ordering: the ledger is claimed ONLY
// for a candidate with >=1 live token; a zero-token candidate must never
// burn today's claim (a device registered an hour later must still be
// reminderable today). Placed here (Deno, mocked client) rather than pgTAP
// because this ordering is handler-level orchestration across the RPC +
// user_push_tokens + the ledger, not a single SQL-level behavior.
// ---------------------------------------------------------------------------

Deno.test('handler claims the ledger only for the candidate with a live token, and skips the zero-token candidate without claiming', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const claimedUserIds: string[] = []

    const client = {
      rpc(name: string) {
        assertEquals(name, 'streak_reminder_candidates')
        return Promise.resolve({
          data: [
            { user_id: 'user-with-token', reminder_streak_len: 1 },
            { user_id: 'user-without-token', reminder_streak_len: 1 },
          ],
          error: null,
        })
      },
      from(table: string) {
        if (table === 'user_push_tokens') {
          return {
            select(_cols: string) {
              return {
                eq(_col: string, _val: boolean) {
                  return {
                    in(_col2: string, _ids: string[]) {
                      return Promise.resolve({
                        data: [{
                          user_id: 'user-with-token',
                          expo_push_token: 'ExponentPushToken[a]',
                        }],
                        error: null,
                      })
                    },
                  }
                },
              }
            },
          }
        }
        if (table === 'streak_reminder_log') {
          return {
            upsert(row: { user_id: string; local_send_date: string }, _opts: unknown) {
              claimedUserIds.push(row.user_id)
              return {
                select(_cols: string) {
                  return Promise.resolve({ data: [{ user_id: row.user_id }], error: null })
                },
              }
            },
          }
        }
        throw new Error(`unexpected access to table "${table}"`)
      },
      // deno-lint-ignore no-explicit-any
    } as any

    const originalFetch = globalThis.fetch
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ status: 'ok', id: 'ticket-1' }] }), { status: 200 }),
      )) as typeof fetch

    try {
      const response = await handler(cronRequest({}), client)
      assertEquals(response.status, 200)
    } finally {
      globalThis.fetch = originalFetch
    }

    assertEquals(claimedUserIds, ['user-with-token'])
  })
})
