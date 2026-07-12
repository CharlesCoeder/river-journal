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

// ---------------------------------------------------------------------------
// Extension for push delivery (replacing the STUB): the moderation.enabled
// preference gate, the action-aware push copy, the exact `data` payload
// shape, and the reused `fanOutExpoPush` dispatch.
//
// Additional contract pinned down by this extension (the surviving tests
// above still hold verbatim -- the claim-first ledger, the add_note no-op,
// resolveAffectedUserId, and composeNotification are all unchanged):
//   - composeModerationPushCopy(payload): { title: string; body: string } --
//     title is action-aware (`remove_post` -> 'Post removed', `suspend_user`
//     -> 'Account suspended', `reinstate` -> 'Post restored', any other ->
//     'Account update'); body is the existing composeMessage(...)-templated
//     string -- built from action_type + safe metadata ONLY, NEVER the raw
//     `reason` (which can carry a moderator's free-text note, since
//     suspend_user folds an optional custom note into the `reason` column).
//   - After the existing claim-first ledger insert + resolveAffectedUserId,
//     the handler reads the affected user's preference via
//     `client.from('users').select('preferences').eq('id', affectedUserId)
//     .maybeSingle()`. `preferences?.reminders?.moderation?.enabled !== true`
//     (missing, false, or a SELECT error) is a strict, fail-CLOSED no-send:
//     `ok()` after a metadata-only run log, no fetch call at all.
//   - Only when enabled does it look up live tokens via
//     `client.from('user_push_tokens').select('user_id, expo_push_token')
//     .eq('user_id', affectedUserId).eq('is_deleted', false)`, build one
//     ExpoMessage per token with `data` EXACTLY
//     `{ type: 'moderation_action', action_type, target_post_id,
//     guidelines_link }` (no `reason`/`reason_code`), and dispatch through the
//     shared `fanOutExpoPush(client, messages)` -- the SAME helper
//     `notify_reply` reuses, never re-implemented here. A zero-live-token
//     recipient is NOT an error: ok() after a metadata-only run log.
//   - The success response stays a minimal ok() throughout (enumeration-oracle
//     guard unchanged).
//
// Red phase: composeModerationPushCopy does not exist on ./index.ts yet, so
// this file's own top-level import fails at module resolution before any
// assertion (including the pre-existing ones above) runs -- an unambiguous
// whole-file red phase, same shape as every other Deno red-phase precedent in
// this repo.

import { assertEquals } from 'jsr:@std/assert@1'
import {
  composeModerationPushCopy,
  composeNotification,
  handler,
  redactForLog,
  resolveAffectedUserId,
} from './index.ts'

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

Deno.test('redactForLog drops note and reason even nested inside metadata in the run-log metadata', () => {
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

// ---------------------------------------------------------------------------
// composeModerationPushCopy — action-aware title map + templated-reason-only
// body (NFR19: never the raw `reason`, which can carry a moderator's free
// text, since suspend_user folds an optional custom note into `reason`).
// ---------------------------------------------------------------------------

const SEEDED_REASON_MARKER = 'zzseeded-nfr19-free-text-marker-must-never-leak-zz'

Deno.test('composeModerationPushCopy: remove_post -> "Post removed"', () => {
  const copy = composeModerationPushCopy(
    {
      id: 'action-1',
      action_type: 'remove_post',
      target_post_id: 'post-1',
      reason: SEEDED_REASON_MARKER,
    } as Parameters<typeof composeModerationPushCopy>[0],
  )
  assertEquals(copy.title, 'Post removed')
})

Deno.test('composeModerationPushCopy: suspend_user -> "Account suspended"', () => {
  const copy = composeModerationPushCopy(
    {
      id: 'action-2',
      action_type: 'suspend_user',
      target_user_id: 'user-1',
      reason: SEEDED_REASON_MARKER,
      metadata: { kind: 'post_react', duration_days: 3 },
    } as Parameters<typeof composeModerationPushCopy>[0],
  )
  assertEquals(copy.title, 'Account suspended')
})

Deno.test('composeModerationPushCopy: reinstate -> "Post restored"', () => {
  const copy = composeModerationPushCopy(
    {
      id: 'action-3',
      action_type: 'reinstate',
      target_post_id: 'post-3',
    } as Parameters<typeof composeModerationPushCopy>[0],
  )
  assertEquals(copy.title, 'Post restored')
})

Deno.test('composeModerationPushCopy: any other action_type -> "Account update" (default)', () => {
  const copy = composeModerationPushCopy(
    {
      id: 'action-4',
      action_type: 'some_future_action_type',
    } as Parameters<typeof composeModerationPushCopy>[0],
  )
  assertEquals(copy.title, 'Account update')
})

Deno.test('composeModerationPushCopy body is the existing templated composeMessage(...) string for suspend_user, including the safe duration/kind', () => {
  const copy = composeModerationPushCopy(
    {
      id: 'action-5',
      action_type: 'suspend_user',
      target_user_id: 'user-1',
      reason: SEEDED_REASON_MARKER,
      metadata: { kind: 'post_react', duration_days: 3 },
    } as Parameters<typeof composeModerationPushCopy>[0],
  )
  assertEquals(
    copy.body,
    'Your ability to post and react in the Collective is paused for 3 days. Writing and reading remain available.',
  )
})

Deno.test('composeModerationPushCopy body for remove_post is the fixed templated string', () => {
  const copy = composeModerationPushCopy(
    {
      id: 'action-6',
      action_type: 'remove_post',
      target_post_id: 'post-1',
      reason: SEEDED_REASON_MARKER,
    } as Parameters<typeof composeModerationPushCopy>[0],
  )
  assertEquals(copy.body, 'A post of yours was removed from the Collective.')
})

Deno.test('composeModerationPushCopy body NEVER contains the seeded reason free-text marker, for any action_type', () => {
  for (const actionType of ['remove_post', 'suspend_user', 'reinstate', 'unknown_action']) {
    const copy = composeModerationPushCopy(
      {
        id: 'action-marker',
        action_type: actionType,
        target_post_id: 'post-1',
        target_user_id: 'user-1',
        reason: SEEDED_REASON_MARKER,
        metadata: { kind: 'post_react', duration_days: 5 },
      } as Parameters<typeof composeModerationPushCopy>[0],
    )
    assertEquals(
      copy.body.includes(SEEDED_REASON_MARKER),
      false,
      `leaked for action_type=${actionType}`,
    )
    assertEquals(
      copy.title.includes(SEEDED_REASON_MARKER),
      false,
      `leaked in title for action_type=${actionType}`,
    )
  }
})

// ---------------------------------------------------------------------------
// Handler-level push-delivery extension: the moderation.enabled preference
// gate, the token lookup, the exact `data` payload, and the reused
// fanOutExpoPush dispatch. A fuller fake client than the dedupe-only fixture
// above -- covers moderation_notification_log, collective_posts (unused here
// since these tests use suspend_user's direct target_user_id path), users
// (the new preference read), and user_push_tokens (both the SELECT the
// handler issues directly AND the UPDATE fanOutExpoPush issues for
// DeviceNotRegistered pruning).
// ---------------------------------------------------------------------------

interface FullMockConfig {
  ledger?: { data: unknown; error: unknown }
  preferences?: { data: unknown; error: unknown }
  tokens?: { data: unknown; error: unknown }
  onTokenPrune?: (token: string) => void
}

function buildFullMockClient(actionId: string, config: FullMockConfig) {
  return {
    from(table: string) {
      if (table === 'moderation_notification_log') {
        return {
          upsert(row: { moderation_action_id: string }, opts: Record<string, unknown>) {
            assertEquals(row.moderation_action_id, actionId)
            assertEquals(opts.onConflict, 'moderation_action_id')
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
      if (table === 'users') {
        return {
          select(cols: string) {
            assertEquals(cols, 'preferences')
            return {
              eq(col: string, _value: string) {
                assertEquals(col, 'id')
                return {
                  maybeSingle() {
                    if (!config.preferences) {
                      throw new Error('preferences lookup not configured for this test')
                    }
                    return Promise.resolve(config.preferences)
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
              eq(col1: string, _val1: unknown) {
                assertEquals(col1, 'user_id')
                return {
                  eq(col2: string, val2: unknown) {
                    assertEquals(col2, 'is_deleted')
                    assertEquals(val2, false)
                    if (!config.tokens) {
                      throw new Error('token lookup not configured for this test')
                    }
                    return Promise.resolve(config.tokens)
                  },
                }
              },
            }
          },
          update(_patch: { is_deleted: boolean }) {
            return {
              eq(_col: string, token: string) {
                config.onTokenPrune?.(token)
                return Promise.resolve({ data: null, error: null })
              },
            }
          },
        }
      }
      throw new Error(`unexpected table access "${table}"`)
    },
    // deno-lint-ignore no-explicit-any
  } as any
}

function suspendUserPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-0000000000b1',
    action_type: 'suspend_user',
    target_user_id: '00000000-0000-0000-0000-0000000000b2',
    target_post_id: null,
    reason: SEEDED_REASON_MARKER,
    metadata: { kind: 'post_react', duration_days: 3 },
    ...overrides,
  }
}

const AFFECTED_USER_ID = '00000000-0000-0000-0000-0000000000b2'

function withFetchCapture(
  fn: (get: () => { called: boolean; body: unknown }) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch
  let called = false
  let capturedBody: unknown = null
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    called = true
    capturedBody = JSON.parse(init?.body as string)
    const tickets = (capturedBody as unknown[]).map(() => ({ status: 'ok' }))
    return Promise.resolve(new Response(JSON.stringify({ data: tickets }), { status: 200 }))
  }) as typeof fetch
  return fn(() => ({ called, body: capturedBody })).finally(() => {
    globalThis.fetch = originalFetch
  })
}

Deno.test('handler dispatches an Expo push when moderation.enabled is true, with the exact documented data shape and no reason/reason_code leak', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withFetchCapture(async (getFetch) => {
      const client = buildFullMockClient('00000000-0000-0000-0000-0000000000b1', {
        ledger: {
          data: [{ moderation_action_id: '00000000-0000-0000-0000-0000000000b1' }],
          error: null,
        },
        preferences: {
          data: { preferences: { reminders: { moderation: { enabled: true } } } },
          error: null,
        },
        tokens: {
          data: [{ user_id: AFFECTED_USER_ID, expo_push_token: 'ExponentPushToken[mod-1]' }],
          error: null,
        },
      })

      const response = await handler(moderationRequest(suspendUserPayload()), client)
      assertEquals(response.status, 200)
      const body = await response.json()
      assertEquals(Object.keys(body).sort(), ['ok'])

      const { called, body: fetchBody } = getFetch()
      assertEquals(called, true)
      const messages = fetchBody as Array<{
        to: string
        title: string
        body: string
        data: Record<string, unknown>
      }>
      assertEquals(messages.length, 1)
      assertEquals(messages[0]?.to, 'ExponentPushToken[mod-1]')
      assertEquals(messages[0]?.title, 'Account suspended')

      const data = messages[0]?.data ?? {}
      assertEquals(Object.keys(data).sort(), [
        'action_type',
        'guidelines_link',
        'target_post_id',
        'type',
      ])
      assertEquals(data.type, 'moderation_action')
      assertEquals(data.action_type, 'suspend_user')
      assertEquals(data.target_post_id, null)
      assertEquals(typeof data.guidelines_link, 'string')
      assertEquals('reason' in data, false)
      assertEquals('reason_code' in data, false)
      assertEquals(JSON.stringify(messages).includes(SEEDED_REASON_MARKER), false)
    })
  })
})

Deno.test('handler does NOT send (no fetch call) when reminders.moderation.enabled is entirely absent from preferences', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withFetchCapture(async (getFetch) => {
      const client = buildFullMockClient('00000000-0000-0000-0000-0000000000b1', {
        ledger: {
          data: [{ moderation_action_id: '00000000-0000-0000-0000-0000000000b1' }],
          error: null,
        },
        preferences: { data: { preferences: {} }, error: null },
      })

      const response = await handler(moderationRequest(suspendUserPayload()), client)
      assertEquals(response.status, 200)
      const responseBody = await response.json()
      assertEquals(responseBody.ok, true)
      assertEquals(getFetch().called, false)
    })
  })
})

Deno.test('handler does NOT send when reminders.moderation.enabled is explicitly false', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withFetchCapture(async (getFetch) => {
      const client = buildFullMockClient('00000000-0000-0000-0000-0000000000b1', {
        ledger: {
          data: [{ moderation_action_id: '00000000-0000-0000-0000-0000000000b1' }],
          error: null,
        },
        preferences: {
          data: { preferences: { reminders: { moderation: { enabled: false } } } },
          error: null,
        },
      })

      const response = await handler(moderationRequest(suspendUserPayload()), client)
      assertEquals(response.status, 200)
      assertEquals(getFetch().called, false)
    })
  })
})

Deno.test('handler does NOT send when the affected user has a null preferences row', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withFetchCapture(async (getFetch) => {
      const client = buildFullMockClient('00000000-0000-0000-0000-0000000000b1', {
        ledger: {
          data: [{ moderation_action_id: '00000000-0000-0000-0000-0000000000b1' }],
          error: null,
        },
        preferences: { data: null, error: null },
      })

      const response = await handler(moderationRequest(suspendUserPayload()), client)
      assertEquals(response.status, 200)
      assertEquals(getFetch().called, false)
    })
  })
})

Deno.test('handler fails CLOSED (still ok(), no send) when the preference SELECT itself errors', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withFetchCapture(async (getFetch) => {
      const client = buildFullMockClient('00000000-0000-0000-0000-0000000000b1', {
        ledger: {
          data: [{ moderation_action_id: '00000000-0000-0000-0000-0000000000b1' }],
          error: null,
        },
        preferences: { data: null, error: { message: 'connection reset' } },
      })

      const response = await handler(moderationRequest(suspendUserPayload()), client)
      assertEquals(response.status, 200)
      const responseBody = await response.json()
      assertEquals(responseBody.ok, true)
      assertEquals(getFetch().called, false)
    })
  })
})

Deno.test('handler returns ok() with no send when the enabled recipient has zero live tokens (not an error)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    await withFetchCapture(async (getFetch) => {
      const client = buildFullMockClient('00000000-0000-0000-0000-0000000000b1', {
        ledger: {
          data: [{ moderation_action_id: '00000000-0000-0000-0000-0000000000b1' }],
          error: null,
        },
        preferences: {
          data: { preferences: { reminders: { moderation: { enabled: true } } } },
          error: null,
        },
        tokens: { data: [], error: null },
      })

      const response = await handler(moderationRequest(suspendUserPayload()), client)
      assertEquals(response.status, 200)
      const responseBody = await response.json()
      assertEquals(responseBody.ok, true)
      assertEquals(getFetch().called, false)
    })
  })
})

Deno.test('handler soft-deletes a DeviceNotRegistered token through the reused fanOutExpoPush (integration seam, not a re-test of expoPush.ts itself)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const originalFetch = globalThis.fetch
    const prunedTokens: string[] = []
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }],
          }),
          { status: 200 },
        ),
      )
    }) as typeof fetch

    try {
      const client = buildFullMockClient('00000000-0000-0000-0000-0000000000b1', {
        ledger: {
          data: [{ moderation_action_id: '00000000-0000-0000-0000-0000000000b1' }],
          error: null,
        },
        preferences: {
          data: { preferences: { reminders: { moderation: { enabled: true } } } },
          error: null,
        },
        tokens: {
          data: [{ user_id: AFFECTED_USER_ID, expo_push_token: 'ExponentPushToken[stale]' }],
          error: null,
        },
        onTokenPrune: (token) => prunedTokens.push(token),
      })

      const response = await handler(moderationRequest(suspendUserPayload()), client)
      assertEquals(response.status, 200)
      assertEquals(prunedTokens, ['ExponentPushToken[stale]'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

Deno.test('the seeded reason free-text marker appears in NO captured console.log/console.error line across a full enabled-and-sent run (NFR19 defense in depth beyond body/data)', async () => {
  await withServiceRoleKey(SERVICE_ROLE_KEY, async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 }),
      )
    }) as typeof fetch

    const originalLog = console.log
    const originalError = console.error
    const capturedLines: string[] = []
    console.log = ((...args: unknown[]) => {
      capturedLines.push(String(args[0] ?? ''))
    }) as typeof console.log
    console.error = ((...args: unknown[]) => {
      capturedLines.push(String(args[0] ?? ''))
    }) as typeof console.error

    try {
      const client = buildFullMockClient('00000000-0000-0000-0000-0000000000b1', {
        ledger: {
          data: [{ moderation_action_id: '00000000-0000-0000-0000-0000000000b1' }],
          error: null,
        },
        preferences: {
          data: { preferences: { reminders: { moderation: { enabled: true } } } },
          error: null,
        },
        tokens: {
          data: [{ user_id: AFFECTED_USER_ID, expo_push_token: 'ExponentPushToken[mod-log]' }],
          error: null,
        },
      })

      await handler(moderationRequest(suspendUserPayload()), client)

      for (const line of capturedLines) {
        assertEquals(line.includes(SEEDED_REASON_MARKER), false, `leaked in log line: ${line}`)
      }
    } finally {
      console.log = originalLog
      console.error = originalError
      globalThis.fetch = originalFetch
    }
  })
})
