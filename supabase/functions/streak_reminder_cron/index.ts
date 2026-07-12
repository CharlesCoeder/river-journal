// streak_reminder_cron — the daily streak-reminder fan-out.
//
// Invoked on a 15-minute pg_cron schedule (via a best-effort pg_net dispatch
// wrapper carrying the service-role bearer), and also manually over HTTP for
// testing. It reads NO meaningful request body — the whole due-user set comes
// from the streak_reminder_candidates RPC — so a service-role `curl -d '{}'`
// runs a full pass. It is trigger/cron-context: gated by a service-role bearer
// (verify_jwt = false), DB access via the RLS-bypassing service-role client
// (required to read every user's preferences + tokens).
//
// SECURITY POSTURE. Reachable at its public URL with only the bearer check as a
// wall, so the SUCCESS response is a minimal `ok()` with NO candidate data —
// echoing counts/ids would make the function an enumeration oracle for anyone
// holding the bearer.
//
// AT-MOST-ONCE. For each due user WITH >=1 live token the function claims a
// streak_reminder_log row (INSERT ... ON CONFLICT DO NOTHING) BEFORE sending; a
// zero-row claim means "already reminded today" and the user is skipped. A
// zero-token candidate is skipped WITHOUT claiming (so a device registered an
// hour later is still reminderable today). The claim is never rolled back on an
// Expo failure — a dropped nudge is the accepted trade against a double-notify.

import { createServiceRoleClient, requireServiceRole } from '../_shared/auth.ts'
import { logError, logInfo } from '../_shared/logging.ts'
import { err, ok } from '../_shared/responses.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

// Expo's hosted push endpoint. Expo owns APNs/FCM delivery — this codebase
// never talks to Apple/Google directly. No access token is required at this
// tier for the hosted endpoint; do not add one.
const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send'

// Expo accepts at most 100 messages per POST.
const EXPO_CHUNK_SIZE = 100

// The window the candidate RPC matches against, pinned explicitly (a cheap
// validation optimization — the RPC's own default is also 15).
const WINDOW_MINUTES = 15

export interface ExpoMessage {
  to: string
  title: string
  body: string
  data: { type: 'streak_reminder' }
}

interface CandidateRow {
  user_id: string
  reminder_streak_len: number
  local_send_date: string
}

interface TokenRow {
  user_id: string
  expo_push_token: string
}

// Copy calibrated to streak length. Exact strings are placeholders pending a
// tone review — the streak-length signal is grace-EXCLUDED, so it can read
// lower than the streak the app shows the user; whether the gentle tier ever
// embeds a precise "Day N" is deferred to that review.
// TODO(tone): copy pending review
export function composeStreakCopy(streakLen: number): { title: string; body: string } {
  if (streakLen >= 3) {
    return { title: 'River', body: 'A few quiet minutes keeps your streak going.' }
  }
  return { title: 'River', body: 'Want to write today?' }
}

// Split an array into chunks of at most `size`, preserving order.
export function chunkExpoMessages<T>(messages: T[], size = EXPO_CHUNK_SIZE): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < messages.length; i += size) {
    chunks.push(messages.slice(i, i + size))
  }
  return chunks
}

// Map an Expo ticket response back to the tokens Expo reports as
// DeviceNotRegistered, for soft-deletion. Positional mapping is performed ONLY
// when `response` is an object whose `data` is an array of EXACTLY
// orderedTokens.length — Expo returns a request-level `{ errors: [...] }` shape
// (no `data`) on a rejected batch, and a short/shifted array mapped by position
// would soft-delete healthy, still-valid tokens. Any shape mismatch prunes
// NOTHING. A non-DeviceNotRegistered error ticket is never flagged.
export function parseExpoTickets(response: unknown, orderedTokens: string[]): string[] {
  if (response === null || typeof response !== 'object') {
    return []
  }
  const data = (response as { data?: unknown }).data
  if (!Array.isArray(data) || data.length !== orderedTokens.length) {
    return []
  }
  const flagged: string[] = []
  for (let i = 0; i < data.length; i++) {
    const ticket = data[i]
    const token = orderedTokens[i]
    if (token === undefined) {
      continue
    }
    if (
      ticket !== null &&
      typeof ticket === 'object' &&
      (ticket as { status?: unknown }).status === 'error' &&
      ((ticket as { details?: { error?: unknown } }).details?.error) === 'DeviceNotRegistered'
    ) {
      flagged.push(token)
    }
  }
  return flagged
}

// `clientOverride` exists so tests can inject a mocked Supabase client without a
// live database. Production callers (Deno.serve below) never pass it.
export async function handler(req: Request, clientOverride?: SupabaseClient): Promise<Response> {
  const started = Date.now()

  const denied = requireServiceRole(req)
  if (denied) {
    return denied
  }

  // The body is intentionally ignored — the candidate set comes from the RPC.
  // Read-and-discard so an empty/absent body is never a failure.
  try {
    await req.json()
  } catch {
    // No body / non-JSON body is fine.
  }

  let client: SupabaseClient
  try {
    client = clientOverride ?? createServiceRoleClient()
  } catch {
    logError('streak.reminder.client_init_error', {})
    return err('service misconfigured', { code: 'internal', status: 500 })
  }

  const { data: candidateData, error: candidateError } = await client.rpc(
    'streak_reminder_candidates',
    { window_minutes: WINDOW_MINUTES },
  )
  if (candidateError) {
    logError('streak.reminder.candidate_error', {})
    return err('candidate lookup failed', { code: 'internal', status: 500 })
  }

  const candidates = (candidateData ?? []) as CandidateRow[]
  if (candidates.length === 0) {
    logInfo('streak.reminder.run', {
      window_minutes: WINDOW_MINUTES,
      candidate_count: 0,
      token_count: 0,
      claimed_count: 0,
      sent_count: 0,
      device_not_registered_count: 0,
      chunk_failure_count: 0,
      duration_ms: Date.now() - started,
    })
    return ok()
  }

  const candidateIds = candidates.map((c) => c.user_id)

  const { data: tokenData, error: tokenError } = await client
    .from('user_push_tokens')
    .select('user_id, expo_push_token')
    .eq('is_deleted', false)
    .in('user_id', candidateIds)
  if (tokenError) {
    logError('streak.reminder.token_lookup_error', {})
    return err('token lookup failed', { code: 'internal', status: 500 })
  }

  const tokens = (tokenData ?? []) as TokenRow[]

  // Group live tokens by user (tokens FIRST — a zero-token candidate is never
  // claimed).
  const tokensByUser = new Map<string, string[]>()
  for (const row of tokens) {
    const list = tokensByUser.get(row.user_id) ?? []
    list.push(row.expo_push_token)
    tokensByUser.set(row.user_id, list)
  }

  // Claim-before-send: build the send buffer only from users whose ledger claim
  // inserted a row this local day.
  const messages: ExpoMessage[] = []
  let claimedCount = 0
  for (const candidate of candidates) {
    const userTokens = tokensByUser.get(candidate.user_id)
    if (!userTokens || userTokens.length === 0) {
      continue
    }

    const { data: claimed, error: claimError } = await client
      .from('streak_reminder_log')
      .upsert(
        { user_id: candidate.user_id, local_send_date: candidate.local_send_date },
        { onConflict: 'user_id,local_send_date', ignoreDuplicates: true },
      )
      .select('user_id')
    if (claimError) {
      logError('streak.reminder.claim_error', {})
      continue
    }
    if (!claimed || claimed.length === 0) {
      // Already reminded today — idempotent skip.
      continue
    }

    claimedCount++
    const copy = composeStreakCopy(candidate.reminder_streak_len)
    for (const token of userTokens) {
      messages.push({
        to: token,
        title: copy.title,
        body: copy.body,
        data: { type: 'streak_reminder' },
      })
    }
  }

  // Fan out in chunks. A per-chunk failure (network error, non-2xx, non-JSON,
  // or a data array whose length != the chunk) is log-counted and prunes
  // NOTHING; it never aborts the remaining chunks.
  let sentCount = 0
  let deviceNotRegisteredCount = 0
  let chunkFailureCount = 0
  const chunks = chunkExpoMessages(messages)
  for (const chunk of chunks) {
    const orderedTokens = chunk.map((m) => m.to)
    let response: Response
    try {
      response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(chunk),
      })
    } catch {
      chunkFailureCount++
      continue
    }

    if (!response.ok) {
      chunkFailureCount++
      continue
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      chunkFailureCount++
      continue
    }

    const data = (body as { data?: unknown })?.data
    if (!Array.isArray(data) || data.length !== orderedTokens.length) {
      // Malformed / length-mismatched / { errors } body — prune nothing.
      chunkFailureCount++
      continue
    }

    sentCount += orderedTokens.length
    const flagged = parseExpoTickets(body, orderedTokens)
    for (const token of flagged) {
      deviceNotRegisteredCount++
      const { error: pruneError } = await client
        .from('user_push_tokens')
        .update({ is_deleted: true })
        .eq('expo_push_token', token)
      if (pruneError) {
        logError('streak.reminder.prune_error', {})
      }
    }
  }

  logInfo('streak.reminder.run', {
    window_minutes: WINDOW_MINUTES,
    candidate_count: candidates.length,
    token_count: tokens.length,
    claimed_count: claimedCount,
    sent_count: sentCount,
    device_not_registered_count: deviceNotRegisteredCount,
    chunk_failure_count: chunkFailureCount,
    duration_ms: Date.now() - started,
  })

  // Minimal success body — NO candidate data (enumeration-oracle guard).
  return ok()
}

// Only bind the server when this module is the program entry point (the Edge
// Runtime runs it as main). Guarded so `deno test` can import the pure helpers
// above without starting an HTTP listener.
if (import.meta.main) {
  Deno.serve((req) => handler(req))
}
