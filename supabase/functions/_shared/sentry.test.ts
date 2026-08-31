// Deno unit tests for _shared/sentry.ts — the fail-open server alert helper.
//
// Run locally with: deno test --allow-read --allow-env supabase/functions/
//
// NOT wired into `yarn vitest` — supabase/functions/** is excluded from the
// root vitest.config.mts glob (Deno 2 code: Deno.* globals). `deno test`-only.

import { assertEquals } from 'jsr:@std/assert@1'
import { captureServerAlert, envelopeUrlFromDsn, sanitizeAlertExtra } from './sentry.ts'

const TEST_DSN = 'https://abc123publickey@o111222.ingest.us.sentry.io/4509999'

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

function withSentryDsn(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  return withEnv('SENTRY_DSN', value, fn)
}

interface CapturedCall {
  url: string
  body: string
}

function capturingFetch(
  calls: CapturedCall[],
  impl?: () => Promise<Response>,
): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') })
    if (impl) return impl()
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as typeof fetch
}

// ---------------------------------------------------------------------------
// envelopeUrlFromDsn — DSN parsing.
// ---------------------------------------------------------------------------

Deno.test('envelopeUrlFromDsn resolves key, host, and project id from a DSN', () => {
  assertEquals(
    envelopeUrlFromDsn(TEST_DSN),
    'https://o111222.ingest.us.sentry.io/api/4509999/envelope/?sentry_key=abc123publickey&sentry_version=7',
  )
})

Deno.test('envelopeUrlFromDsn returns undefined for a DSN missing the public key', () => {
  assertEquals(envelopeUrlFromDsn('https://o111222.ingest.us.sentry.io/4509999'), undefined)
})

Deno.test('envelopeUrlFromDsn returns undefined for a DSN with a non-numeric project path', () => {
  assertEquals(envelopeUrlFromDsn('https://key@host.example.com/not-a-project'), undefined)
})

Deno.test('envelopeUrlFromDsn returns undefined for a non-URL string', () => {
  assertEquals(envelopeUrlFromDsn('definitely not a dsn'), undefined)
})

// ---------------------------------------------------------------------------
// sanitizeAlertExtra — the two content nets.
// ---------------------------------------------------------------------------

Deno.test('sanitizeAlertExtra passes aggregate counts through unchanged', () => {
  const extra = { pending_count: 21, oldest_pending_age_seconds: 90000 }
  assertEquals(sanitizeAlertExtra(extra), extra)
})

Deno.test('sanitizeAlertExtra drops content keys and free-text values', () => {
  const prose =
    'Today I finally told my therapist about what happened last spring, and it felt like a weight lifted.'
  const out = sanitizeAlertExtra({ body: 'short', note: 1, stray: prose, kept: 'ok' })
  assertEquals(out, { kept: 'ok' })
})

// ---------------------------------------------------------------------------
// captureServerAlert — env gate, envelope shape, fail-open posture.
// ---------------------------------------------------------------------------

Deno.test('captureServerAlert is a silent no-op (zero fetches) when SENTRY_DSN is unset', async () => {
  await withSentryDsn(undefined, async () => {
    const calls: CapturedCall[] = []
    await captureServerAlert('queue backlog', { pending_count: 21 }, {
      fetch: capturingFetch(calls),
    })
    assertEquals(calls.length, 0)
  })
})

Deno.test('captureServerAlert POSTs a three-line envelope with the message, level, and sanitized extra', async () => {
  await withSentryDsn(TEST_DSN, async () => {
    const calls: CapturedCall[] = []
    await captureServerAlert('moderation queue backlog', { pending_count: 21 }, {
      fetch: capturingFetch(calls),
    })
    assertEquals(calls.length, 1)
    assertEquals(
      calls[0]?.url,
      'https://o111222.ingest.us.sentry.io/api/4509999/envelope/?sentry_key=abc123publickey&sentry_version=7',
    )
    const lines = calls[0]?.body.split('\n') ?? []
    assertEquals(lines.length, 3)
    const header = JSON.parse(lines[0] ?? '{}')
    const itemHeader = JSON.parse(lines[1] ?? '{}')
    const event = JSON.parse(lines[2] ?? '{}')
    assertEquals(typeof header.event_id, 'string')
    assertEquals(itemHeader.type, 'event')
    assertEquals(event.level, 'warning')
    assertEquals(event.message, { formatted: 'moderation queue backlog' })
    assertEquals(event.extra, { pending_count: 21 })
    // Fingerprint pinned to the message so repeated fires group as one issue.
    assertEquals(event.fingerprint, ['operational-alert', 'moderation queue backlog'])
  })
})

Deno.test('captureServerAlert never throws when fetch rejects (fail-open)', async () => {
  await withSentryDsn(TEST_DSN, async () => {
    const calls: CapturedCall[] = []
    let threw = false
    try {
      await captureServerAlert('queue backlog', {}, {
        fetch: capturingFetch(calls, () => Promise.reject(new Error('network unreachable'))),
      })
    } catch {
      threw = true
    }
    assertEquals(threw, false)
    assertEquals(calls.length, 1)
  })
})

Deno.test('captureServerAlert never throws on a non-2xx response (fail-open)', async () => {
  await withSentryDsn(TEST_DSN, async () => {
    let threw = false
    try {
      await captureServerAlert('queue backlog', {}, {
        fetch: capturingFetch([], () => Promise.resolve(new Response('nope', { status: 429 }))),
      })
    } catch {
      threw = true
    }
    assertEquals(threw, false)
  })
})

Deno.test('captureServerAlert no-ops (with a logged failure, no fetch) on a malformed DSN', async () => {
  await withSentryDsn('not a dsn', async () => {
    const calls: CapturedCall[] = []
    await captureServerAlert('queue backlog', {}, { fetch: capturingFetch(calls) })
    assertEquals(calls.length, 0)
  })
})
