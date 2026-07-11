// notify_moderation_action — the repo's first Edge Function.
//
// Fired asynchronously by an AFTER INSERT trigger on moderation_actions (via
// pg_net) whenever a destructive moderation action is taken. It resolves the
// affected user, composes a structured notification, and — at this milestone —
// STUBS the push fan-out (logs the intended notification, redacted; no
// user_push_tokens lookup, no Expo POST — those arrive in the push-delivery
// milestone). It is trigger-context: gated by a service-role bearer
// (verify_jwt = false), DB access via the RLS-bypassing service-role client.
//
// SECURITY POSTURE. The function is reachable at its public URL with only the
// bearer check as a wall, so:
//   - the SUCCESS response is a minimal `ok()` with NO resolved user / author
//     data (echoing it would make the function a target_post_id -> author
//     enumeration oracle for anyone holding the bearer);
//   - resolution results stay server-side, in a redacted log line only;
//   - the private moderator `note` is never received (the trigger payload omits
//     it) and never composed/logged (defense in depth below).

import { createServiceRoleClient, requireServiceRole } from '../_shared/auth.ts'
import { logError, logInfo, redact } from '../_shared/logging.ts'
import { err, ok } from '../_shared/responses.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

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

// Pre-log redaction for the stub push-intent line — recursively drops content
// keys (note, reason, ...) even nested inside metadata, keeping safe flat
// fields (action_type, resolved user_id, target_post_id, kind, duration_days).
export function redactForLog(fields: Record<string, unknown>): Record<string, unknown> {
  return redact(fields) as Record<string, unknown>
}

// `clientOverride` exists so tests can inject a mocked Supabase client (e.g.
// to exercise the dedupe short-circuit or a ledger-write-failure path)
// without a live database. Production callers (Deno.serve below) never pass
// it — the handler falls back to createServiceRoleClient().
export async function handler(req: Request, clientOverride?: SupabaseClient): Promise<Response> {
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

  // Insert-first idempotency (at-most-once for the STUB). The first DB write
  // claims the action in the ledger; a re-fired/duplicated trigger inserts zero
  // rows and short-circuits to a no-op. (Push-delivery milestone must evolve
  // this into a two-state record so a crash-before-delivery is retryable.)
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

  const notification = composeNotification(payload, affectedUserId)
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>

  // STUB push fan-out: log the intended (redacted) notification. The
  // push-delivery milestone resolves user_push_tokens + POSTs to Expo Push
  // here. Never log body/reason/note — only IDs, action type, kind, duration.
  logInfo(
    'moderation.notify.push_intent',
    redactForLog({
      action_type: notification.action_type,
      user_id: affectedUserId,
      target_post_id: notification.target_post_id,
      kind: metadata.kind,
      duration_days: metadata.duration_days,
    }),
  )

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
