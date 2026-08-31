-- Migration: operational_health_log — the local sink for the operational-health
-- sampler cron.
--
-- WHY. The operational_health_cron Edge Function samples two aggregates (the
-- moderation queue depth every tick, the cloud-sync opt-in counts once per
-- operator-day) via SECURITY DEFINER RPCs. Those samples previously left the
-- database for a third-party analytics sink; this table replaces that sink so
-- the aggregates stay in Postgres, queryable by the operator over the service
-- role, with no external subprocessor involved. The cron's success response
-- deliberately echoes no counts (enumeration-oracle guard), so this table is
-- the ONLY place the sampled values land.
--
-- SHAPE. One row per cron tick that produced at least one sample. The
-- moderation columns are filled every tick; the sync-opt-in columns are filled
-- only on the once-daily snapshot tick — each pair is NULL when its pass did
-- not run (or its RPC errored), so a NULL is "not sampled", never "zero"
-- (the RPCs COALESCE genuine zeros).
--
-- SERVICE-ROLE-INTERNAL ONLY. RLS is enabled with NO client-facing policies,
-- and anon/authenticated are stripped of every grant (the
-- moderation_notification_log posture). The only writer is the cron's
-- service-role client; the only reader is the operator via service-role SQL.

CREATE TABLE operational_health_log (
  id                         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Moderation pass (every tick): pending-flag count + oldest pending flag's
  -- age in whole seconds, verbatim from operational_health_moderation_queue.
  pending_count              INTEGER,
  oldest_pending_age_seconds INTEGER,
  -- Sync-opt-in pass (once per operator-day): accounts with synced content vs.
  -- total accounts, verbatim from operational_health_sync_opt_in.
  opted_in_count             INTEGER,
  total_count                INTEGER,
  captured_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS. There are deliberately NO policies — every client role is denied
-- at the RLS layer, and additionally at the GRANT layer below.
ALTER TABLE operational_health_log ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: strip Supabase's default CRUD grants so anon and
-- authenticated cannot read or write the samples even if RLS were ever toggled
-- off. The service role retains its grant (table owner / BYPASSRLS) and is the
-- only writer. Direct anon/authenticated access fails with
-- insufficient_privilege (42501).
REVOKE ALL ON TABLE operational_health_log FROM anon, authenticated;
