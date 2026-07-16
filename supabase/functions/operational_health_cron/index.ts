// operational_health_cron — the recurring operational-health sampler.
//
// Invoked on a 30-minute pg_cron schedule (via a best-effort pg_net dispatch
// wrapper carrying the service-role bearer), and also manually over HTTP for
// testing. It reads NO meaningful request body — every count comes from a
// pair of aggregate SECURITY DEFINER RPCs — so a service-role `curl -d '{}'`
// runs a full pass. It is trigger/cron-context: gated by a service-role bearer
// (verify_jwt = false), DB access via the RLS-bypassing service-role client
// (the aggregate RPCs read across every user's rows).
//
// SECURITY POSTURE. Reachable at its public URL with only the bearer check as a
// wall, so the SUCCESS response is a minimal `ok()` with NO queue/count data —
// echoing counts would make the function an enumeration oracle for anyone
// holding the bearer.
//
// TWO PASSES.
//   1. Moderation (every tick): the operational_health_moderation_queue RPC
//      resolves the pending-flag count + the oldest pending flag's age in
//      seconds (COALESCE-zeroed on an empty queue), emitted as
//      moderation_queue_depth_sample so the operator dashboard sees the
//      queue-clear state rather than a gap.
//   2. Sync opt-in (once per operator-day): gated to the first 30-minute window
//      of the operator-local day, the operational_health_sync_opt_in RPC
//      resolves the opted-in vs. total account counts, emitted as
//      sync_opt_in_snapshot. Dashboard math is opted_in / total.
//
// FAIL-OPEN. A DB error on either pass, or a PostHog outage, must not crash the
// function or abort the other pass. emitServerEvent is already internally
// fail-open (never throws); each pass is additionally guarded so a moderation
// failure still lets the sync pass run (and vice versa), and the handler always
// returns a well-formed ok()/err() — never an unhandled throw.
//
// LOGGING. A single terse heartbeat via logInfo — which passes ran plus coarse
// run metadata (duration_ms). NO content, NO per-row data, NO user IDs; the
// aggregate counts ride exclusively on the emitted PostHog events.

import { createServiceRoleClient, requireServiceRole } from '../_shared/auth.ts'
import { logError, logInfo } from '../_shared/logging.ts'
import { err, ok } from '../_shared/responses.ts'
import { emitServerEvent, SERVER_DISTINCT_ID } from '../_shared/posthog.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

// The operator-local timezone the once-daily sync-opt-in gate is evaluated
// against. Read from the OPERATOR_TIMEZONE Edge Function secret; when unset
// (local dev / `deno test`) a documented IANA fallback is used so the gate is
// always well-defined and Intl-parseable.
const OPERATOR_TIMEZONE_FALLBACK = 'America/New_York'

// The sync-opt-in pass fires only in the first this-many minutes of the
// operator-local day — with a */30 cron this matches exactly one tick per day.
const DAILY_WINDOW_MINUTES = 30

interface ModerationRow {
  pending_count: number
  oldest_pending_age_seconds: number
}

interface SyncOptInRow {
  opted_in_count: number
  total_count: number
}

// Defensive env read: `deno test` may run without --allow-env, in which case
// Deno.env.get throws — treat that as "unset" and fall back. Mirrors
// posthog.ts's readEnv. A non-empty but invalid IANA zone (typo, garbage,
// whitespace) is validated by probing Intl.DateTimeFormat — the zone is
// rejected the same as if it were unset, and the documented default is used,
// so a bad secret degrades the gate rather than crashing the handler.
export function readOperatorTimezone(): string {
  try {
    const tz = Deno.env.get('OPERATOR_TIMEZONE')
    if (tz && tz.length > 0) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return tz
      } catch {
        // Invalid IANA zone — fall through to the documented default.
      }
    }
  } catch {
    // No --allow-env — fall through to the documented default.
  }
  return OPERATOR_TIMEZONE_FALLBACK
}

// Pure, side-effect-free gate: is `now`, interpreted in the IANA `timezone`,
// inside the first 30-minute window of its local day (local [00:00, 00:30))?
//
// Uses Intl.DateTimeFormat-based zoned math (re-derived per instant, never a
// cached/fixed UTC offset) so it stays correct across a DST transition —
// midnight in a zone is midnight whether that day is one hour longer or shorter.
export function isDailySnapshotWindow(now: Date, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  let hour = Number.NaN
  let minute = Number.NaN
  for (const part of parts) {
    if (part.type === 'hour') {
      hour = Number(part.value)
    } else if (part.type === 'minute') {
      minute = Number(part.value)
    }
  }

  return hour === 0 && minute < DAILY_WINDOW_MINUTES
}

function firstRow<T>(data: unknown): T | undefined {
  if (Array.isArray(data)) {
    return data[0] as T | undefined
  }
  if (data && typeof data === 'object') {
    return data as T
  }
  return undefined
}

// `clientOverride` exists so tests can inject a mocked Supabase client without a
// live database; `now` is the injectable clock the once-daily gate reads.
// Production callers (Deno.serve below) pass neither.
export async function handler(
  req: Request,
  clientOverride?: SupabaseClient,
  now: Date = new Date(),
): Promise<Response> {
  const started = Date.now()

  const denied = requireServiceRole(req)
  if (denied) {
    return denied
  }

  // The body is intentionally ignored — every count comes from the RPCs.
  // Read-and-discard so an empty/absent/non-JSON body is never a failure.
  try {
    await req.json()
  } catch {
    // No body / non-JSON body is fine.
  }

  let client: SupabaseClient
  try {
    client = clientOverride ?? createServiceRoleClient()
  } catch {
    logError('operational_health.client_init_error', {})
    return err('service misconfigured', { code: 'internal', status: 500 })
  }

  // ── Pass 1: moderation queue depth (every tick). ──────────────────────────
  // Guarded so a DB error or a thrown client never aborts the sync pass.
  try {
    const { data, error } = await client.rpc('operational_health_moderation_queue')
    if (error) {
      logError('operational_health.moderation_error', {})
    } else {
      const row = firstRow<ModerationRow>(data)
      if (row) {
        await emitServerEvent('moderation_queue_depth_sample', SERVER_DISTINCT_ID, {
          pending_count: row.pending_count,
          oldest_pending_age_seconds: row.oldest_pending_age_seconds,
        })
      }
    }
  } catch {
    logError('operational_health.moderation_error', {})
  }

  // ── Pass 2: sync opt-in snapshot (once per operator-day). ─────────────────
  // readOperatorTimezone() already validates the zone, but the gate check is
  // wrapped defensively too — a throw here is treated as "gate closed" so it
  // can never escape as an unhandled 500 (belt-and-braces with the fallback
  // above).
  let syncGateOpen: boolean
  try {
    syncGateOpen = isDailySnapshotWindow(now, readOperatorTimezone())
  } catch {
    syncGateOpen = false
  }
  let syncOptInEmitted = false
  if (syncGateOpen) {
    try {
      const { data, error } = await client.rpc('operational_health_sync_opt_in')
      if (error) {
        logError('operational_health.sync_opt_in_error', {})
      } else {
        const row = firstRow<SyncOptInRow>(data)
        if (row) {
          await emitServerEvent('sync_opt_in_snapshot', SERVER_DISTINCT_ID, {
            opted_in_count: row.opted_in_count,
            total_count: row.total_count,
          })
          syncOptInEmitted = true
        }
      }
    } catch {
      logError('operational_health.sync_opt_in_error', {})
    }
  }

  // Terse heartbeat — which passes ran + coarse metadata only. No counts, no
  // user IDs (those ride exclusively on the emitted PostHog events).
  logInfo('operational_health.run', {
    passes: syncGateOpen ? ['moderation', 'sync_opt_in'] : ['moderation'],
    sync_opt_in_emitted: syncOptInEmitted,
    duration_ms: Date.now() - started,
  })

  // Minimal success body — NO queue/count data (enumeration-oracle guard).
  return ok()
}

// Only bind the server when this module is the program entry point (the Edge
// Runtime runs it as main). Guarded so `deno test` can import the pure helpers
// above without starting an HTTP listener.
if (import.meta.main) {
  Deno.serve((req) => handler(req))
}
