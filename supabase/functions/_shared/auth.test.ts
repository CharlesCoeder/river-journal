// Deno unit tests for the internal-caller bearer gate used by trigger-invoked,
// verify_jwt=false Edge Functions (notify_moderation_action is the first).
//
// Run locally with: deno test supabase/functions/
//
// Contract pinned down here: requireInternalCaller(req) reads the
// `Authorization: Bearer <key>` header and compares it, constant-time, to
// INTERNAL_FUNCTION_SECRET. On success it resolves to a falsy value (null)
// so a caller can write `const denied = await requireInternalCaller(req); if
// (denied) return denied`. On failure -- missing header, empty bearer, wrong
// key, or a key that only matches as a prefix -- it resolves to a 401
// Response built via responses.err(), never throwing.
//
// Red phase: `./auth.ts` does not exist yet, so every test in this file
// fails at import resolution before a single assertion runs.

import { assertEquals } from 'jsr:@std/assert@1'
import { requireInternalCaller } from './auth.ts'

const INTERNAL_SECRET = 'test-internal-secret-0123456789abcdef'

function withInternalSecret(value: string | undefined, fn: () => Promise<void> | void) {
  const original = Deno.env.get('INTERNAL_FUNCTION_SECRET')
  if (value === undefined) {
    Deno.env.delete('INTERNAL_FUNCTION_SECRET')
  } else {
    Deno.env.set('INTERNAL_FUNCTION_SECRET', value)
  }
  return (async () => {
    try {
      await fn()
    } finally {
      if (original === undefined) {
        Deno.env.delete('INTERNAL_FUNCTION_SECRET')
      } else {
        Deno.env.set('INTERNAL_FUNCTION_SECRET', original)
      }
    }
  })()
}

Deno.test('requireInternalCaller resolves falsy (authorized) when the bearer matches INTERNAL_FUNCTION_SECRET exactly', async () => {
  await withInternalSecret(INTERNAL_SECRET, async () => {
    const req = new Request('http://localhost/notify_moderation_action', {
      headers: { Authorization: `Bearer ${INTERNAL_SECRET}` },
    })
    const result = await requireInternalCaller(req)
    assertEquals(!result, true)
  })
})

Deno.test('requireInternalCaller resolves a 401 Response when the bearer does not match', async () => {
  await withInternalSecret(INTERNAL_SECRET, async () => {
    const req = new Request('http://localhost/notify_moderation_action', {
      headers: { Authorization: 'Bearer wrong-key' },
    })
    const result = await requireInternalCaller(req)
    assertEquals(result instanceof Response, true)
    assertEquals((result as Response).status, 401)
  })
})

Deno.test('requireInternalCaller resolves 401 when the Authorization header is missing entirely', async () => {
  await withInternalSecret(INTERNAL_SECRET, async () => {
    const req = new Request('http://localhost/notify_moderation_action')
    const result = await requireInternalCaller(req)
    assertEquals(result instanceof Response, true)
    assertEquals((result as Response).status, 401)
  })
})

Deno.test('requireInternalCaller resolves 401 for an empty bearer value', async () => {
  await withInternalSecret(INTERNAL_SECRET, async () => {
    const req = new Request('http://localhost/notify_moderation_action', {
      headers: { Authorization: 'Bearer ' },
    })
    const result = await requireInternalCaller(req)
    assertEquals(result instanceof Response, true)
    assertEquals((result as Response).status, 401)
  })
})

Deno.test('requireInternalCaller rejects a bearer that only matches as a prefix (a naive startsWith compare would wrongly accept this)', async () => {
  await withInternalSecret(INTERNAL_SECRET, async () => {
    const req = new Request('http://localhost/notify_moderation_action', {
      headers: { Authorization: `Bearer ${INTERNAL_SECRET}-extra-suffix` },
    })
    const result = await requireInternalCaller(req)
    assertEquals(result instanceof Response, true)
    assertEquals((result as Response).status, 401)
  })
})

Deno.test('requireInternalCaller resolves 401 when INTERNAL_FUNCTION_SECRET itself is unset (never silently authorizes)', async () => {
  await withInternalSecret(undefined, async () => {
    const req = new Request('http://localhost/notify_moderation_action', {
      headers: { Authorization: 'Bearer anything' },
    })
    const result = await requireInternalCaller(req)
    assertEquals(result instanceof Response, true)
    assertEquals((result as Response).status, 401)
  })
})

Deno.test('requireInternalCaller rejects the service-role key as a bearer', async () => {
  const original = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')
  try {
    await withInternalSecret(INTERNAL_SECRET, async () => {
      const req = new Request('http://localhost/notify_moderation_action', {
        headers: { Authorization: 'Bearer test-service-role-key' },
      })
      const result = await requireInternalCaller(req)
      assertEquals(result instanceof Response, true)
      assertEquals((result as Response).status, 401)
    })
  } finally {
    if (original === undefined) {
      Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
    } else {
      Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', original)
    }
  }
})

Deno.test('requireInternalCaller never leaks the expected key in its 401 body', async () => {
  await withInternalSecret(INTERNAL_SECRET, async () => {
    const req = new Request('http://localhost/notify_moderation_action', {
      headers: { Authorization: 'Bearer wrong-key' },
    })
    const result = (await requireInternalCaller(req)) as Response
    const raw = JSON.stringify(await result.json())
    assertEquals(raw.includes(INTERNAL_SECRET), false)
  })
})
