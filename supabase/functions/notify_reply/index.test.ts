// Deno unit tests for notify_reply's pure, exported helpers plus the
// service-role-gated handler shape.
//
// Run locally with: deno test --allow-env --allow-net supabase/functions/
//
// NOT wired into `yarn vitest` -- supabase/functions/** is excluded from the
// root vitest.config.mts glob (Deno 2 code: URL/npm:/jsr: imports, Deno.*
// globals). This file is `deno test`-only.
//
// Contract pinned down here (per the shared envelope + the documented spec):
//   - buildReplyRecipientCandidates(replierId, parentAuthorId, rootAuthorId):
//     string[] -- a pure helper this file infers from the "build the <=2
//     deduped candidate array in TS" description (not verbatim-named in the
//     source spec, mirroring how the 6.4 precedent pinned an inferred
//     client-usage contract). Returns parentAuthorId when it is non-null and
//     != replierId, followed by rootAuthorId when it is non-null, != replierId,
//     AND != the already-included parentAuthorId. Order: parent first, then
//     root. At most two entries, never a duplicate, never the replier.
//   - composeReplyCopy(replierId: string): { title: string; body: string } --
//     title is always 'New reply'; body is built ONLY from
//     replierId.slice(0, 8), never any other input.
//   - handler(req: Request, clientOverride?: SupabaseClient): Promise<Response>
//     -- mirrors notify_moderation_action's / streak_reminder_cron's shape:
//     requireServiceRole(req) gates the request (401 before any client call);
//     payload `{ id, user_id?, parent_post_id, created_at? }` is parsed and
//     `id`/`parent_post_id` UUID-shape-validated BEFORE any DB call (400 on
//     failure); the FIRST DB write claims `reply_notification_log` via
//     `.upsert({ reply_post_id: id }, { onConflict: 'reply_post_id',
//     ignoreDuplicates: true }).select('reply_post_id')` -- a zero-row claim
//     is the idempotency short-circuit (ok(), no downstream work at all); a
//     23503 ledger error is a 400 (unknown reply id), any other ledger error
//     is a 500. A null payload.user_id (already-anonymized replier) is an
//     ok() no-op with no further resolution. Otherwise the handler resolves
//     the parent author (`client.from('collective_posts').select('user_id')
//     .eq('id', parent_post_id).maybeSingle()`) and the root author
//     (`client.rpc('thread_root_user_id', { post_id: parent_post_id })`),
//     builds the candidate array, and -- if non-empty -- calls
//     `client.rpc('notify_reply_eligible_recipients', { candidate_ids,
//     replier_id })`. Any of these four calls erroring (or the eligibility rpc
//     coming back non-array) is FAIL-CLOSED: 500, and NOTHING further is
//     fanned out. Surviving recipients are looked up in `user_push_tokens`
//     (`.select('user_id, expo_push_token').eq('is_deleted', false)
//     .in('user_id', recipientIds)`), one ExpoMessage per live token is built
//     with `data: { type: 'collective_reply', post_id: payload.id,
//     parent_post_id: payload.parent_post_id }`, and the batch is dispatched
//     via the shared fanOutExpoPush helper. The success response is always a
//     minimal `ok()` -- no candidate/author/recipient data is ever echoed.
//
// Red phase: `./index.ts` does not exist yet, so every test in this file
// fails at import resolution before a single assertion runs.
//
// EXTENSION for server-side PostHog emission: on the path where
// fanOutExpoPush actually runs (a real delivery attempt), the handler now
// calls `emitServerEvent('collective_reply_delivered', SERVER_DISTINCT_ID,
// { recipient_count, sent_count, failed_count })` derived from
// recipientIds.length / result.sentCount / (result.errorTicketCount +
// result.chunkFailureCount), awaited before the final `return ok()`. It does
// NOT emit on any of the earlier no-op returns (already-processed dedupe,
// null replier, zero candidates, zero eligible recipients). No handler
// signature change is needed for this: emitServerEvent's own fetch defaults
// to `globalThis.fetch` (the SAME global the existing Expo-fanout tests
// already stub), gated on POSTHOG_API_KEY — tests that don't set the env var
// (every pre-existing test above) see it no-op with zero fetch calls, so this
// extension does not disturb any existing assertion. The new tests below set
// POSTHOG_API_KEY and route the stubbed global fetch by URL (Expo's
// EXPO_PUSH_ENDPOINT vs the PostHog capture endpoint) since a real delivery
// run now issues BOTH kinds of POST.
//
// Red phase (this extension specifically): `../_shared/posthog.ts` does not
// exist yet either, so this file's own top-level import of SERVER_DISTINCT_ID
// fails at module resolution before ANY test in this file runs (including the
// pre-existing ones above) — the same whole-file-red shape every other Deno
// red-phase spec in this repo uses.

import { assertEquals } from 'jsr:@std/assert@1'
import { buildReplyRecipientCandidates, composeReplyCopy, handler } from './index.ts'
import { SERVER_DISTINCT_ID } from '../_shared/posthog.ts'

const SERVICE_ROLE_KEY = 'notify-reply-test-service-role-key-0123456789abcdef'

const REPLY_ID = '00000000-0000-0000-0000-0000000000a1'
const PARENT_ID = '00000000-0000-0000-0000-0000000000a2'
const REPLIER_ID = '00000000-0000-0000-0000-0000000000a3'
const PARENT_AUTHOR_ID = '00000000-0000-0000-0000-0000000000a4'
const ROOT_AUTHOR_ID = '00000000-0000-0000-0000-0000000000a5'

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

function replyRequest(body: unknown): Request {
  return new Request('http://localhost/notify_reply', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function badBearerRequest(): Request {
  return new Request('http://localhost/notify_reply', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer not-the-right-key',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: REPLY_ID, parent_post_id: PARENT_ID }),
  })
}

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: REPLY_ID,
    user_id: REPLIER_ID,
    parent_post_id: PARENT_ID,
    created_at: '2026-07-12T00:00:00Z',
    ...overrides,
  }
}

// A minimal fake client builder. Every table/rpc access not explicitly
// configured throws, so an unexpected call surfaces as a loud test failure
// rather than a silent pass -- this is what proves fail-closed / idempotency
// short-circuit behavior (no downstream work happens beyond what a test
// explicitly wires up).
interface MockConfig {
  ledger?: { data: unknown; error: unknown }
  parentAuthor?: { data: unknown; error: unknown }
  rootAuthor?: { data: unknown; error: unknown }
  eligibility?: { data: unknown; error: unknown }
  tokens?: { data: unknown; error: unknown }
}

function buildMockClient(config: MockConfig) {
  return {
    from(table: string) {
      if (table === 'reply_notification_log') {
        return {
          upsert(row: { reply_post_id: string }, opts: Record<string, unknown>) {
            assertEquals(row.reply_post_id, REPLY_ID)
            assertEquals(opts.onConflict, 'reply_post_id')
            assertEquals(opts.ignoreDuplicates, true)
            return {
              select(_cols: string) {
                if (!config.ledger) {
                  throw new Error('ledger claim not configured for this test')
                }
                return Promise.resolve(config.ledger)
              },
            }
          },
        }
      }
      if (table === 'collective_posts') {
        return {
          select(_cols: string) {
            return {
              eq(col: string, value: string) {
                assertEquals(col, 'id')
                assertEquals(value, PARENT_ID)
                return {
                  maybeSingle() {
                    if (!config.parentAuthor) {
                      throw new Error('parent-author lookup not configured for this test')
                    }
                    return Promise.resolve(config.parentAuthor)
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'user_push_tokens') {
        return {
          select(_cols: string) {
            return {
              eq(col: string, val: boolean) {
                assertEquals(col, 'is_deleted')
                assertEquals(val, false)
                return {
                  in(col2: string, _ids: string[]) {
                    assertEquals(col2, 'user_id')
                    if (!config.tokens) {
                      throw new Error('token lookup not configured for this test')
                    }
                    return Promise.resolve(config.tokens)
                  },
                }
              },
            }
          },
        }
      }
      throw new Error(`unexpected table access "${table}"`)
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === 'thread_root_user_id') {
        assertEquals(args.post_id, PARENT_ID)
        if (!config.rootAuthor) {
          throw new Error('thread_root_user_id rpc not configured for this test')
        }
        return Promise.resolve(config.rootAuthor)
      }
      if (name === 'notify_reply_eligible_recipients') {
        if (!config.eligibility) {
          throw new Error('notify_reply_eligible_recipients rpc not configured for this test')
        }
        return Promise.resolve(config.eligibility)
      }
      throw new Error(`unexpected rpc call "${name}"`)
    },
    // deno-lint-ignore no-explicit-any
  } as any
}

// ---------------------------------------------------------------------------
// buildReplyRecipientCandidates -- the <=2 deduped recipient matrix,
// including every degenerate thread shape.
// ---------------------------------------------------------------------------

Deno.test('buildReplyRecipientCandidates collapses parent==root to a single candidate', () => {
  const candidates = buildReplyRecipientCandidates(REPLIER_ID, PARENT_AUTHOR_ID, PARENT_AUTHOR_ID)
  assertEquals(candidates, [PARENT_AUTHOR_ID])
})

Deno.test('buildReplyRecipientCandidates returns both parent and root authors when they differ and neither is the replier', () => {
  const candidates = buildReplyRecipientCandidates(REPLIER_ID, PARENT_AUTHOR_ID, ROOT_AUTHOR_ID)
  assertEquals(candidates, [PARENT_AUTHOR_ID, ROOT_AUTHOR_ID])
})

Deno.test('buildReplyRecipientCandidates drops the parent slot when the parent author is the replier (reply-to-own-comment-mid-thread), keeping exactly the root author', () => {
  const candidates = buildReplyRecipientCandidates(REPLIER_ID, REPLIER_ID, ROOT_AUTHOR_ID)
  assertEquals(candidates, [ROOT_AUTHOR_ID])
})

Deno.test('buildReplyRecipientCandidates drops the root slot when the root author is the replier, keeping exactly the parent author', () => {
  const candidates = buildReplyRecipientCandidates(REPLIER_ID, PARENT_AUTHOR_ID, REPLIER_ID)
  assertEquals(candidates, [PARENT_AUTHOR_ID])
})

Deno.test('buildReplyRecipientCandidates returns zero recipients for a self-reply / reply to your own top-level post (parent==root==replier)', () => {
  const candidates = buildReplyRecipientCandidates(REPLIER_ID, REPLIER_ID, REPLIER_ID)
  assertEquals(candidates, [])
})

Deno.test('buildReplyRecipientCandidates drops a null (anonymized) parent author slot, keeping the root author', () => {
  const candidates = buildReplyRecipientCandidates(REPLIER_ID, null, ROOT_AUTHOR_ID)
  assertEquals(candidates, [ROOT_AUTHOR_ID])
})

Deno.test('buildReplyRecipientCandidates drops a null (anonymized) root author slot, keeping the parent author', () => {
  const candidates = buildReplyRecipientCandidates(REPLIER_ID, PARENT_AUTHOR_ID, null)
  assertEquals(candidates, [PARENT_AUTHOR_ID])
})

Deno.test('buildReplyRecipientCandidates returns zero recipients when both parent and root authors are null (anonymized)', () => {
  const candidates = buildReplyRecipientCandidates(REPLIER_ID, null, null)
  assertEquals(candidates, [])
})

// ---------------------------------------------------------------------------
// composeReplyCopy -- pseudonym-only body, never any post/reply content.
// ---------------------------------------------------------------------------

Deno.test('composeReplyCopy returns the fixed title "New reply"', () => {
  const copy = composeReplyCopy(REPLIER_ID)
  assertEquals(copy.title, 'New reply')
})

Deno.test("composeReplyCopy body is built only from the replier's 8-char pseudonym", () => {
  const copy = composeReplyCopy('abcdefgh-ijkl-mnop-qrst-uvwxyz123456')
  assertEquals(copy.body.includes('abcdefgh'), true)
})

Deno.test('composeReplyCopy body never includes anything past the 8-char pseudonym slice of the replier id', () => {
  const fullId = 'abcdefgh-ijkl-mnop-qrst-uvwxyz123456'
  const copy = composeReplyCopy(fullId)
  assertEquals(copy.body.includes('ijkl'), false)
  assertEquals(copy.body.includes(fullId), false)
})

// ---------------------------------------------------------------------------
// handler -- gating, validation, idempotency, fail-closed, and the success
// envelope.
// ---------------------------------------------------------------------------

Deno.test('handler returns 401 for a bad bearer, before any client call', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = {
      rpc(name: string) {
        throw new Error(`unexpected rpc call ("${name}") before the bearer check`)
      },
      from(table: string) {
        throw new Error(`unexpected table access ("${table}") before the bearer check`)
      },
      // deno-lint-ignore no-explicit-any
    } as any

    const response = await handler(badBearerRequest(), client)
    assertEquals(response.status, 401)
    const body = await response.json()
    assertEquals(typeof body.error, 'string')
  })
})

Deno.test('handler returns 400 for a non-JSON body', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = {
      from(table: string) {
        throw new Error(`unexpected table access ("${table}") for a non-JSON body`)
      },
      // deno-lint-ignore no-explicit-any
    } as any
    const request = new Request('http://localhost/notify_reply', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: 'not json',
    })
    const response = await handler(request, client)
    assertEquals(response.status, 400)
  })
})

Deno.test('handler returns 400 for a non-UUID id, before any DB call', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = {
      from(table: string) {
        throw new Error(`unexpected table access ("${table}") before UUID validation`)
      },
      rpc(name: string) {
        throw new Error(`unexpected rpc call ("${name}") before UUID validation`)
      },
      // deno-lint-ignore no-explicit-any
    } as any
    const response = await handler(
      replyRequest(basePayload({ id: 'not-a-uuid' })),
      client,
    )
    assertEquals(response.status, 400)
  })
})

Deno.test('handler returns 400 for a non-UUID parent_post_id, before any DB call', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = {
      from(table: string) {
        throw new Error(`unexpected table access ("${table}") before UUID validation`)
      },
      rpc(name: string) {
        throw new Error(`unexpected rpc call ("${name}") before UUID validation`)
      },
      // deno-lint-ignore no-explicit-any
    } as any
    const response = await handler(
      replyRequest(basePayload({ parent_post_id: 'not-a-uuid' })),
      client,
    )
    assertEquals(response.status, 400)
  })
})

Deno.test('handler returns 400 for a non-UUID, non-null user_id, before any DB call (and never claims the ledger)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = {
      from(table: string) {
        throw new Error(`unexpected table access ("${table}") before user_id validation`)
      },
      rpc(name: string) {
        throw new Error(`unexpected rpc call ("${name}") before user_id validation`)
      },
      // deno-lint-ignore no-explicit-any
    } as any
    const response = await handler(
      replyRequest(basePayload({ user_id: 'not-a-uuid' })),
      client,
    )
    assertEquals(response.status, 400)
  })
})

Deno.test('handler returns ok() and does NO downstream work on a zero-row ledger claim (idempotent re-fire)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = buildMockClient({ ledger: { data: [], error: null } })
    const response = await handler(replyRequest(basePayload()), client)
    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.ok, true)
    // No further table/rpc access happened -- buildMockClient throws for any
    // access not pre-configured, and parentAuthor/rootAuthor/eligibility/
    // tokens were deliberately left unconfigured above.
  })
})

Deno.test('handler returns 400 (not 500) when the ledger insert hits a foreign-key violation (well-formed but unknown reply id)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = buildMockClient({
      ledger: { data: null, error: { code: '23503', message: 'foreign key violation' } },
    })
    const response = await handler(replyRequest(basePayload()), client)
    assertEquals(response.status, 400)
  })
})

Deno.test('handler returns 500 for a genuine ledger write failure (non-FK error)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = buildMockClient({
      ledger: { data: null, error: { code: '57P01', message: 'database is shutting down' } },
    })
    const response = await handler(replyRequest(basePayload()), client)
    assertEquals(response.status, 500)
  })
})

Deno.test('handler returns ok() and does no author resolution when payload.user_id is null (already-anonymized replier)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = buildMockClient({
      ledger: { data: [{ reply_post_id: REPLY_ID }], error: null },
    })
    const response = await handler(
      replyRequest(basePayload({ user_id: null })),
      client,
    )
    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.ok, true)
  })
})

Deno.test('handler is fail-closed (500, zero fetch calls) when the parent-author lookup errors', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const originalFetch = globalThis.fetch
    let fetchCalled = false
    globalThis.fetch = (() => {
      fetchCalled = true
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof fetch

    try {
      const client = buildMockClient({
        ledger: { data: [{ reply_post_id: REPLY_ID }], error: null },
        parentAuthor: { data: null, error: { code: '57P01', message: 'boom' } },
      })
      const response = await handler(replyRequest(basePayload()), client)
      assertEquals(response.status, 500)
      assertEquals(fetchCalled, false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

Deno.test('handler is fail-closed (500, zero fetch calls) when thread_root_user_id errors', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const originalFetch = globalThis.fetch
    let fetchCalled = false
    globalThis.fetch = (() => {
      fetchCalled = true
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof fetch

    try {
      const client = buildMockClient({
        ledger: { data: [{ reply_post_id: REPLY_ID }], error: null },
        parentAuthor: { data: { user_id: PARENT_AUTHOR_ID }, error: null },
        rootAuthor: { data: null, error: { message: 'boom' } },
      })
      const response = await handler(replyRequest(basePayload()), client)
      assertEquals(response.status, 500)
      assertEquals(fetchCalled, false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

Deno.test('handler is fail-closed (500, zero fetch calls) when notify_reply_eligible_recipients errors -- it must NEVER fall back to the unfiltered candidate set', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const originalFetch = globalThis.fetch
    let fetchCalled = false
    globalThis.fetch = (() => {
      fetchCalled = true
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof fetch

    try {
      const client = buildMockClient({
        ledger: { data: [{ reply_post_id: REPLY_ID }], error: null },
        parentAuthor: { data: { user_id: PARENT_AUTHOR_ID }, error: null },
        rootAuthor: { data: ROOT_AUTHOR_ID, error: null },
        eligibility: { data: null, error: { message: 'eligibility rpc exploded' } },
      })
      const response = await handler(replyRequest(basePayload()), client)
      assertEquals(response.status, 500)
      assertEquals(fetchCalled, false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

Deno.test('handler is fail-closed (500, zero fetch calls) when notify_reply_eligible_recipients returns a non-array result', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const originalFetch = globalThis.fetch
    let fetchCalled = false
    globalThis.fetch = (() => {
      fetchCalled = true
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof fetch

    try {
      const client = buildMockClient({
        ledger: { data: [{ reply_post_id: REPLY_ID }], error: null },
        parentAuthor: { data: { user_id: PARENT_AUTHOR_ID }, error: null },
        rootAuthor: { data: ROOT_AUTHOR_ID, error: null },
        eligibility: { data: 'not-an-array', error: null },
      })
      const response = await handler(replyRequest(basePayload()), client)
      assertEquals(response.status, 500)
      assertEquals(fetchCalled, false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

Deno.test('handler is fail-closed (500, zero fetch calls) when the token lookup errors', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const originalFetch = globalThis.fetch
    let fetchCalled = false
    globalThis.fetch = (() => {
      fetchCalled = true
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof fetch

    try {
      const client = buildMockClient({
        ledger: { data: [{ reply_post_id: REPLY_ID }], error: null },
        parentAuthor: { data: { user_id: PARENT_AUTHOR_ID }, error: null },
        rootAuthor: { data: ROOT_AUTHOR_ID, error: null },
        eligibility: { data: [PARENT_AUTHOR_ID], error: null },
        tokens: { data: null, error: { message: 'token lookup exploded' } },
      })
      const response = await handler(replyRequest(basePayload()), client)
      assertEquals(response.status, 500)
      assertEquals(fetchCalled, false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

Deno.test('handler returns ok() with no eligibility/token/fetch work when the candidate set is empty (self-reply degenerate case)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const originalFetch = globalThis.fetch
    let fetchCalled = false
    globalThis.fetch = (() => {
      fetchCalled = true
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof fetch

    try {
      // Replier replies to their own top-level post: parent author == root
      // author == replier, so the deduped candidate set is empty and the
      // handler must short-circuit before calling the eligibility rpc at all.
      const client = buildMockClient({
        ledger: { data: [{ reply_post_id: REPLY_ID }], error: null },
        parentAuthor: { data: { user_id: REPLIER_ID }, error: null },
        rootAuthor: { data: REPLIER_ID, error: null },
      })
      const response = await handler(
        replyRequest(basePayload({ user_id: REPLIER_ID })),
        client,
      )
      assertEquals(response.status, 200)
      const body = await response.json()
      assertEquals(body.ok, true)
      assertEquals(fetchCalled, false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

Deno.test('handler returns ok() with no token/fetch work when the eligibility rpc returns zero surviving recipients', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const originalFetch = globalThis.fetch
    let fetchCalled = false
    globalThis.fetch = (() => {
      fetchCalled = true
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof fetch

    try {
      const client = buildMockClient({
        ledger: { data: [{ reply_post_id: REPLY_ID }], error: null },
        parentAuthor: { data: { user_id: PARENT_AUTHOR_ID }, error: null },
        rootAuthor: { data: ROOT_AUTHOR_ID, error: null },
        eligibility: { data: [], error: null },
      })
      const response = await handler(replyRequest(basePayload()), client)
      assertEquals(response.status, 200)
      const body = await response.json()
      assertEquals(body.ok, true)
      assertEquals(fetchCalled, false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

Deno.test("handler dispatches a single push to a surviving recipient's live token, with the documented data shape, and returns a minimal ok() (enumeration-oracle guard)", async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const originalFetch = globalThis.fetch
    let capturedBody: unknown = null
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      const tickets = (capturedBody as unknown[]).map(() => ({ status: 'ok' }))
      return Promise.resolve(new Response(JSON.stringify({ data: tickets }), { status: 200 }))
    }) as typeof fetch

    try {
      const client = buildMockClient({
        ledger: { data: [{ reply_post_id: REPLY_ID }], error: null },
        parentAuthor: { data: { user_id: PARENT_AUTHOR_ID }, error: null },
        rootAuthor: { data: PARENT_AUTHOR_ID, error: null }, // parent == root: collapses to one candidate
        eligibility: { data: [PARENT_AUTHOR_ID], error: null },
        tokens: {
          data: [{ user_id: PARENT_AUTHOR_ID, expo_push_token: 'ExponentPushToken[a]' }],
          error: null,
        },
      })
      const response = await handler(replyRequest(basePayload()), client)
      assertEquals(response.status, 200)
      const body = await response.json()
      assertEquals(Object.keys(body).sort(), ['ok'])

      const messages = capturedBody as Array<
        { to: string; data: { type: string; post_id: string; parent_post_id: string } }
      >
      assertEquals(messages.length, 1)
      assertEquals(messages[0]?.to, 'ExponentPushToken[a]')
      assertEquals(messages[0]?.data.type, 'collective_reply')
      assertEquals(messages[0]?.data.post_id, REPLY_ID)
      assertEquals(messages[0]?.data.parent_post_id, PARENT_ID)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

// ---------------------------------------------------------------------------
// Server-side PostHog emission -- collective_reply_delivered fires ONLY on a
// real delivery attempt (the fanOutExpoPush path), never on an earlier no-op
// return.
// ---------------------------------------------------------------------------

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

// Routes the stubbed global fetch by URL: an Expo push POST (exp.host) vs a
// PostHog capture POST (any other URL, e.g. the default us.i.posthog.com
// /capture/ endpoint) -- a real delivery run now issues both, and the
// pre-existing Expo-only stub in this file can't tell them apart.
function withRoutedFetch(
  fn: (calls: {
    expo: unknown[]
    posthog: Array<{ url: string; body: unknown }>
  }) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch
  const calls = { expo: [] as unknown[], posthog: [] as Array<{ url: string; body: unknown }> }
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    if (typeof url === 'string' && url.includes('exp.host')) {
      calls.expo.push(body)
      const tickets = (body as unknown[]).map(() => ({ status: 'ok' }))
      return Promise.resolve(new Response(JSON.stringify({ data: tickets }), { status: 200 }))
    }
    calls.posthog.push({ url: String(url), body })
    return Promise.resolve(new Response(JSON.stringify({ status: 1 }), { status: 200 }))
  }) as typeof fetch
  return fn(calls).finally(() => {
    globalThis.fetch = originalFetch
  })
}

Deno.test('handler emits collective_reply_delivered with the derived metadata + SERVER_DISTINCT_ID after a real delivery attempt', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withPosthogApiKey('phc_test_key', async () => {
      await withRoutedFetch(async (calls) => {
        const client = buildMockClient({
          ledger: { data: [{ reply_post_id: REPLY_ID }], error: null },
          parentAuthor: { data: { user_id: PARENT_AUTHOR_ID }, error: null },
          rootAuthor: { data: PARENT_AUTHOR_ID, error: null },
          eligibility: { data: [PARENT_AUTHOR_ID], error: null },
          tokens: {
            data: [{ user_id: PARENT_AUTHOR_ID, expo_push_token: 'ExponentPushToken[a]' }],
            error: null,
          },
        })
        const response = await handler(replyRequest(basePayload()), client)
        assertEquals(response.status, 200)

        assertEquals(calls.posthog.length, 1)
        const body = calls.posthog[0]?.body as Record<string, unknown>
        assertEquals(body.event, 'collective_reply_delivered')
        assertEquals(body.distinct_id, SERVER_DISTINCT_ID)
        assertEquals(body.properties, { recipient_count: 1, sent_count: 1, failed_count: 0 })
      })
    })
  })
})

Deno.test('handler does NOT call the PostHog capture endpoint on the zero-row ledger claim (already-processed no-op)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withPosthogApiKey('phc_test_key', async () => {
      await withRoutedFetch(async (calls) => {
        const client = buildMockClient({ ledger: { data: [], error: null } })
        const response = await handler(replyRequest(basePayload()), client)
        assertEquals(response.status, 200)
        assertEquals(calls.posthog.length, 0)
      })
    })
  })
})

Deno.test('handler does NOT call the PostHog capture endpoint when payload.user_id is null (already-anonymized replier, no-op)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withPosthogApiKey('phc_test_key', async () => {
      await withRoutedFetch(async (calls) => {
        const client = buildMockClient({
          ledger: { data: [{ reply_post_id: REPLY_ID }], error: null },
        })
        const response = await handler(replyRequest(basePayload({ user_id: null })), client)
        assertEquals(response.status, 200)
        assertEquals(calls.posthog.length, 0)
      })
    })
  })
})

Deno.test('handler does NOT call the PostHog capture endpoint when the candidate set is empty (self-reply degenerate case, no-op)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withPosthogApiKey('phc_test_key', async () => {
      await withRoutedFetch(async (calls) => {
        const client = buildMockClient({
          ledger: { data: [{ reply_post_id: REPLY_ID }], error: null },
          parentAuthor: { data: { user_id: REPLIER_ID }, error: null },
          rootAuthor: { data: REPLIER_ID, error: null },
        })
        const response = await handler(
          replyRequest(basePayload({ user_id: REPLIER_ID })),
          client,
        )
        assertEquals(response.status, 200)
        assertEquals(calls.posthog.length, 0)
      })
    })
  })
})

Deno.test('handler does NOT call the PostHog capture endpoint when the eligibility rpc returns zero surviving recipients (no-op)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withPosthogApiKey('phc_test_key', async () => {
      await withRoutedFetch(async (calls) => {
        const client = buildMockClient({
          ledger: { data: [{ reply_post_id: REPLY_ID }], error: null },
          parentAuthor: { data: { user_id: PARENT_AUTHOR_ID }, error: null },
          rootAuthor: { data: ROOT_AUTHOR_ID, error: null },
          eligibility: { data: [], error: null },
        })
        const response = await handler(replyRequest(basePayload()), client)
        assertEquals(response.status, 200)
        assertEquals(calls.posthog.length, 0)
      })
    })
  })
})

Deno.test('a rejected PostHog capture call does NOT change the handler response -- the emit is best-effort and fail-open end-to-end', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withPosthogApiKey('phc_test_key', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = ((url: string, init?: RequestInit) => {
        if (typeof url === 'string' && url.includes('exp.host')) {
          const body = JSON.parse(init?.body as string) as unknown[]
          const tickets = body.map(() => ({ status: 'ok' }))
          return Promise.resolve(new Response(JSON.stringify({ data: tickets }), { status: 200 }))
        }
        return Promise.reject(new Error('posthog capture unreachable'))
      }) as typeof fetch

      try {
        const client = buildMockClient({
          ledger: { data: [{ reply_post_id: REPLY_ID }], error: null },
          parentAuthor: { data: { user_id: PARENT_AUTHOR_ID }, error: null },
          rootAuthor: { data: PARENT_AUTHOR_ID, error: null },
          eligibility: { data: [PARENT_AUTHOR_ID], error: null },
          tokens: {
            data: [{ user_id: PARENT_AUTHOR_ID, expo_push_token: 'ExponentPushToken[a]' }],
            error: null,
          },
        })
        const response = await handler(replyRequest(basePayload()), client)
        assertEquals(response.status, 200)
        const body = await response.json()
        assertEquals(body.ok, true)
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })
})

Deno.test('handler returns a wrapped 500 error envelope (not an uncaught throw) when SUPABASE_URL is unset', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const originalUrl = Deno.env.get('SUPABASE_URL')
    Deno.env.delete('SUPABASE_URL')
    try {
      // No clientOverride passed -- the handler must fall back to
      // createServiceRoleClient(), which throws with SUPABASE_URL unset.
      const response = await handler(replyRequest(basePayload()))
      assertEquals(response.status, 500)
      const body = await response.json()
      assertEquals(typeof body.error, 'string')
    } finally {
      if (originalUrl === undefined) {
        Deno.env.delete('SUPABASE_URL')
      } else {
        Deno.env.set('SUPABASE_URL', originalUrl)
      }
    }
  })
})
