// notify_moderation_action — the repo's first Edge Function.
//
// Fired asynchronously by an AFTER INSERT trigger on moderation_actions (via
// pg_net) whenever a destructive moderation action is taken. It resolves the
// affected user, checks their moderation-notification opt-in, looks up their
// live push tokens, and dispatches one Expo push per token through the shared
// fanOutExpoPush helper. It is trigger-context: gated by a service-role bearer
// (verify_jwt = false), DB access via the RLS-bypassing service-role client.
//
// IDEMPOTENCY — claim-first, at-most-once (deliberate). The FIRST DB write
// claims the action in moderation_notification_log; a re-fired/duplicated
// trigger inserts zero rows and short-circuits to a no-op BEFORE any preference
// read / token lookup / send. The claim is never rolled back on a downstream or
// Expo failure — so ANY post-claim failure permanently forgoes that one push.
// This is the accepted trade against ever DOUBLE-notifying a moderated user
// (who also sees the in-app receipt, so the push is not their sole channel).
// The ledger is intentionally NOT evolved into a two-state sent/delivered
// record; a dropped push is preferred to a duplicated one.
//
// SECURITY POSTURE. The function is reachable at its public URL with only the
// bearer check as a wall, so:
//   - the SUCCESS response is a minimal `ok()` with NO resolved user / author
//     data (echoing it would make the function a target_post_id -> author
//     enumeration oracle for anyone holding the bearer);
//   - resolution results stay server-side, in a metadata-only log line;
//   - the push body is the TEMPLATED reason only (composeMessage) — never the
//     raw payload.reason, which can carry a moderator's free-text note
//     (suspend_user folds an optional custom note into `reason`); and the
//     `data` payload carries no reason/reason_code — so no free text ever
//     reaches the notification or any log field.

import { createServiceRoleClient, requireServiceRole } from '../_shared/auth.ts'
import { logError, logInfo, redact } from '../_shared/logging.ts'
import { err, ok } from '../_shared/responses.ts'
import { type ExpoMessage, fanOutExpoPush } from '../_shared/expoPush.ts'
import { emitServerEvent, SERVER_DISTINCT_ID } from '../_shared/posthog.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

// The deep-link payload attached to each moderation push. EXACTLY these four
// fields — the in-app moderation-receipt UI routes a tapped push to the correct
// receipt from them. reason / reason_code are DELIBERATELY absent (free-text leak).
export interface ModerationNotificationData {
  type: 'moderation_action'
  action_type: string
  target_post_id: string | null
  guidelines_link: string
}

// Loose but sufficient UUID-shape check (8-4-4-4-12 hex, version-agnostic —
// moderation_actions.id is a plain `UUID` column, not pinned to v4). Used to
// reject a malformed id BEFORE any DB call, so a bad client input surfaces as
// 400 rather than tripping a Postgres FK/syntax error that would otherwise be
// misclassified as a 500 server fault.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Shape of the trigger payload. `note` is intentionally NOT part of the
// contract — the trigger omits it — but it is typed optional so the
// defense-in-depth guards below are type-checkable.
export interface ModerationActionPayload {
  id: string
  action_type: string
  target_post_id?: string | null
  target_user_id?: string | null
  reason?: string | null
  metadata?: Record<string, unknown> | null
  created_at?: string
  note?: string | null
}

export interface ComposedNotification {
  type: 'moderation_action'
  action_type: string
  reason_code: string | null
  target_post_id: string | null
  message: string
  guidelines_link: string
}

const DEFAULT_COMMUNITY_GUIDELINES_URL = 'https://riverjournal.app/community-guidelines'

// Env-overridable, read defensively: `deno test` may run without --allow-env,
// in which case Deno.env.get throws; fall back to the documented placeholder.
export function communityGuidelinesUrl(): string {
  try {
    return Deno.env.get('COMMUNITY_GUIDELINES_URL') ?? DEFAULT_COMMUNITY_GUIDELINES_URL
  } catch {
    return DEFAULT_COMMUNITY_GUIDELINES_URL
  }
}

// Action types whose affected user is derived from the target post's author.
const POST_DERIVED_ACTIONS = new Set(['remove_post', 'reinstate'])

// Resolve the affected user id:
//   - target_user_id wins when present (suspend_user);
//   - otherwise, for remove_post / reinstate, derive it via a service-role
//     SELECT of collective_posts.user_id for target_post_id;
//   - a null/missing target_post_id, a hard-deleted post, or any query error
//     resolves to null WITHOUT throwing.
export async function resolveAffectedUserId(
  payload: Pick<ModerationActionPayload, 'action_type' | 'target_user_id' | 'target_post_id'>,
  client: SupabaseClient,
): Promise<string | null> {
  if (payload.target_user_id) {
    return payload.target_user_id
  }
  const postId = payload.target_post_id
  if (!postId || !POST_DERIVED_ACTIONS.has(payload.action_type)) {
    return null
  }
  try {
    const { data, error } = await client
      .from('collective_posts')
      .select('user_id')
      .eq('id', postId)
      .maybeSingle()
    if (error || !data) {
      return null
    }
    return (data as { user_id: string | null }).user_id ?? null
  } catch {
    return null
  }
}

function composeMessage(
  actionType: string,
  kind: string | undefined,
  durationDays: number | undefined,
): string {
  switch (actionType) {
    case 'remove_post':
      return 'A post of yours was removed from the Collective.'
    case 'reinstate':
      return 'A post of yours was restored to the Collective.'
    case 'suspend_user': {
      const window = typeof durationDays === 'number'
        ? ` for ${durationDays} day${durationDays === 1 ? '' : 's'}`
        : ''
      const scope = kind === 'post_react' ? 'post and react' : 'participate'
      return `Your ability to ${scope} in the Collective is paused${window}. Writing and reading remain available.`
    }
    default:
      return 'A moderation action was taken on your account.'
  }
}

// Compose the user-facing notification payload. `reason_code` carries the
// action's reason (the affected user is entitled to it). `message` is built
// from action_type + safe metadata (kind/duration_days) — never by echoing raw
// free text. A `note`, even if a malformed/future payload carried one, is
// NEVER folded into the output.
export function composeNotification(
  payload: ModerationActionPayload,
  _affectedUserId: string | null,
): ComposedNotification {
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>
  const kind = typeof metadata.kind === 'string' ? metadata.kind : undefined
  const durationDays = typeof metadata.duration_days === 'number'
    ? metadata.duration_days
    : undefined
  return {
    type: 'moderation_action',
    action_type: payload.action_type,
    reason_code: payload.reason ?? null,
    target_post_id: payload.target_post_id ?? null,
    message: composeMessage(payload.action_type, kind, durationDays),
    guidelines_link: communityGuidelinesUrl(),
  }
}

// Action-aware push copy. The TITLE maps off action_type; the BODY is the
// existing composeMessage() templated string — built from action_type + safe
// metadata (kind/duration_days) ONLY. The body MUST NEVER interpolate
// payload.reason: suspend_user folds the moderator's optional free-text note
// INTO `reason`, so echoing it would leak the private note.
export function composeModerationPushCopy(
  payload: ModerationActionPayload,
): { title: string; body: string } {
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>
  const kind = typeof metadata.kind === 'string' ? metadata.kind : undefined
  const durationDays = typeof metadata.duration_days === 'number'
    ? metadata.duration_days
    : undefined
  // TODO(tone): titles pending tone review (as with the sibling functions).
  let title: string
  switch (payload.action_type) {
    case 'remove_post':
      title = 'Post removed'
      break
    case 'suspend_user':
      title = 'Account suspended'
      break
    case 'reinstate':
      title = 'Post restored'
      break
    default:
      title = 'Account update'
  }
  return { title, body: composeMessage(payload.action_type, kind, durationDays) }
}

// Pre-log redaction for the run log line — recursively drops content keys
// (note, reason, ...) even nested inside metadata, keeping safe flat fields
// (action_type, resolved user_id, target_post_id, kind, duration_days).
export function redactForLog(fields: Record<string, unknown>): Record<string, unknown> {
  return redact(fields) as Record<string, unknown>
}

// Shape of a live push-token row for the affected user.
interface TokenRow {
  user_id: string
  expo_push_token: string
}

// `clientOverride` exists so tests can inject a mocked Supabase client (e.g.
// to exercise the dedupe short-circuit or a ledger-write-failure path)
// without a live database. Production callers (Deno.serve below) never pass
// it — the handler falls back to createServiceRoleClient().
export async function handler(req: Request, clientOverride?: SupabaseClient): Promise<Response> {
  const started = Date.now()
  const denied = requireServiceRole(req)
  if (denied) {
    return denied
  }

  let payload: ModerationActionPayload
  try {
    payload = (await req.json()) as ModerationActionPayload
  } catch {
    return err('invalid JSON body', { code: 'bad_request', status: 400 })
  }

  if (!payload || typeof payload.id !== 'string' || typeof payload.action_type !== 'string') {
    return err('malformed payload', { code: 'bad_request', status: 400 })
  }

  // Validate id shape BEFORE any DB call. A non-UUID id would otherwise hit
  // the ledger insert and surface as a Postgres syntax error (22P02),
  // misclassifying bad client input as a server fault.
  if (!UUID_RE.test(payload.id)) {
    return err('id must be a UUID', { code: 'bad_request', status: 400 })
  }

  // add_note is a no-op (defense in depth beneath the trigger's WHEN filter):
  // a private moderator note must never produce a user-facing notification.
  if (payload.action_type === 'add_note') {
    return ok()
  }

  // createServiceRoleClient() throws if SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
  // are unset — wrap it so a misconfigured environment returns a proper err()
  // envelope instead of an uncaught throw / bare 500.
  let client: SupabaseClient
  try {
    client = clientOverride ?? createServiceRoleClient()
  } catch {
    logError(
      'moderation.notify.client_init_error',
      redactForLog({ action_type: payload.action_type }),
    )
    return err('service misconfigured', { code: 'internal', status: 500 })
  }

  // Insert-first idempotency (claim-first, at-most-once). The first DB write
  // claims the action in the ledger; a re-fired/duplicated trigger inserts zero
  // rows and short-circuits to a no-op BEFORE any preference read / token lookup
  // / send. The claim is never rolled back on a downstream/Expo failure, and the
  // ledger is deliberately NOT a two-state sent/delivered record — a dropped push
  // is the accepted trade against ever double-notifying a moderated user (see the
  // header's IDEMPOTENCY note).
  const { data: claimed, error: ledgerError } = await client
    .from('moderation_notification_log')
    .upsert(
      { moderation_action_id: payload.id },
      { onConflict: 'moderation_action_id', ignoreDuplicates: true },
    )
    .select('moderation_action_id')

  if (ledgerError) {
    // 23503 = foreign_key_violation: a well-formed but unknown/nonexistent
    // moderation_actions.id (the FK the ledger's PK references). That is
    // client input, not a server fault — 400, not 500.
    if ((ledgerError as { code?: string }).code === '23503') {
      logInfo(
        'moderation.notify.unknown_action_id',
        redactForLog({ action_type: payload.action_type }),
      )
      return err('unknown moderation action id', { code: 'bad_request', status: 400 })
    }
    logError('moderation.notify.ledger_error', redactForLog({ action_type: payload.action_type }))
    return err('ledger write failed', { code: 'internal', status: 500 })
  }
  if (!claimed || claimed.length === 0) {
    // Already processed — idempotent no-op (dedupe short-circuit). Return
    // immediately without resolving the affected user, composing a
    // notification, or logging a push-intent line.
    return ok()
  }

  const affectedUserId = await resolveAffectedUserId(payload, client)
  if (!affectedUserId) {
    // No resolvable target (e.g. hard-deleted post): redacted warn, still ok.
    logError(
      'moderation.notify.no_target',
      redactForLog({
        action_type: payload.action_type,
        target_post_id: payload.target_post_id ?? null,
      }),
    )
    return ok()
  }

  // Strict opt-in gate, read INLINE (no RPC). Moderation has no private-schema
  // predicate to hide behind a SECURITY DEFINER function (unlike notify_reply's
  // block filter) — it is admin->user with no block gate — so the service-role
  // client reads users.preferences directly (users is public; service-role
  // bypasses RLS). Gate strictly on `=== true` (default OFF, like every other
  // reminder category). FAIL CLOSED: a missing/false flag OR a SELECT error
  // means DO NOT SEND — an unknown preference state must never notify. The
  // ledger is already claimed, so the action counts as processed; a later
  // toggle-on does not retroactively notify past actions.
  let moderationEnabled = false
  try {
    const { data: prefRow, error: prefError } = await client
      .from('users')
      .select('preferences')
      .eq('id', affectedUserId)
      .maybeSingle()
    if (prefError) {
      logError(
        'moderation.notify.preference_error',
        redactForLog({ action_type: payload.action_type }),
      )
    } else {
      const preferences = (prefRow as { preferences?: unknown } | null)?.preferences as
        | { reminders?: { moderation?: { enabled?: boolean } } }
        | null
        | undefined
      moderationEnabled = preferences?.reminders?.moderation?.enabled === true
    }
  } catch {
    logError(
      'moderation.notify.preference_error',
      redactForLog({ action_type: payload.action_type }),
    )
  }

  if (!moderationEnabled) {
    // Opted out / unknown state — processed, but no send. Metadata-only log.
    logInfo('moderation.notify.run', {
      action_type: payload.action_type,
      user_id: affectedUserId,
      token_count: 0,
      sent_count: 0,
      device_not_registered_count: 0,
      error_ticket_count: 0,
      chunk_failure_count: 0,
      duration_ms: Date.now() - started,
    })
    return ok()
  }

  // Look up the affected user's live tokens (service-role, RLS-bypassing).
  // FAIL-CLOSED on error: a lookup failure forgoes the push (claim-first
  // at-most-once — never retried into a possible double-notify).
  let tokens: TokenRow[] = []
  try {
    const { data, error } = await client
      .from('user_push_tokens')
      .select('user_id, expo_push_token')
      .eq('user_id', affectedUserId)
      .eq('is_deleted', false)
    if (error) {
      logError(
        'moderation.notify.token_lookup_error',
        redactForLog({ action_type: payload.action_type }),
      )
      return ok()
    }
    tokens = (data ?? []) as TokenRow[]
  } catch {
    logError(
      'moderation.notify.token_lookup_error',
      redactForLog({ action_type: payload.action_type }),
    )
    return ok()
  }

  // Build one message per live token. body/title from composeModerationPushCopy
  // (templated — never raw reason); data = EXACTLY the four routing fields (no
  // reason/reason_code). A zero-token recipient yields no messages and is NOT
  // an error — fanOutExpoPush no-ops on an empty list.
  const copy = composeModerationPushCopy(payload)
  const guidelinesLink = communityGuidelinesUrl()
  const messages: ExpoMessage<ModerationNotificationData>[] = tokens.map((t) => ({
    to: t.expo_push_token,
    title: copy.title,
    body: copy.body,
    data: {
      type: 'moderation_action',
      action_type: payload.action_type,
      target_post_id: payload.target_post_id ?? null,
      guidelines_link: guidelinesLink,
    },
  }))

  // Reuse the shared fan-out (chunking + response-shape guard +
  // DeviceNotRegistered soft-delete) — never re-implemented here.
  const result = await fanOutExpoPush(client, messages)

  // Privacy-safe: metadata only — never the composed title/body, reason, note,
  // or kind/duration_days as content (redact() strips them anyway as a backstop).
  logInfo('moderation.notify.run', {
    action_type: payload.action_type,
    user_id: affectedUserId,
    token_count: tokens.length,
    sent_count: result.sentCount,
    device_not_registered_count: result.deviceNotRegisteredCount,
    error_ticket_count: result.errorTicketCount,
    chunk_failure_count: result.chunkFailureCount,
    duration_ms: Date.now() - started,
  })

  // Best-effort, fail-open product-analytics emit on the ONE real delivery path
  // (opted-in recipient, fanOutExpoPush ran). action_type is the enum value;
  // counts are aggregate — NO user id, no reason/note, no content. Awaited but
  // returns void and never throws, so the metadata-only ok() / enumeration-
  // oracle guard is unchanged.
  await emitServerEvent('moderation_notification_delivered', SERVER_DISTINCT_ID, {
    action_type: payload.action_type,
    sent_count: result.sentCount,
    failed_count: result.errorTicketCount + result.chunkFailureCount,
  })

  // Minimal success body — NO resolved user / author (enumeration-oracle guard).
  return ok()
}

// Only bind the server when this module is the program entry point (the Edge
// Runtime runs it as main). Guarded so `deno test` can import the pure helpers
// above without starting an HTTP listener.
if (import.meta.main) {
  // Wrapped (rather than passed directly) because handler's second parameter
  // is a test-only client override — Deno.serve's handler signature doesn't
  // accept it, and production requests never supply one.
  Deno.serve((req) => handler(req))
}
