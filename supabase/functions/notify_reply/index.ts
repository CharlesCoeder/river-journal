// notify_reply — the Collective reply-notification fan-out.
//
// Fired asynchronously by an AFTER INSERT trigger on collective_posts (WHERE
// parent_post_id IS NOT NULL) via pg_net whenever a reply is posted. It resolves
// at most two recipients — the immediate parent post's author and the thread
// root's author, deduped, minus the replier — filters them through the symmetric
// block predicate + the replies-notification preference gate (both in SQL, via
// notify_reply_eligible_recipients), and batch-POSTs one Expo push per surviving
// recipient's live token. It is trigger-context: gated by a service-role bearer
// (verify_jwt = false), DB access via the RLS-bypassing service-role client
// (required to read every user's collective_posts.user_id, preferences, tokens).
//
// SECURITY POSTURE. Reachable at its public URL with only the bearer check as a
// wall, so:
//   - the SUCCESS response is a minimal ok() with NO resolved recipient/author
//     data (echoing it would make the function a parent_post_id -> author
//     enumeration oracle for anyone holding the bearer);
//   - resolution results stay server-side, in metadata-only log lines;
//   - the reply body text is NEVER fetched into the function and NEVER placed in
//     a notification or a log field.
//
// FAIL-CLOSED. The eligibility RPC's returned set is the ONLY recipient source.
// Any error/timeout/non-array from it — or from thread_root_user_id, the
// parent-author SELECT, or the token lookup — aborts to err(500) and delivers
// NOTHING. There is deliberately no branch that fans out to the unfiltered
// candidate set: a dropped push is the accepted trade against leaking a
// name + activity signal to a blocked pair over this out-of-band channel.
//
// AT-MOST-ONCE. The FIRST DB write claims a reply_notification_log row (INSERT
// ... ON CONFLICT DO NOTHING) keyed on the reply's post_id, BEFORE any
// recipient resolution / token lookup / fan-out. A zero-row claim means
// "already processed" — an immediate no-op. The claim is CLAIM-FIRST and
// NEVER released: it is not rolled back on ANY post-claim failure, whether
// that failure happens before a send is even attempted (parent-author lookup,
// thread_root_user_id, the eligibility RPC, the token lookup) or during the
// Expo POST itself. Every one of those failure modes permanently forgoes that
// reply's notification — a re-fired/duplicated trigger or a manual
// re-invoke hits the zero-row short-circuit and is a deliberate no-op, not a
// retry. A dropped push is the accepted trade against ever double-notifying.

import { createServiceRoleClient, requireServiceRole } from '../_shared/auth.ts'
import { logError, logInfo } from '../_shared/logging.ts'
import { err, ok } from '../_shared/responses.ts'
import { type ExpoMessage, fanOutExpoPush } from '../_shared/expoPush.ts'
import { emitServerEvent, SERVER_DISTINCT_ID } from '../_shared/posthog.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

// Loose but sufficient UUID-shape check (8-4-4-4-12 hex, version-agnostic —
// collective_posts.id is a plain UUID column). Used to reject a malformed id
// BEFORE any DB call, so bad client input surfaces as 400 rather than tripping a
// Postgres syntax error (22P02) that would otherwise be misclassified as a 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The trigger payload. Only ids + timestamp — no body text ever crosses this
// boundary. user_id is the replier; it is nullable (an already-anonymized
// author) — a null replier is a no-op (nothing to attribute).
export interface ReplyPayload {
  id: string
  user_id?: string | null
  parent_post_id: string
  created_at?: string
}

// The deep-link payload each push carries so a tapped notification can route
// the client to the new reply within its thread. post_id is the reply's OWN id.
export interface ReplyNotificationData {
  type: 'collective_reply'
  post_id: string
  parent_post_id: string
}

interface TokenRow {
  user_id: string
  expo_push_token: string
}

// Build the <=2 deduped recipient set in TypeScript: the parent author (if
// non-null and not the replier), followed by the thread-root author (if
// non-null, not the replier, and not already included as the parent author).
// Order: parent first, then root. In the common single-level reply case
// (parent == root) the two collapse to one. All degenerate shapes — self-reply
// (both == replier → zero recipients), reply-to-own-comment-mid-thread (parent
// dropped, root kept), anonymized ancestor (that slot dropped on the non-null
// check) — fall out of these two conditions.
export function buildReplyRecipientCandidates(
  replierId: string,
  parentAuthorId: string | null,
  rootAuthorId: string | null,
): string[] {
  const candidates: string[] = []
  if (parentAuthorId !== null && parentAuthorId !== replierId) {
    candidates.push(parentAuthorId)
  }
  if (
    rootAuthorId !== null &&
    rootAuthorId !== replierId &&
    rootAuthorId !== parentAuthorId
  ) {
    candidates.push(rootAuthorId)
  }
  return candidates
}

// The ONLY place user-facing English lives. Title is fixed; the body is built
// solely from the replier's Collective pseudonym — the 8-char slice of their
// user_id, the same pseudonym every Collective surface renders (there is no
// display_name/username column). The reply body text is NEVER included.
// TODO(tone): copy pending review — the exact strings, and whether even the
// pseudonym belongs in the body (a fully anonymous "Someone replied" is a
// calmer alternative), are deferred to a tone review.
export function composeReplyCopy(replierId: string): { title: string; body: string } {
  return {
    title: 'New reply',
    body: `${replierId.slice(0, 8)} replied to your post`,
  }
}

// `clientOverride` exists so tests can inject a mocked Supabase client without a
// live database. Production callers (Deno.serve below) never pass it — the
// handler falls back to createServiceRoleClient().
export async function handler(req: Request, clientOverride?: SupabaseClient): Promise<Response> {
  const started = Date.now()

  const denied = requireServiceRole(req)
  if (denied) {
    return denied
  }

  let payload: ReplyPayload
  try {
    payload = (await req.json()) as ReplyPayload
  } catch {
    return err('invalid JSON body', { code: 'bad_request', status: 400 })
  }

  if (
    !payload ||
    typeof payload.id !== 'string' ||
    typeof payload.parent_post_id !== 'string'
  ) {
    return err('malformed payload', { code: 'bad_request', status: 400 })
  }

  // Validate id shapes BEFORE any DB call, so a non-UUID surfaces as 400 rather
  // than a mis-classified Postgres 22P02 -> 500.
  if (!UUID_RE.test(payload.id) || !UUID_RE.test(payload.parent_post_id)) {
    return err('id and parent_post_id must be UUIDs', { code: 'bad_request', status: 400 })
  }

  // user_id is nullable (an already-anonymized replier), but when present it
  // must be UUID-shaped too -- validated BEFORE the ledger claim below. Without
  // this, a well-formed id/parent_post_id paired with a garbage user_id would
  // pass validation, claim (burn) the idempotency ledger, and only then trip a
  // Postgres 22P02 inside notify_reply_eligible_recipients -- a mis-classified
  // 500 AND a permanently dropped notification (the claim is never released).
  if (
    payload.user_id != null &&
    (typeof payload.user_id !== 'string' || !UUID_RE.test(payload.user_id))
  ) {
    return err('user_id must be a UUID or null', { code: 'bad_request', status: 400 })
  }

  // createServiceRoleClient() throws if SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
  // are unset — wrap it so a misconfigured env returns a proper err() envelope
  // instead of an uncaught throw / bare 500.
  let client: SupabaseClient
  try {
    client = clientOverride ?? createServiceRoleClient()
  } catch {
    logError('collective.reply.notify.client_init_error', {})
    return err('service misconfigured', { code: 'internal', status: 500 })
  }

  // Claim-first idempotency. This standalone, committed statement is the FIRST
  // DB write; a zero-row claim means "already processed" -> immediate no-op
  // before any recipient resolution / token lookup / fan-out.
  const { data: claimed, error: ledgerError } = await client
    .from('reply_notification_log')
    .upsert(
      { reply_post_id: payload.id },
      { onConflict: 'reply_post_id', ignoreDuplicates: true },
    )
    .select('reply_post_id')

  if (ledgerError) {
    // 23503 = foreign_key_violation: a well-formed but unknown reply post_id
    // (the FK the ledger's PK references). That is client input, not a server
    // fault — 400, not 500.
    if ((ledgerError as { code?: string }).code === '23503') {
      logInfo('collective.reply.notify.unknown_reply_id', {})
      return err('unknown reply id', { code: 'bad_request', status: 400 })
    }
    logError('collective.reply.notify.ledger_error', {})
    return err('ledger write failed', { code: 'internal', status: 500 })
  }
  if (!claimed || claimed.length === 0) {
    // Already processed — idempotent no-op. NO downstream work.
    return ok()
  }

  // The just-inserted reply always has an author; a null replier is an
  // already-anonymized author — nothing to attribute, so no-op.
  const replierId = payload.user_id ?? null
  if (replierId === null) {
    return ok()
  }

  // Resolve the parent author. FAIL-CLOSED: any error aborts and delivers
  // nothing.
  let parentAuthorId: string | null
  try {
    const { data, error } = await client
      .from('collective_posts')
      .select('user_id')
      .eq('id', payload.parent_post_id)
      .maybeSingle()
    if (error) {
      logError('collective.reply.notify.parent_lookup_error', {})
      return err('parent author lookup failed', { code: 'internal', status: 500 })
    }
    parentAuthorId = (data as { user_id: string | null } | null)?.user_id ?? null
  } catch {
    logError('collective.reply.notify.parent_lookup_error', {})
    return err('parent author lookup failed', { code: 'internal', status: 500 })
  }

  // Resolve the thread-root author via the mandated helper (never an inlined
  // CTE). FAIL-CLOSED on error.
  let rootAuthorId: string | null
  try {
    const { data, error } = await client.rpc('thread_root_user_id', {
      post_id: payload.parent_post_id,
    })
    if (error) {
      logError('collective.reply.notify.root_lookup_error', {})
      return err('thread root lookup failed', { code: 'internal', status: 500 })
    }
    rootAuthorId = (data as string | null) ?? null
  } catch {
    logError('collective.reply.notify.root_lookup_error', {})
    return err('thread root lookup failed', { code: 'internal', status: 500 })
  }

  const candidateIds = buildReplyRecipientCandidates(replierId, parentAuthorId, rootAuthorId)
  if (candidateIds.length === 0) {
    logInfo('collective.reply.notify.run', {
      reply_id: payload.id,
      parent_post_id: payload.parent_post_id,
      recipient_count: 0,
      token_count: 0,
      sent_count: 0,
      device_not_registered_count: 0,
      error_ticket_count: 0,
      chunk_failure_count: 0,
      duration_ms: Date.now() - started,
    })
    return ok()
  }

  // The eligibility RPC is the SOLE recipient source. FAIL-CLOSED: an error,
  // timeout, or non-array result aborts and delivers nothing — never a fall-back
  // to the unfiltered candidate set.
  let recipientIds: string[]
  try {
    const { data, error } = await client.rpc('notify_reply_eligible_recipients', {
      candidate_ids: candidateIds,
      replier_id: replierId,
    })
    if (error || !Array.isArray(data)) {
      logError('collective.reply.notify.eligibility_error', {})
      return err('recipient eligibility check failed', { code: 'internal', status: 500 })
    }
    recipientIds = data as string[]
  } catch {
    logError('collective.reply.notify.eligibility_error', {})
    return err('recipient eligibility check failed', { code: 'internal', status: 500 })
  }

  if (recipientIds.length === 0) {
    logInfo('collective.reply.notify.run', {
      reply_id: payload.id,
      parent_post_id: payload.parent_post_id,
      recipient_count: 0,
      token_count: 0,
      sent_count: 0,
      device_not_registered_count: 0,
      error_ticket_count: 0,
      chunk_failure_count: 0,
      duration_ms: Date.now() - started,
    })
    return ok()
  }

  // Look up live tokens for the surviving recipients. FAIL-CLOSED on error.
  let tokens: TokenRow[]
  try {
    const { data, error } = await client
      .from('user_push_tokens')
      .select('user_id, expo_push_token')
      .eq('is_deleted', false)
      .in('user_id', recipientIds)
    if (error) {
      logError('collective.reply.notify.token_lookup_error', {})
      return err('token lookup failed', { code: 'internal', status: 500 })
    }
    tokens = (data ?? []) as TokenRow[]
  } catch {
    logError('collective.reply.notify.token_lookup_error', {})
    return err('token lookup failed', { code: 'internal', status: 500 })
  }

  const copy = composeReplyCopy(replierId)
  const messages: ExpoMessage<ReplyNotificationData>[] = tokens.map((t) => ({
    to: t.expo_push_token,
    title: copy.title,
    body: copy.body,
    data: {
      type: 'collective_reply',
      // The reply's OWN id, so a tapped push deep-links to the new reply.
      post_id: payload.id,
      parent_post_id: payload.parent_post_id,
    },
  }))

  const result = await fanOutExpoPush(client, messages)

  // Metadata only — never the composed title/body or any content.
  logInfo('collective.reply.notify.run', {
    reply_id: payload.id,
    parent_post_id: payload.parent_post_id,
    recipient_count: recipientIds.length,
    token_count: tokens.length,
    sent_count: result.sentCount,
    device_not_registered_count: result.deviceNotRegisteredCount,
    error_ticket_count: result.errorTicketCount,
    chunk_failure_count: result.chunkFailureCount,
    duration_ms: Date.now() - started,
  })

  // Best-effort, fail-open product-analytics emit on the ONE real delivery path
  // (fanOutExpoPush ran). Aggregate counts only — NO recipient/author id, no
  // content. Awaited so the request isolate doesn't tear down an un-flushed
  // fetch, but it returns void and never throws, so it cannot alter the
  // fail-closed posture or the minimal ok() body below.
  await emitServerEvent('collective_reply_delivered', SERVER_DISTINCT_ID, {
    recipient_count: recipientIds.length,
    sent_count: result.sentCount,
    failed_count: result.errorTicketCount + result.chunkFailureCount,
  })

  // Minimal success body — NO resolved recipient / author (enumeration-oracle guard).
  return ok()
}

// Only bind the server when this module is the program entry point (the Edge
// Runtime runs it as main). Guarded so `deno test` can import the pure helpers
// above without starting an HTTP listener.
if (import.meta.main) {
  Deno.serve((req) => handler(req))
}
