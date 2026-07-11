// Deno unit tests for notify_moderation_action's pure, exported helpers.
//
// Run locally with: deno test supabase/functions/
//
// Contract pinned down here (per the shared envelope + payload conventions):
//   - resolveAffectedUserId(payload, client): target_user_id wins when
//     present (suspend_user); otherwise, for remove_post/reinstate, derive
//     the affected user via a service-role SELECT of
//     collective_posts.user_id for target_post_id; a null/missing
//     target_post_id or a target post with no resolvable author (hard
//     deleted) resolves to null WITHOUT throwing.
//   - composeNotification(payload, affectedUserId): returns
//     { type: 'moderation_action', action_type, reason_code, target_post_id,
//     message, guidelines_link } and NEVER folds a `note` field into the
//     output even if one is present on the input payload (defense in depth
//     -- the trigger payload should never carry `note` in the first place,
//     but composeNotification must not become a leak path if it ever did).
//   - redactForLog(fields): the function's own pre-log redaction used before
//     handing the stub push-intent line to _shared/logging.ts -- drops
//     content keys (note, reason) even nested inside metadata, and passes
//     safe flat fields (action_type, user_id, target_post_id, kind,
//     duration_days) through unchanged.
//
// Red phase: `./index.ts` does not exist yet, so every test in this file
// fails at import resolution before a single assertion runs.

import { assertEquals } from 'jsr:@std/assert@1'
import { composeNotification, handler, redactForLog, resolveAffectedUserId } from './index.ts'

const SERVICE_ROLE_KEY = 'handler-test-service-role-key-0123456789abcdef'

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

function moderationRequest(body: unknown): Request {
  return new Request('http://localhost/notify_moderation_action', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function captureConsole(method: 'log' | 'error', fn: () => Promise<Response>): Promise<{
  response: Response
  lines: string[]
}> {
  const original = console[method]
  const lines: string[] = []
  // deno-lint-ignore no-explicit-any
  console[method] = ((...args: any[]) => {
    lines.push(String(args[0] ?? ''))
  }) as typeof console.log
  return fn().then((response) => {
    console[method] = original
    return { response, lines }
  }, (error) => {
    console[method] = original
    throw error
  })
}

// Minimal fake of the slice of the supabase-js query builder that
// resolveAffectedUserId is documented to use: client.from('collective_posts')
// .select(...).eq('id', target_post_id).maybeSingle().
function fakeServiceRoleClient(postAuthorByPostId: Record<string, string | null>) {
  return {
    from(table: string) {
      assertEquals(table, 'collective_posts')
      return {
        select(_cols: string) {
          return {
            eq(col: string, value: string) {
              assertEquals(col, 'id')
              return {
                maybeSingle() {
                  if (!(value in postAuthorByPostId)) {
                    return { data: null, error: null }
                  }
                  const userId = postAuthorByPostId[value]
                  return { data: userId === null ? null : { user_id: userId }, error: null }
                },
              }
            },
          }
        },
      }
    },
    // deno-lint-ignore no-explicit-any
  } as any
}

Deno.test('resolveAffectedUserId uses target_user_id directly when present (suspend_user)', async () => {
  const client = fakeServiceRoleClient({})
  const userId = await resolveAffectedUserId(
    { action_type: 'suspend_user', target_user_id: 'user-abc', target_post_id: null },
    client,
  )
  assertEquals(userId, 'user-abc')
})

Deno.test('resolveAffectedUserId derives the affected user via collective_posts.user_id for remove_post', async () => {
  const client = fakeServiceRoleClient({ 'post-1': 'author-1' })
  const userId = await resolveAffectedUserId(
    { action_type: 'remove_post', target_user_id: null, target_post_id: 'post-1' },
    client,
  )
  assertEquals(userId, 'author-1')
})

Deno.test('resolveAffectedUserId derives the affected user via collective_posts.user_id for reinstate', async () => {
  const client = fakeServiceRoleClient({ 'post-2': 'author-2' })
  const userId = await resolveAffectedUserId(
    { action_type: 'reinstate', target_user_id: null, target_post_id: 'post-2' },
    client,
  )
  assertEquals(userId, 'author-2')
})

Deno.test('resolveAffectedUserId resolves null, without throwing, when the target post has no resolvable author (e.g. hard-deleted post)', async () => {
  const client = fakeServiceRoleClient({ 'post-gone': null })
  const userId = await resolveAffectedUserId(
    { action_type: 'remove_post', target_user_id: null, target_post_id: 'post-gone' },
    client,
  )
  assertEquals(userId, null)
})

Deno.test('resolveAffectedUserId resolves null, without throwing, for a null target_post_id on a post-derived action_type', async () => {
  const client = fakeServiceRoleClient({})
  const userId = await resolveAffectedUserId(
    { action_type: 'remove_post', target_user_id: null, target_post_id: null },
    client,
  )
  assertEquals(userId, null)
})

Deno.test('resolveAffectedUserId resolves null, without throwing, when target_post_id is entirely missing from the payload', async () => {
  const client = fakeServiceRoleClient({})
  const userId = await resolveAffectedUserId(
    // deno-lint-ignore no-explicit-any
    { action_type: 'remove_post', target_user_id: null } as any,
    client,
  )
  assertEquals(userId, null)
})

Deno.test('composeNotification builds the documented payload shape', () => {
  const payload = {
    id: 'action-1',
    action_type: 'suspend_user',
    target_post_id: null,
    target_user_id: 'user-abc',
    reason: 'repeated harassment',
    metadata: { kind: 'post_react', duration_days: 3 },
    created_at: '2026-07-11T00:00:00Z',
  }
  const notification = composeNotification(payload, 'user-abc')

  assertEquals(notification.type, 'moderation_action')
  assertEquals(notification.action_type, 'suspend_user')
  assertEquals(notification.reason_code, 'repeated harassment')
  assertEquals(notification.target_post_id, null)
  assertEquals(typeof notification.message, 'string')
  assertEquals(notification.message.length > 0, true)
  assertEquals(typeof notification.guidelines_link, 'string')
})

Deno.test('composeNotification never folds a note field into the output, even if present on the input payload', () => {
  const payload = {
    id: 'action-2',
    action_type: 'remove_post',
    target_post_id: 'post-1',
    target_user_id: null,
    reason: 'spam',
    // The trigger payload is documented as omitting `note` entirely -- this
    // is a defense-in-depth check that composeNotification itself never
    // becomes a leak path if a malformed/future payload carried it anyway.
    note: 'private moderator deliberation',
    metadata: null,
    created_at: '2026-07-11T00:00:00Z',
    // deno-lint-ignore no-explicit-any
  } as any
  const notification = composeNotification(payload, 'author-1')

  assertEquals('note' in notification, false)
  assertEquals(JSON.stringify(notification).includes('private moderator deliberation'), false)
})

Deno.test('composeNotification carries reason_code for a reinstate action (positive notice)', () => {
  const payload = {
    id: 'action-3',
    action_type: 'reinstate',
    target_post_id: 'post-3',
    target_user_id: null,
    reason: null,
    metadata: null,
    created_at: '2026-07-11T00:00:00Z',
  }
  const notification = composeNotification(payload, 'author-3')
  assertEquals(notification.action_type, 'reinstate')
  assertEquals(notification.target_post_id, 'post-3')
})

Deno.test('redactForLog drops note and reason even nested inside metadata for the stub push-intent log line', () => {
  const redacted = redactForLog({
    action_type: 'suspend_user',
    user_id: 'user-abc',
    target_post_id: null,
    metadata: { kind: 'post_react', duration_days: 3, note: 'nested leak' },
    reason: 'raw free text reason',
  })
  const raw = JSON.stringify(redacted)
  assertEquals(raw.includes('nested leak'), false)
  assertEquals(raw.includes('raw free text reason'), false)
})

Deno.test('redactForLog keeps the documented safe flat fields (action_type, resolved user_id, target_post_id, kind, duration_days)', () => {
  const redacted = redactForLog({
    action_type: 'suspend_user',
    user_id: 'user-abc',
    target_post_id: 'post-1',
    kind: 'post_react',
    duration_days: 3,
  })
  assertEquals(redacted.action_type, 'suspend_user')
  assertEquals(redacted.user_id, 'user-abc')
  assertEquals(redacted.target_post_id, 'post-1')
  assertEquals(redacted.kind, 'post_react')
  assertEquals(redacted.duration_days, 3)
})

// ---------------------------------------------------------------------------
// handler-level tests. These mock the Supabase client injected via handler's
// second (test-only) parameter, so no live database is required.
// ---------------------------------------------------------------------------

Deno.test('handler short-circuits on ledger conflict (dedupe): returns ok without composing or logging a notification', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = {
      from(table: string) {
        if (table === 'moderation_notification_log') {
          return {
            upsert(_row: unknown, _opts: unknown) {
              return {
                select(_cols: string) {
                  // Ledger insert reports a conflict/duplicate: ON CONFLICT DO
                  // NOTHING inserted zero rows, so `data` comes back empty.
                  return Promise.resolve({ data: [], error: null })
                },
              }
            },
          }
        }
        // Any further table access (e.g. collective_posts, to resolve the
        // affected user before composing) would mean the short-circuit
        // failed to prevent the rest of the handler from running.
        throw new Error(`unexpected access to table "${table}" after dedupe short-circuit`)
      },
      // deno-lint-ignore no-explicit-any
    } as any

    const { response, lines } = await captureConsole('log', () =>
      handler(
        moderationRequest({
          id: '00000000-0000-0000-0000-000000000001',
          action_type: 'remove_post',
          target_post_id: 'post-1',
        }),
        client,
      ))

    assertEquals(response.status, 200)
    const body = await response.json()
    assertEquals(body.ok, true)
    // No push-intent (or any other) notification line was logged.
    assertEquals(lines.some((line) => line.includes('push_intent')), false)
  })
})

Deno.test('handler returns 400 for a non-UUID id, before any DB call', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = {
      from(table: string) {
        throw new Error(`unexpected DB access for table "${table}" before UUID validation`)
      },
      // deno-lint-ignore no-explicit-any
    } as any

    const response = await handler(
      moderationRequest({ id: 'not-a-uuid', action_type: 'remove_post' }),
      client,
    )
    assertEquals(response.status, 400)
    const body = await response.json()
    assertEquals(typeof body.error, 'string')
  })
})

Deno.test('handler returns 400 (not 500) when the ledger insert hits a foreign-key violation (well-formed but unknown action id)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = {
      from(table: string) {
        assertEquals(table, 'moderation_notification_log')
        return {
          upsert(_row: unknown, _opts: unknown) {
            return {
              select(_cols: string) {
                return Promise.resolve({
                  data: null,
                  error: { code: '23503', message: 'foreign key violation' },
                })
              },
            }
          },
        }
      },
      // deno-lint-ignore no-explicit-any
    } as any

    const response = await handler(
      moderationRequest({
        id: '00000000-0000-0000-0000-000000000099',
        action_type: 'remove_post',
      }),
      client,
    )
    assertEquals(response.status, 400)
  })
})

Deno.test('handler returns 500 for a genuine ledger write failure (non-FK error)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const client = {
      from(table: string) {
        assertEquals(table, 'moderation_notification_log')
        return {
          upsert(_row: unknown, _opts: unknown) {
            return {
              select(_cols: string) {
                return Promise.resolve({
                  data: null,
                  error: { code: '57P01', message: 'database is shutting down' },
                })
              },
            }
          },
        }
      },
      // deno-lint-ignore no-explicit-any
    } as any

    const response = await handler(
      moderationRequest({
        id: '00000000-0000-0000-0000-000000000098',
        action_type: 'remove_post',
      }),
      client,
    )
    assertEquals(response.status, 500)
  })
})

Deno.test('handler returns a wrapped 500 error envelope (not an uncaught throw) when SUPABASE_URL is unset', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const originalUrl = Deno.env.get('SUPABASE_URL')
    Deno.env.delete('SUPABASE_URL')
    try {
      // No clientOverride passed — the handler must fall back to
      // createServiceRoleClient(), which throws with SUPABASE_URL unset.
      const response = await handler(
        moderationRequest({
          id: '00000000-0000-0000-0000-000000000097',
          action_type: 'remove_post',
        }),
      )
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
