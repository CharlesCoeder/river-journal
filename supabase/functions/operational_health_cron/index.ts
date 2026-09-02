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
//      seconds (COALESCE-zeroed on an empty queue), recorded in
//      operational_health_log so the operator sees the queue-clear state
//      rather than a gap. A backlog past either alert threshold additionally
//      fires a Sentry operational alert (captureServerAlert) — the server
//      reporting on its own queue, no user data involved.
//   2. Sync opt-in (once per operator-day): gated to the first 30-minute window
//      of the operator-local day, the operational_health_sync_opt_in RPC
//      resolves the opted-in vs. total account counts, recorded in the same
//      operational_health_log row. Operator math is opted_in / total.
//
// FAIL-OPEN. A DB error on either pass, or a Sentry outage, must not crash the
// function or abort the other pass. captureServerAlert is already internally
// fail-open (never throws); each pass is additionally guarded so a moderation
// failure still lets the sync pass run (and vice versa), and the handler always
// returns a well-formed ok()/err() — never an unhandled throw.
//
// LOGGING. A single terse heartbeat via logInfo — which passes ran plus coarse
// run metadata (duration_ms). NO content, NO per-row data, NO user IDs; the
// aggregate counts land exclusively in operational_health_log (service-role
// only) and, past a threshold, in the Sentry alert's aggregate extra.

import { createServiceRoleClient, requireServiceRole } from '../_shared/auth.ts'
import { logError, logInfo } from '../_shared/logging.ts'
import { err, ok } from '../_shared/responses.ts'
import { captureServerAlert } from '../_shared/sentry.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

// The operator-local timezone the once-daily sync-opt-in gate is evaluated
// against. Read from the OPERATOR_TIMEZONE Edge Function secret; when unset
// (local dev / `deno test`) a documented IANA fallback is used so the gate is
// always well-defined and Intl-parseable.
const OPERATOR_TIMEZONE_FALLBACK = 'America/New_York'

// The sync-opt-in pass fires only in the first this-many minutes of the
// operator-local day — with a */30 cron this matches exactly one tick per day.
const DAILY_WINDOW_MINUTES = 30

// Moderation-backlog alert thresholds: a queue deeper than this many pending
// flags, OR whose oldest pending flag is older than this many seconds, fires
// the Sentry operational alert. Sized to the intended moderation cadence
// (roughly daily review): 20 pending or a >24h-old flag means the queue is not
// being worked.
export const MODERATION_PENDING_ALERT_THRESHOLD = 20
export const MODERATION_OLDEST_AGE_ALERT_SECONDS = 24 * 60 * 60

interface ModerationRow {
  pending_count: number
  oldest_pending_age_seconds: number
}

interface SyncOptInRow {
  opted_in_count: number
  total_count: number
}

// Defensive env read: `deno test` may run without --allow-env, in which case
// Deno.env.get throws — treat that as "unset" and fall back. A non-empty but
// invalid IANA zone (typo, garbage, whitespace) is validated by probing
// Intl.DateTimeFormat — the zone is rejected the same as if it were unset, and
// the documented default is used, so a bad secret degrades the gate rather
// than crashing the handler.
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

  // The single operational_health_log row this tick accumulates: the
  // moderation pass fills its pair every tick, the sync pass its pair on the
  // daily tick. A pass whose RPC errors leaves its columns absent (NULL in
  // the table — "not sampled", never a fake zero).
  const sample: Record<string, number> = {}

  // ── Pass 1: moderation queue depth (every tick). ──────────────────────────
  // Guarded so a DB error or a thrown client never aborts the sync pass.
  try {
    const { data, error } = await client.rpc('operational_health_moderation_queue')
    if (error) {
      logError('operational_health.moderation_error', {})
    } else {
      const row = firstRow<ModerationRow>(data)
      if (row) {
        sample.pending_count = row.pending_count
        sample.oldest_pending_age_seconds = row.oldest_pending_age_seconds
        // Backlog alert: past either threshold, page the operator via Sentry.
        // Aggregate counts only — captureServerAlert is fail-open, so an
        // alert-path failure can never fail the tick.
        if (
          row.pending_count > MODERATION_PENDING_ALERT_THRESHOLD ||
          row.oldest_pending_age_seconds > MODERATION_OLDEST_AGE_ALERT_SECONDS
        ) {
          await captureServerAlert('moderation queue backlog', {
            pending_count: row.pending_count,
            oldest_pending_age_seconds: row.oldest_pending_age_seconds,
          })
        }
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
  let syncOptInSampled = false
  if (syncGateOpen) {
    try {
      const { data, error } = await client.rpc('operational_health_sync_opt_in')
      if (error) {
        logError('operational_health.sync_opt_in_error', {})
      } else {
        const row = firstRow<SyncOptInRow>(data)
        if (row) {
          sample.opted_in_count = row.opted_in_count
          sample.total_count = row.total_count
          syncOptInSampled = true
        }
      }
    } catch {
      logError('operational_health.sync_opt_in_error', {})
    }
  }

  // ── Sink: one operational_health_log row per tick that sampled anything. ──
  // Guarded so a write failure degrades to a logged error, never a non-ok
  // response (the samples are operator visibility, not primary work).
  if (Object.keys(sample).length > 0) {
    try {
      const { error } = await client.from('operational_health_log').insert(sample)
      if (error) {
        logError('operational_health.log_write_error', {})
      }
    } catch {
      logError('operational_health.log_write_error', {})
    }
  }

  // Terse heartbeat — which passes ran + coarse metadata only. No counts, no
  // user IDs (those live exclusively in the service-role-only log table).
  logInfo('operational_health.run', {
    passes: syncGateOpen ? ['moderation', 'sync_opt_in'] : ['moderation'],
    sync_opt_in_sampled: syncOptInSampled,
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
