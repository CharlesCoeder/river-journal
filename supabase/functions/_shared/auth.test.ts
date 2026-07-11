// Deno unit tests for the service-role bearer gate used by trigger-invoked,
// verify_jwt=false Edge Functions (notify_moderation_action is the first).
//
// Run locally with: deno test supabase/functions/
//
// Contract pinned down here: requireServiceRole(req) reads the
// `Authorization: Bearer <key>` header and compares it, constant-time, to
// SUPABASE_SERVICE_ROLE_KEY. On success it resolves to a falsy value (null)
// so a caller can write `const denied = await requireServiceRole(req); if
// (denied) return denied`. On failure -- missing header, empty bearer, wrong
// key, or a key that only matches as a prefix -- it resolves to a 401
// Response built via responses.err(), never throwing.
//
// Red phase: `./auth.ts` does not exist yet, so every test in this file
// fails at import resolution before a single assertion runs.

import { assertEquals } from 'jsr:@std/assert@1'
import { requireServiceRole } from './auth.ts'

const SERVICE_ROLE_KEY = 'test-service-role-key-0123456789abcdef'

function withServiceRoleKey(value: string | undefined, fn: () => Promise<void> | void) {
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

Deno.test('requireServiceRole resolves falsy (authorized) when the bearer matches SUPABASE_SERVICE_ROLE_KEY exactly', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const req = new Request('http://localhost/notify_moderation_action', {
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    })
    const result = await requireServiceRole(req)
    assertEquals(!result, true)
  })
})

Deno.test('requireServiceRole resolves a 401 Response when the bearer does not match', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const req = new Request('http://localhost/notify_moderation_action', {
      headers: { Authorization: 'Bearer wrong-key' },
    })
    const result = await requireServiceRole(req)
    assertEquals(result instanceof Response, true)
    assertEquals((result as Response).status, 401)
  })
})

Deno.test('requireServiceRole resolves 401 when the Authorization header is missing entirely', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const req = new Request('http://localhost/notify_moderation_action')
    const result = await requireServiceRole(req)
    assertEquals(result instanceof Response, true)
    assertEquals((result as Response).status, 401)
  })
})

Deno.test('requireServiceRole resolves 401 for an empty bearer value', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const req = new Request('http://localhost/notify_moderation_action', {
      headers: { Authorization: 'Bearer ' },
    })
    const result = await requireServiceRole(req)
    assertEquals(result instanceof Response, true)
    assertEquals((result as Response).status, 401)
  })
})

Deno.test('requireServiceRole rejects a bearer that only matches as a prefix (a naive startsWith compare would wrongly accept this)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const req = new Request('http://localhost/notify_moderation_action', {
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}-extra-suffix` },
    })
    const result = await requireServiceRole(req)
    assertEquals(result instanceof Response, true)
    assertEquals((result as Response).status, 401)
  })
})

Deno.test('requireServiceRole resolves 401 when SUPABASE_SERVICE_ROLE_KEY itself is unset (never silently authorizes)', async () => {
  await withServiceRoleKey(undefined, async () => {
    const req = new Request('http://localhost/notify_moderation_action', {
      headers: { Authorization: 'Bearer anything' },
    })
    const result = await requireServiceRole(req)
    assertEquals(result instanceof Response, true)
    assertEquals((result as Response).status, 401)
  })
})

Deno.test('requireServiceRole never leaks the expected key in its 401 body', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const req = new Request('http://localhost/notify_moderation_action', {
      headers: { Authorization: 'Bearer wrong-key' },
    })
    const result = (await requireServiceRole(req)) as Response
    const raw = JSON.stringify(await result.json())
    assertEquals(raw.includes(SERVICE_ROLE_KEY), false)
  })
})
