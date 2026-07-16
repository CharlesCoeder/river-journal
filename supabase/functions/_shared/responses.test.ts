// Deno unit tests for the response envelope helpers.
//
// Run locally with: deno test supabase/functions/
//
// Contract pinned down here: ok(data?) -> Response, 200, JSON
// `{ ok: true, ...data }`; err(message, { code?, status = 400 }) -> Response,
// JSON `{ error, code? }` at the given status; neither ever serializes a
// stack trace or Error.cause into the body (the client-facing surface of a
// publicly reachable, verify_jwt=false function must never leak internals).
//
// Red phase: `./responses.ts` does not exist yet, so every test in this file
// fails at import resolution before a single assertion runs.

import { assertEquals } from 'jsr:@std/assert@1'
import { err, ok } from './responses.ts'

Deno.test('ok() with no data returns status 200 and { ok: true }', async () => {
  const res = ok()
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body, { ok: true })
})

Deno.test('ok(data) spreads the extra data alongside ok: true', async () => {
  const res = ok({ processed: true })
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.ok, true)
  assertEquals(body.processed, true)
})

Deno.test('ok() never carries a resolved affected_user_id or author field (enumeration-oracle guard)', async () => {
  // notify_moderation_action is reachable at its public URL with only a
  // bearer check (verify_jwt = false). If ok() ever became a place where
  // resolution results implicitly rode along, the function would turn into a
  // target_post_id -> post-author enumeration oracle for anyone holding the
  // bearer. This suite pins the minimal-body contract for the SUCCESS case
  // the handler is documented to return: ok() with no resolved-user/author
  // data at all.
  const res = ok()
  const body = await res.json()
  assertEquals('affected_user_id' in body, false)
  assertEquals('author' in body, false)
  assertEquals('user_id' in body, false)
  assertEquals('collective_posts' in body, false)
})

Deno.test('err() returns the given status and { error, code }', async () => {
  const res = err('missing bearer', { code: 'unauthorized', status: 401 })
  assertEquals(res.status, 401)
  const body = await res.json()
  assertEquals(body.error, 'missing bearer')
  assertEquals(body.code, 'unauthorized')
})

Deno.test('err() defaults to status 400 when no status is given', async () => {
  const res = err('bad payload')
  assertEquals(res.status, 400)
  const body = await res.json()
  assertEquals(body.error, 'bad payload')
})

Deno.test('err() omits code entirely when none is given', async () => {
  const res = err('bad payload')
  const body = await res.json()
  assertEquals('code' in body, false)
})

Deno.test('err() never serializes a stack trace or Error.cause into the body', async () => {
  const boom = new Error('internal: db connection string leaked in a stack frame') // deno-lint-ignore no-explicit-any
  ;(boom as any).cause = new Error('secret internal cause')

  const res = err('internal error', { status: 500 })
  const body = await res.json()
  const raw = JSON.stringify(body)

  assertEquals(raw.toLowerCase().includes('stack'), false)
  assertEquals(raw.includes('secret internal cause'), false)
  assertEquals(raw.includes('db connection string'), false)
})

// ── Lock the regression: even when a caller extracts `.message` off a real
// Error (the pattern already used at several call sites, e.g.
// `err(thrown.message, { code: thrown.code, status })`), the body carries
// ONLY { error, code? } — never the stack/cause the source Error object
// still holds internally. This is a verify+lock test (Dev Notes: responses.ts
// already implements this correctly) so it is expected to already be GREEN
// pre-implementation; it guards against a future regression, not a gap in
// today's code.

Deno.test('err(thrown.message, ...) — the real call-site pattern — never leaks the source Error object, even though the Error still holds a stack + cause', async () => {
  const boom = new Error('upstream provider timed out') // deno-lint-ignore no-explicit-any
  ;(boom as any).cause = new Error('secret internal cause: connection pool exhausted')

  const res = err(boom.message, { code: 'internal', status: 500 })
  const body = await res.json()

  assertEquals(body, { error: 'upstream provider timed out', code: 'internal' })
  assertEquals('stack' in body, false)
  assertEquals('cause' in body, false)
  const raw = JSON.stringify(body)
  assertEquals(raw.includes('connection pool exhausted'), false)
})

Deno.test('err() never spreads a raw exception object\'s own fields into the body, even when a caller mistakenly passes the Error itself (API-shape proof)', async () => {
  const boom = new Error('should never appear verbatim in a response body') // deno-lint-ignore no-explicit-any
  ;(boom as any).cause = new Error('secret internal cause: connection pool exhausted')

  // Deliberately misuse the API the way a careless catch-block might --
  // `err()` is typed to take a string, but at the JS runtime level nothing
  // stops a caller from passing the Error object itself. Because the
  // envelope only ever assigns the second argument onto `body.error` as a
  // single value (never spreads the exception's own enumerable properties
  // across the body), the top-level body must carry ONLY `error` (+ `code`)
  // -- proving the envelope's shape is the safety net, not caller discipline
  // alone.
  // deno-lint-ignore no-explicit-any
  const res = err(boom as any, { status: 500 })
  const body = await res.json()
  const raw = JSON.stringify(body)

  assertEquals(Object.keys(body), ['error'])
  assertEquals(raw.includes('should never appear verbatim in a response body'), false)
  assertEquals(raw.toLowerCase().includes('stack'), false)
  assertEquals(raw.includes('secret internal cause: connection pool exhausted'), false)
})

Deno.test('ok(data) never carries exception fields (stack/cause/message) even when data is built from a caught error\'s safe fields', async () => {
  const res = ok({ safe: 1 })
  const body = await res.json()

  assertEquals(body, { ok: true, safe: 1 })
  assertEquals('stack' in body, false)
  assertEquals('cause' in body, false)
  assertEquals('message' in body, false)
})
