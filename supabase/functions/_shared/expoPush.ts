// Shared Expo push fan-out — extracted from streak_reminder_cron so every
// push-sending function reuses one copy of the chunking + response-shape guard
// + DeviceNotRegistered soft-delete logic (the shape guard is a real
// device-silencing footgun if mis-mapped, so it must live in ONE tested place).
//
// Expo owns APNs/FCM delivery — this codebase never talks to Apple/Google
// directly. No access token is required at this tier for the hosted endpoint;
// do not add one.

import type { SupabaseClient } from '@supabase/supabase-js'
import { logError } from './logging.ts'

// Expo's hosted push endpoint. This value MUST equal streak_reminder_cron's
// pre-extraction constant verbatim — the extraction is a zero-behavior-change
// refactor, so a changed endpoint would be a smuggled production behavior
// change.
export const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send'

// Expo accepts at most 100 messages per POST.
const EXPO_CHUNK_SIZE = 100

// A generic push message. `data` is the caller-specific deep-link payload
// (e.g. { type: 'streak_reminder' } or { type: 'collective_reply', ... }).
export interface ExpoMessage<TData = Record<string, unknown>> {
  to: string
  title: string
  body: string
  data: TData
}

export interface FanOutResult {
  sentCount: number
  deviceNotRegisteredCount: number
  errorTicketCount: number
  chunkFailureCount: number
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

// Fan out `messages` to Expo in chunks of <=100. Each chunk is POSTed to
// EXPO_PUSH_ENDPOINT; on a 2xx JSON body whose `data` is an array of exactly
// the chunk length, each ticket is inspected: `status === 'ok'` counts toward
// `sentCount`, anything else (DeviceNotRegistered, MessageRateExceeded,
// MessageTooBig, ...) counts toward `errorTicketCount` so an error-heavy batch
// is never misreported as fully sent. DeviceNotRegistered tickets additionally
// soft-delete their positional token (user_push_tokens.is_deleted = true, via
// the injected service-role client) — best-effort: a THROWN rejection from
// that update (as opposed to a normally-resolved `{ error }`) is caught and
// logged rather than left to escape mid-loop, so one bad prune never skips the
// remaining flagged tokens or aborts the run. On a per-chunk network error,
// non-2xx, non-JSON, `data`-absent, or length-mismatched body, the chunk is
// counted as a failure and prunes NOTHING — and the loop continues to the
// remaining chunks (a per-chunk failure never aborts the whole run).
export async function fanOutExpoPush<TData>(
  client: SupabaseClient,
  messages: ExpoMessage<TData>[],
): Promise<FanOutResult> {
  let sentCount = 0
  let deviceNotRegisteredCount = 0
  let errorTicketCount = 0
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

    // Count tickets by actual status -- NOT the whole chunk length. Adding the
    // full chunk length here (the pre-fix behavior) reported a fully-rejected
    // batch (MessageRateExceeded, MessageTooBig, DeviceNotRegistered, ...) as
    // entirely "sent", masking real delivery failure in the run log.
    for (const ticket of data) {
      if (
        ticket !== null && typeof ticket === 'object' &&
        (ticket as { status?: unknown }).status === 'ok'
      ) {
        sentCount++
      } else {
        errorTicketCount++
      }
    }

    const flagged = parseExpoTickets(body, orderedTokens)
    for (const token of flagged) {
      deviceNotRegisteredCount++
      // Best-effort prune; a normally-resolved { error } is intentionally
      // ignored (a failed soft-delete is retried on the next
      // DeviceNotRegistered report). A THROWN rejection must be caught too --
      // left unguarded, it would escape this loop, skip every remaining
      // flagged token AND every remaining chunk, and propagate out of
      // fanOutExpoPush as a bare, unenveloped exception after a partial send.
      try {
        await client
          .from('user_push_tokens')
          .update({ is_deleted: true })
          .eq('expo_push_token', token)
      } catch {
        logError('expo_push.prune_error', {})
      }
    }
  }

  return { sentCount, deviceNotRegisteredCount, errorTicketCount, chunkFailureCount }
}
