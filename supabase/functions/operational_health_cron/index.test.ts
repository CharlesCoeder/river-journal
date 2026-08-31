// Deno unit tests for operational_health_cron's pure, exported helpers plus
// the service-role-gated handler shape.
//
// Run locally with: deno test --allow-read --allow-env supabase/functions/
//
// NOT wired into `yarn vitest` -- supabase/functions/** is excluded from the
// root vitest.config.mts glob (Deno 2 code: URL/npm:/jsr: imports, Deno.*
// globals). This file is `deno test`-only.
//
// Contract pinned down here:
//
//   export async function handler(
//     req: Request,
//     clientOverride?: SupabaseClient,
//     now: Date = new Date(),
//   ): Promise<Response>
//   -- requireServiceRole(req) gates the request FIRST (401 before any
//   client/RPC call); the body is read-and-discarded (an empty/absent/non-JSON
//   body never fails the request); the client is
//   `clientOverride ?? createServiceRoleClient()` constructed inside a
//   try/catch that logs + returns a 500 `err()` on failure. The optional third
//   `now` parameter is the injectable clock the once-daily gate reads,
//   defaulting to `new Date()` in production so `Deno.serve` callers never
//   pass it. Always returns a well-formed `ok()`/`err()` -- NEVER an unhandled
//   throw, regardless of what either DB pass, the log write, or the Sentry
//   alert does.
//
//   Every tick (unconditionally): the moderation aggregate RPC
//   (`operational_health_moderation_queue`) resolves
//   `{ data: [{ pending_count, oldest_pending_age_seconds }], error }`; on
//   success the row's values are recorded verbatim in a single
//   `operational_health_log` insert (including the zero/zero empty-queue case
//   -- the SQL side's COALESCE guarantees non-null zeros, so the handler must
//   record them as-is, never skip the pass just because the queue is empty).
//   Past either alert threshold (pending_count > 20, or
//   oldest_pending_age_seconds > 24h) the handler additionally fires ONE
//   fail-open Sentry alert via captureServerAlert. An `error` RPC result is
//   logged and this pass's columns are omitted WITHOUT aborting the
//   sync-opt-in pass or returning a non-ok response.
//
//   Once per operator-day (gated by isDailySnapshotWindow(now,
//   readOperatorTimezone())): the sync-opt-in aggregate RPC
//   (`operational_health_sync_opt_in`) resolves
//   `{ data: [{ opted_in_count, total_count }], error }` and, on success, its
//   values join the SAME operational_health_log row. Outside the window,
//   neither the RPC nor the columns happen.
//
//   Heartbeat: a single `logInfo('operational_health.run', { passes,
//   sync_opt_in_sampled, duration_ms })` call -- `passes` is `['moderation']`
//   normally and `['moderation', 'sync_opt_in']` when the daily gate opened
//   this tick. NO counts and NO user/id fields ever ride this log line --
//   those land exclusively in the service-role-only log table.
//
//   The success response is always a minimal `ok()` -- no queue/count data is
//   ever echoed back (enumeration-oracle guard, matching every other
//   service-role-gated cron function in this tree).

import { assertEquals } from 'jsr:@std/assert@1'
import {
  handler,
  isDailySnapshotWindow,
  MODERATION_OLDEST_AGE_ALERT_SECONDS,
  MODERATION_PENDING_ALERT_THRESHOLD,
  readOperatorTimezone,
} from './index.ts'

const SERVICE_ROLE_KEY = 'operational-health-cron-test-service-role-key-0123456789abcdef'
const TEST_SENTRY_DSN = 'https://abc123publickey@o111222.ingest.us.sentry.io/4509999'

// ---------------------------------------------------------------------------
// Env helpers -- save/restore around each test, mirroring every sibling Deno
// suite's withX(value, fn) shape.
// ---------------------------------------------------------------------------

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

function withServiceRoleKey(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  return withEnv('SUPABASE_SERVICE_ROLE_KEY', value, fn)
}

function withSentryDsn(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  return withEnv('SENTRY_DSN', value, fn)
}

function withOperatorTimezone(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  return withEnv('OPERATOR_TIMEZONE', value, fn)
}

function cronRequest(body: unknown = {}): Request {
  return new Request('http://localhost/operational_health_cron', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function badBearerRequest(): Request {
  return new Request('http://localhost/operational_health_cron', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer not-the-right-key',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })
}

// ---------------------------------------------------------------------------
// Mock client -- routes client.rpc(name) to a per-test-configured result and
// captures client.from('operational_health_log').insert(row) writes. Throws on
// any call not explicitly configured, so an unexpected extra call (e.g. the
// sync-opt-in RPC firing when the gate should be closed, or a write to a
// different table) fails the test loudly rather than silently returning
// undefined.
// ---------------------------------------------------------------------------

interface RpcResult {
  data: unknown
  error: unknown
}

interface MockClientConfig {
  moderation?: RpcResult
  syncOptIn?: RpcResult
  insertError?: unknown
}

interface MockCalls {
  rpc: string[]
  inserts: Array<Record<string, unknown>>
}

function newCalls(): MockCalls {
  return { rpc: [], inserts: [] }
}

// deno-lint-ignore no-explicit-any
function buildMockClient(config: MockClientConfig, calls: MockCalls): any {
  return {
    rpc(name: string, _args?: unknown) {
      calls.rpc.push(name)
      if (name === 'operational_health_moderation_queue') {
        if (!config.moderation) {
          throw new Error('unexpected call to operational_health_moderation_queue')
        }
        return Promise.resolve(config.moderation)
      }
      if (name === 'operational_health_sync_opt_in') {
        if (!config.syncOptIn) {
          throw new Error('unexpected call to operational_health_sync_opt_in')
        }
        return Promise.resolve(config.syncOptIn)
      }
      throw new Error(`unexpected rpc call: "${name}"`)
    },
    from(table: string) {
      if (table !== 'operational_health_log') {
        throw new Error(`unexpected access to table "${table}"`)
      }
      return {
        insert(row: Record<string, unknown>) {
          calls.inserts.push(row)
          return Promise.resolve({ error: config.insertError ?? null })
        },
      }
    },
  }
}

const OK_MODERATION: RpcResult = {
  data: [{ pending_count: 3, oldest_pending_age_seconds: 120 }],
  error: null,
}

const EMPTY_MODERATION: RpcResult = {
  data: [{ pending_count: 0, oldest_pending_age_seconds: 0 }],
  error: null,
}

const BACKLOGGED_MODERATION: RpcResult = {
  data: [
    {
      pending_count: MODERATION_PENDING_ALERT_THRESHOLD + 1,
      oldest_pending_age_seconds: 120,
    },
  ],
  error: null,
}

const STALE_MODERATION: RpcResult = {
  data: [
    {
      pending_count: 1,
      oldest_pending_age_seconds: MODERATION_OLDEST_AGE_ALERT_SECONDS + 1,
    },
  ],
  error: null,
}

const OK_SYNC_OPT_IN: RpcResult = {
  data: [{ opted_in_count: 42, total_count: 100 }],
  error: null,
}

// A UTC instant that is 00:10 UTC -- inside the first-30-min window when
// OPERATOR_TIMEZONE is 'UTC'.
const NOW_INSIDE_WINDOW_UTC = new Date('2026-07-16T00:10:00.000Z')
// A UTC instant that is 12:00 UTC -- well outside the window when
// OPERATOR_TIMEZONE is 'UTC'.
const NOW_OUTSIDE_WINDOW_UTC = new Date('2026-07-16T12:00:00.000Z')

// ---------------------------------------------------------------------------
// Fetch stub -- captures every Sentry envelope POST (this function issues no
// other outbound fetch).
// ---------------------------------------------------------------------------

function withCapturedFetch(
  fn: (calls: Array<{ url: string; body: string }>) => Promise<void>,
  impl?: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<void> {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; body: string }> = []
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') })
    if (impl) return impl(url, init)
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as typeof fetch
  return fn(calls).finally(() => {
    globalThis.fetch = originalFetch
  })
}

// Captures console output so the heartbeat's exact field shape can be
// asserted without depending on logInfo/logError's internal formatting beyond
// "one JSON line per call".
function withCapturedConsole(
  fn: (logs: { info: string[]; error: string[] }) => Promise<void>,
): Promise<void> {
  const originalLog = console.log
  const originalError = console.error
  const logs = { info: [] as string[], error: [] as string[] }
  console.log = ((line: string) => {
    logs.info.push(String(line))
  }) as typeof console.log
  console.error = ((line: string) => {
    logs.error.push(String(line))
  }) as typeof console.error
  return fn(logs).finally(() => {
    console.log = originalLog
    console.error = originalError
  })
}

// ===========================================================================
// Envelope + minimal ok() body.
// ===========================================================================

Deno.test('handler returns 401 for a bad bearer, before any client/RPC call', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const calls = newCalls()
    const client = buildMockClient({}, calls)
    const response = await handler(badBearerRequest(), client, NOW_OUTSIDE_WINDOW_UTC)
    assertEquals(response.status, 401)
    const body = await response.json()
    assertEquals(typeof body.error, 'string')
    assertEquals(calls.rpc, [])
    assertEquals(calls.inserts, [])
  })
})

Deno.test('handler returns 401 for a missing Authorization header, before any client/RPC call', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const calls = newCalls()
    const client = buildMockClient({}, calls)
    const bareRequest = new Request('http://localhost/operational_health_cron', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const response = await handler(bareRequest, client, NOW_OUTSIDE_WINDOW_UTC)
    assertEquals(response.status, 401)
    assertEquals(calls.rpc, [])
  })
})

Deno.test('handler succeeds on an empty {} body', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = buildMockClient({ moderation: EMPTY_MODERATION }, newCalls())
    const response = await handler(cronRequest({}), client, NOW_OUTSIDE_WINDOW_UTC)
    assertEquals(response.status, 200)
  })
})

Deno.test('handler succeeds on an absent/non-JSON body (read-and-discard, never a failure)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = buildMockClient({ moderation: EMPTY_MODERATION }, newCalls())
    const rawRequest = new Request('http://localhost/operational_health_cron', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    })
    const response = await handler(rawRequest, client, NOW_OUTSIDE_WINDOW_UTC)
    assertEquals(response.status, 200)
  })
})

Deno.test('handler returns a minimal ok() body with NO queue/count data (enumeration-oracle guard)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = buildMockClient({ moderation: OK_MODERATION }, newCalls())
    const response = await handler(cronRequest({}), client, NOW_OUTSIDE_WINDOW_UTC)
    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(Object.keys(body).sort(), ['ok'])
  })
})

Deno.test('handler returns a 500 err() when client construction fails and no clientOverride is given', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withEnv('SUPABASE_URL', undefined, async () => {
      const response = await handler(cronRequest({}), undefined, NOW_OUTSIDE_WINDOW_UTC)
      assertEquals(response.status, 500)
      const body = await response.json()
      assertEquals(typeof body.error, 'string')
    })
  })
})

// ===========================================================================
// Moderation pass -- runs every tick, records into operational_health_log.
// ===========================================================================

Deno.test('handler calls the moderation aggregate RPC on every tick, gate open or closed', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const calls = newCalls()
    const client = buildMockClient({ moderation: OK_MODERATION }, calls)
    await handler(cronRequest({}), client, NOW_OUTSIDE_WINDOW_UTC)
    assertEquals(calls.rpc.includes('operational_health_moderation_queue'), true)
  })
})

Deno.test('handler records the moderation RPC row values verbatim in one operational_health_log insert', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const calls = newCalls()
    const client = buildMockClient({ moderation: OK_MODERATION }, calls)
    const response = await handler(cronRequest({}), client, NOW_OUTSIDE_WINDOW_UTC)
    assertEquals(response.status, 200)
    assertEquals(calls.inserts, [{ pending_count: 3, oldest_pending_age_seconds: 120 }])
  })
})

Deno.test('handler records {0,0} on an empty queue (COALESCE zeros, never skipped)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const calls = newCalls()
    const client = buildMockClient({ moderation: EMPTY_MODERATION }, calls)
    await handler(cronRequest({}), client, NOW_OUTSIDE_WINDOW_UTC)
    assertEquals(calls.inserts, [{ pending_count: 0, oldest_pending_age_seconds: 0 }])
  })
})

Deno.test('handler does not call the moderation RPC before the bearer check', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const calls = newCalls()
    const client = buildMockClient({}, calls)
    await handler(badBearerRequest(), client, NOW_OUTSIDE_WINDOW_UTC)
    assertEquals(calls.rpc, [])
  })
})

// ===========================================================================
// Moderation backlog alert -- Sentry envelope past either threshold.
// ===========================================================================

Deno.test('handler fires NO Sentry alert when the queue is at/below both thresholds', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withSentryDsn(TEST_SENTRY_DSN, async () => {
      await withCapturedFetch(async (fetchCalls) => {
        const client = buildMockClient({ moderation: OK_MODERATION }, newCalls())
        await handler(cronRequest({}), client, NOW_OUTSIDE_WINDOW_UTC)
        assertEquals(fetchCalls.length, 0)
      })
    })
  })
})

Deno.test('handler fires one Sentry alert with aggregate counts when pending_count crosses the threshold', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withSentryDsn(TEST_SENTRY_DSN, async () => {
      await withCapturedFetch(async (fetchCalls) => {
        const client = buildMockClient({ moderation: BACKLOGGED_MODERATION }, newCalls())
        const response = await handler(cronRequest({}), client, NOW_OUTSIDE_WINDOW_UTC)
        assertEquals(response.status, 200)
        assertEquals(fetchCalls.length, 1)
        assertEquals(fetchCalls[0]?.url.includes('/envelope/'), true)
        const eventLine = JSON.parse(fetchCalls[0]?.body.split('\n')[2] ?? '{}')
        assertEquals(eventLine.message, { formatted: 'moderation queue backlog' })
        assertEquals(eventLine.extra, {
          pending_count: MODERATION_PENDING_ALERT_THRESHOLD + 1,
          oldest_pending_age_seconds: 120,
        })
      })
    })
  })
})

Deno.test('handler fires the Sentry alert when the oldest pending flag crosses the age threshold', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withSentryDsn(TEST_SENTRY_DSN, async () => {
      await withCapturedFetch(async (fetchCalls) => {
        const client = buildMockClient({ moderation: STALE_MODERATION }, newCalls())
        await handler(cronRequest({}), client, NOW_OUTSIDE_WINDOW_UTC)
        assertEquals(fetchCalls.length, 1)
      })
    })
  })
})

Deno.test('a backlogged queue is still recorded in the log table even when SENTRY_DSN is unset (no fetch)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withSentryDsn(undefined, async () => {
      await withCapturedFetch(async (fetchCalls) => {
        const calls = newCalls()
        const client = buildMockClient({ moderation: BACKLOGGED_MODERATION }, calls)
        const response = await handler(cronRequest({}), client, NOW_OUTSIDE_WINDOW_UTC)
        assertEquals(response.status, 200)
        assertEquals(fetchCalls.length, 0)
        assertEquals(calls.inserts.length, 1)
      })
    })
  })
})

Deno.test('a Sentry outage (fetch rejects) does not crash the handler -- the log write and ok() still happen', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withSentryDsn(TEST_SENTRY_DSN, async () => {
      const calls = newCalls()
      await withCapturedFetch(
        async (_fetchCalls) => {
          const client = buildMockClient({ moderation: BACKLOGGED_MODERATION }, calls)
          let threw = false
          let response: Response | undefined
          try {
            response = await handler(cronRequest({}), client, NOW_OUTSIDE_WINDOW_UTC)
          } catch {
            threw = true
          }
          assertEquals(threw, false)
          assertEquals(response?.status, 200)
        },
        () => Promise.reject(new Error('network unreachable')),
      )
      assertEquals(calls.inserts.length, 1)
    })
  })
})

// ===========================================================================
// isDailySnapshotWindow -- pure gate, timezone + DST boundaries.
// ===========================================================================

Deno.test('isDailySnapshotWindow is true at exactly local 00:00:00', () => {
  assertEquals(isDailySnapshotWindow(new Date('2026-07-16T00:00:00.000Z'), 'UTC'), true)
})

Deno.test('isDailySnapshotWindow is true at local 00:29:59 (just inside the window)', () => {
  assertEquals(isDailySnapshotWindow(new Date('2026-07-16T00:29:59.000Z'), 'UTC'), true)
})

Deno.test('isDailySnapshotWindow is false at local 00:30:00 (window end, exclusive)', () => {
  assertEquals(isDailySnapshotWindow(new Date('2026-07-16T00:30:00.000Z'), 'UTC'), false)
})

Deno.test('isDailySnapshotWindow is false at local 23:59:59 the day before (just before the window opens)', () => {
  assertEquals(isDailySnapshotWindow(new Date('2026-07-15T23:59:59.000Z'), 'UTC'), false)
})

Deno.test('isDailySnapshotWindow is false well outside the window (local noon)', () => {
  assertEquals(isDailySnapshotWindow(new Date('2026-07-16T12:00:00.000Z'), 'UTC'), false)
})

Deno.test('isDailySnapshotWindow evaluates against the GIVEN IANA timezone, not literal UTC wall-clock', () => {
  // 2026-07-15T15:10:00Z is 00:10 local in Asia/Tokyo (UTC+9, no DST) -- inside
  // the window there, but 15:10 in UTC itself -- well outside the window when
  // evaluated against 'UTC'. Same instant, different verdicts by timezone.
  const instant = new Date('2026-07-15T15:10:00.000Z')
  assertEquals(isDailySnapshotWindow(instant, 'Asia/Tokyo'), true)
  assertEquals(isDailySnapshotWindow(instant, 'UTC'), false)
})

Deno.test('isDailySnapshotWindow stays correct across a DST transition (America/New_York, EST vs EDT)', () => {
  // 2026-02-15T05:10:00Z is local 00:10 in America/New_York under EST
  // (UTC-5, pre-spring-forward).
  const beforeDst = new Date('2026-02-15T05:10:00.000Z')
  assertEquals(isDailySnapshotWindow(beforeDst, 'America/New_York'), true)

  // 2026-04-15T04:10:00Z is local 00:10 in America/New_York under EDT
  // (UTC-4, post-spring-forward, after the March 2026 change). A naive
  // implementation caching a fixed UTC-5 offset would compute local 23:10
  // the PREVIOUS day here and wrongly return false.
  const afterDst = new Date('2026-04-15T04:10:00.000Z')
  assertEquals(isDailySnapshotWindow(afterDst, 'America/New_York'), true)

  // The same UTC clock-time (04:10Z) evaluated in February (still EST) is
  // local 23:10 the previous day -- outside the window. This pins that the
  // function re-derives the offset per instant rather than using one fixed
  // offset for the whole year.
  const wrongOffsetForFebruary = new Date('2026-02-15T04:10:00.000Z')
  assertEquals(isDailySnapshotWindow(wrongOffsetForFebruary, 'America/New_York'), false)
})

// ===========================================================================
// readOperatorTimezone -- defensive env read.
// ===========================================================================

Deno.test('readOperatorTimezone returns the OPERATOR_TIMEZONE env value when set', async () => {
  await withOperatorTimezone('Asia/Tokyo', () => {
    assertEquals(readOperatorTimezone(), 'Asia/Tokyo')
    return Promise.resolve()
  })
})

Deno.test('readOperatorTimezone returns a non-empty, Intl-parseable IANA fallback when unset', async () => {
  await withOperatorTimezone(undefined, () => {
    const tz = readOperatorTimezone()
    assertEquals(typeof tz, 'string')
    assertEquals(tz.length > 0, true)
    // Must be a real IANA zone Intl can construct a formatter against --
    // this throws a RangeError for a garbage/empty zone name.
    let threw = false
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
    } catch {
      threw = true
    }
    assertEquals(threw, false)
    return Promise.resolve()
  })
})

Deno.test('readOperatorTimezone falls back to the documented default when OPERATOR_TIMEZONE is set but not a valid IANA zone', async () => {
  await withOperatorTimezone('US/Pacifik', () => {
    const tz = readOperatorTimezone()
    assertEquals(tz, 'America/New_York')
    return Promise.resolve()
  })
})

Deno.test('readOperatorTimezone falls back to the documented default when OPERATOR_TIMEZONE is whitespace-only garbage', async () => {
  await withOperatorTimezone('   not a zone   ', () => {
    const tz = readOperatorTimezone()
    assertEquals(tz, 'America/New_York')
    return Promise.resolve()
  })
})

Deno.test('handler never throws when OPERATOR_TIMEZONE is set to an invalid IANA zone -- gate behaves as if the default zone were configured', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withOperatorTimezone('US/Pacifik', async () => {
      const calls = newCalls()
      const client = buildMockClient(
        { moderation: OK_MODERATION, syncOptIn: OK_SYNC_OPT_IN },
        calls,
      )

      // An instant inside the first-30-min window of the operator-local day
      // for the documented default zone (America/New_York, UTC-4 in July),
      // i.e. 00:10 local time -> 04:10 UTC. If the invalid zone were used
      // as-is (rather than falling back), Intl would throw a RangeError
      // instead of gating correctly.
      const nowInsideDefaultZoneWindow = new Date('2026-07-16T04:10:00.000Z')

      const res = await handler(cronRequest(), client, nowInsideDefaultZoneWindow)
      assertEquals(res.status, 200)
      assertEquals(calls.rpc.includes('operational_health_sync_opt_in'), true)
    })
  })
})

// ===========================================================================
// Sync-opt-in pass -- once-daily gate wired into the handler.
// ===========================================================================

Deno.test('handler does NOT call the sync-opt-in RPC or record its columns when the gate is closed', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withOperatorTimezone('UTC', async () => {
      const calls = newCalls()
      const client = buildMockClient({ moderation: OK_MODERATION }, calls)
      const response = await handler(cronRequest({}), client, NOW_OUTSIDE_WINDOW_UTC)
      assertEquals(response.status, 200)
      assertEquals(calls.rpc.includes('operational_health_sync_opt_in'), false)
      assertEquals(calls.inserts, [{ pending_count: 3, oldest_pending_age_seconds: 120 }])
    })
  })
})

Deno.test('handler calls the sync-opt-in RPC and records its columns in the SAME row when the gate is open', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withOperatorTimezone('UTC', async () => {
      const calls = newCalls()
      const client = buildMockClient(
        { moderation: OK_MODERATION, syncOptIn: OK_SYNC_OPT_IN },
        calls,
      )
      const response = await handler(cronRequest({}), client, NOW_INSIDE_WINDOW_UTC)
      assertEquals(response.status, 200)
      assertEquals(calls.rpc.includes('operational_health_sync_opt_in'), true)
      assertEquals(calls.inserts, [
        {
          pending_count: 3,
          oldest_pending_age_seconds: 120,
          opted_in_count: 42,
          total_count: 100,
        },
      ])
    })
  })
})

// ===========================================================================
// Heartbeat-only logging (privacy invariant): no counts, no user IDs.
// ===========================================================================

Deno.test('handler logs exactly one heartbeat line with only { passes, sync_opt_in_sampled, duration_ms } fields', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withCapturedConsole(async (logs) => {
      const client = buildMockClient({ moderation: OK_MODERATION }, newCalls())
      await handler(cronRequest({}), client, NOW_OUTSIDE_WINDOW_UTC)
      assertEquals(logs.info.length, 1)
      const parsed = JSON.parse(logs.info[0] ?? '{}')
      assertEquals(parsed.event, 'operational_health.run')
      const fieldKeys = Object.keys(parsed.fields).sort()
      assertEquals(fieldKeys, ['duration_ms', 'passes', 'sync_opt_in_sampled'])
      assertEquals(parsed.fields.passes, ['moderation'])
      assertEquals(parsed.fields.sync_opt_in_sampled, false)
      assertEquals(typeof parsed.fields.duration_ms, 'number')
    })
  })
})

Deno.test('handler heartbeat reports both passes and sync_opt_in_sampled=true when the daily gate opened', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withOperatorTimezone('UTC', async () => {
      await withCapturedConsole(async (logs) => {
        const client = buildMockClient(
          { moderation: OK_MODERATION, syncOptIn: OK_SYNC_OPT_IN },
          newCalls(),
        )
        await handler(cronRequest({}), client, NOW_INSIDE_WINDOW_UTC)
        const parsed = JSON.parse(logs.info[0] ?? '{}')
        assertEquals(parsed.fields.passes, ['moderation', 'sync_opt_in'])
        assertEquals(parsed.fields.sync_opt_in_sampled, true)
      })
    })
  })
})

Deno.test('the heartbeat log line never carries pending_count, oldest_pending_age_seconds, opted_in_count, total_count, or any *user*/*_id field', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withOperatorTimezone('UTC', async () => {
      await withCapturedConsole(async (logs) => {
        const client = buildMockClient(
          { moderation: OK_MODERATION, syncOptIn: OK_SYNC_OPT_IN },
          newCalls(),
        )
        await handler(cronRequest({}), client, NOW_INSIDE_WINDOW_UTC)
        const rawLine = logs.info[0] ?? ''
        for (const forbidden of [
          'pending_count',
          'oldest_pending_age_seconds',
          'opted_in_count',
          'total_count',
          'user_id',
        ]) {
          assertEquals(rawLine.includes(forbidden), false, `heartbeat leaked "${forbidden}"`)
        }
      })
    })
  })
})

// ===========================================================================
// Fail-open, never-crash posture: a DB error on one pass never aborts the
// other, a log-write failure never fails the tick, and it never throws.
// ===========================================================================

Deno.test('a moderation RPC error does not abort the sync-opt-in pass when the gate is open, and does not throw', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withOperatorTimezone('UTC', async () => {
      const calls = newCalls()
      const client = buildMockClient(
        {
          moderation: { data: null, error: { message: 'db unavailable' } },
          syncOptIn: OK_SYNC_OPT_IN,
        },
        calls,
      )
      let threw = false
      let response: Response | undefined
      try {
        response = await handler(cronRequest({}), client, NOW_INSIDE_WINDOW_UTC)
      } catch {
        threw = true
      }
      assertEquals(threw, false)
      assertEquals(response?.status, 200)
      // Only the sync columns land -- the errored pass's columns stay absent
      // (NULL in the table), never a fake zero.
      assertEquals(calls.inserts, [{ opted_in_count: 42, total_count: 100 }])
    })
  })
})

Deno.test('a sync-opt-in RPC error does not abort the moderation pass, and does not throw', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withOperatorTimezone('UTC', async () => {
      const calls = newCalls()
      const client = buildMockClient(
        {
          moderation: OK_MODERATION,
          syncOptIn: { data: null, error: { message: 'db unavailable' } },
        },
        calls,
      )
      let threw = false
      let response: Response | undefined
      try {
        response = await handler(cronRequest({}), client, NOW_INSIDE_WINDOW_UTC)
      } catch {
        threw = true
      }
      assertEquals(threw, false)
      assertEquals(response?.status, 200)
      assertEquals(calls.inserts, [{ pending_count: 3, oldest_pending_age_seconds: 120 }])
    })
  })
})

Deno.test('handler never throws, writes no row, and still returns ok() when BOTH RPC calls error', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withOperatorTimezone('UTC', async () => {
      const calls = newCalls()
      const client = buildMockClient(
        {
          moderation: { data: null, error: { message: 'db unavailable' } },
          syncOptIn: { data: null, error: { message: 'db unavailable' } },
        },
        calls,
      )
      let threw = false
      let response: Response | undefined
      try {
        response = await handler(cronRequest({}), client, NOW_INSIDE_WINDOW_UTC)
      } catch {
        threw = true
      }
      assertEquals(threw, false)
      assertEquals(response?.status, 200)
      const body = await response?.json()
      assertEquals(body?.ok, true)
      assertEquals(calls.inserts, [])
    })
  })
})

Deno.test('an operational_health_log insert error does not crash the handler -- ok() is still returned', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const calls = newCalls()
    const client = buildMockClient(
      { moderation: OK_MODERATION, insertError: { message: 'disk full' } },
      calls,
    )
    let threw = false
    let response: Response | undefined
    try {
      response = await handler(cronRequest({}), client, NOW_OUTSIDE_WINDOW_UTC)
    } catch {
      threw = true
    }
    assertEquals(threw, false)
    assertEquals(response?.status, 200)
    assertEquals(calls.inserts.length, 1)
  })
})
