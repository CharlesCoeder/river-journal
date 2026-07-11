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
