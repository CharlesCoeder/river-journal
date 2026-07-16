-- Migration: server-side substrate for the operational-health sampler cron.
--
-- Adds three objects the operational_health_cron Edge Function builds on:
--   1. operational_health_moderation_queue — the moderation-queue-depth
--      aggregate (pending-flag count + oldest pending flag's age in seconds),
--      the recurring operator-visibility signal (NFR35).
--   2. operational_health_sync_opt_in — the once-daily cloud-sync opt-in
--      aggregate (accounts with synced journal content vs. total accounts),
--      the "Sync Opt-in %" success-metric numerator/denominator (NFR33).
--   3. operational_health_cron_dispatch — a best-effort pg_net wrapper the
--      pg_cron schedule calls every 30 minutes to invoke the Edge Function.
--
-- Both aggregates are single-round-trip SECURITY DEFINER RPCs rather than
-- client-side query-builder calls: the moderation aggregate needs a FILTER'd
-- COUNT + a COALESCE'd age that PostgREST cannot express, and the sync-opt-in
-- aggregate needs COUNT(DISTINCT user_id) — which the query builder has no
-- primitive for, and which a raw row-fetch-and-dedupe would silently
-- under-count once non-deleted daily_entries exceed the PostgREST max_rows cap.

-- ============================================================================
-- 1. Moderation queue-depth aggregate.
-- ============================================================================
--
-- One row: the count of pending flags and the age (in whole seconds) of the
-- oldest pending flag. COALESCE(..., 0) makes the empty/all-non-pending case
-- report {0, 0} rather than NULL, so the operator dashboard sees the
-- queue-clear state as a real zero sample rather than a gap.
--
-- SERVICE-ROLE-INTERNAL ONLY. SECURITY DEFINER + service_role-only grant so the
-- cron's service-role client can read the aggregate across every user's reports
-- while anon/authenticated remain unable to invoke it.
CREATE OR REPLACE FUNCTION operational_health_moderation_queue()
RETURNS TABLE(pending_count INTEGER, oldest_pending_age_seconds INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending')::int,
    COALESCE(
      EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'pending'))),
      0
    )::int
  FROM collective_reports;
$$;

REVOKE EXECUTE ON FUNCTION operational_health_moderation_queue() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION operational_health_moderation_queue() FROM authenticated;
GRANT  EXECUTE ON FUNCTION operational_health_moderation_queue() TO service_role;

-- ============================================================================
-- 2. Cloud-sync opt-in aggregate.
-- ============================================================================
--
-- Cloud sync is a device-local client flag with no server-side preference key,
-- so "sync enabled" is observed by proxy: an account has sync ON iff it has
-- pushed at least one non-deleted journal entry to the server. A signed-in but
-- never-synced account (the Collective 'sync' access-gate state) has none.
--   * total_count   = every account the server can see (COUNT(*) FROM users).
--   * opted_in_count = distinct accounts with >= 1 non-deleted daily_entries
--                      row (COUNT(DISTINCT user_id)).
-- Anonymous local-only installs have no users row, so they are excluded from
-- BOTH counts by construction: the metric is "sync opt-in among account
-- holders", not "among all installs".
--
-- COUNT(DISTINCT ...) has no PostgREST query-builder equivalent, and a
-- row-fetch-and-dedupe would silently truncate past the PostgREST max_rows cap
-- — hence this single-round-trip SECURITY DEFINER RPC.
CREATE OR REPLACE FUNCTION operational_health_sync_opt_in()
RETURNS TABLE(opted_in_count INTEGER, total_count INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT COUNT(DISTINCT user_id) FROM daily_entries WHERE is_deleted = false)::int,
    (SELECT COUNT(*) FROM users)::int;
$$;

REVOKE EXECUTE ON FUNCTION operational_health_sync_opt_in() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION operational_health_sync_opt_in() FROM authenticated;
GRANT  EXECUTE ON FUNCTION operational_health_sync_opt_in() TO service_role;

-- ============================================================================
-- 3. pg_cron dispatch wrapper.
-- ============================================================================
--
-- Best-effort pg_net call to the operational_health_cron Edge Function.
-- Resolves the base URL + service-role key from Vault (preferred) then a
-- database-GUC fallback, both set per-environment as a manual ops step (see
-- docs/edge-functions-setup.md). The call is SKIPPED unless BOTH resolve to a
-- non-NULL, non-empty value, and never raises (pg_net is fire-and-forget). This
-- mirrors streak_reminder_cron_dispatch()'s secret-resolution + guards.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION operational_health_cron_dispatch()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_base_url TEXT;
  v_key      TEXT;
  v_url      TEXT;
BEGIN
  -- Guard 1: pg_net must be installed. Absent => skip cleanly.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN;
  END IF;

  -- Resolve the base URL. Vault first (the key never sits in pg_settings), GUC
  -- fallback. The Vault lookup is wrapped so an absent vault schema/table
  -- yields NULL rather than erroring.
  BEGIN
    SELECT decrypted_secret INTO v_base_url
    FROM vault.decrypted_secrets
    WHERE name = 'edge_base_url'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_base_url := NULL;
  END;
  IF v_base_url IS NULL OR v_base_url = '' THEN
    v_base_url := current_setting('app.settings.edge_base_url', true);
  END IF;

  -- Resolve the service-role key, same precedence.
  BEGIN
    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;
  IF v_key IS NULL OR v_key = '' THEN
    v_key := current_setting('app.settings.service_role_key', true);
  END IF;

  -- Guard 2: BOTH must be present + non-empty, so a half-configured env never
  -- fires an unauthenticated request the function would reject 401.
  IF v_base_url IS NULL OR v_base_url = '' OR v_key IS NULL OR v_key = '' THEN
    RETURN;
  END IF;

  v_url := rtrim(v_base_url, '/') || '/functions/v1/operational_health_cron';

  -- Best-effort: pg_net enqueues and returns immediately. The function reads no
  -- meaningful body (every count comes from the RPCs), so an empty {} is sent.
  -- Any error is swallowed.
  BEGIN
    PERFORM net.http_post(
      url     := v_url,
      body    := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'operational_health_cron_dispatch: net.http_post failed (best-effort, swallowed): %', SQLERRM;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION operational_health_cron_dispatch() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION operational_health_cron_dispatch() FROM authenticated;
GRANT  EXECUTE ON FUNCTION operational_health_cron_dispatch() TO service_role;

-- ============================================================================
-- 4. Schedule the dispatch every 30 minutes.
-- ============================================================================
-- pg_cron is available on hosted Supabase but not in local dev; skip gracefully
-- so the migration applies cleanly in both places.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'operational-health-cron',
      '*/30 * * * *',
      'SELECT operational_health_cron_dispatch()'
    );
  END IF;
END
$$;
