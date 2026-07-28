-- Migration: server-side substrate for the daily streak-reminder fan-out.
--
-- Adds four objects the reminder cron builds on:
--   1. streak_reminder_log       — the at-most-once send ledger (dedupe key).
--   2. streak_reminder_length    — a grace-EXCLUDED consecutive-day count used
--      ONLY to select notification copy tone (it is NOT the user-facing streak,
--      which is grace-inclusive and computed client-side).
--   3. streak_reminder_candidates — one row per user due a reminder this window.
--   4. streak_reminder_cron_dispatch — a best-effort pg_net wrapper the pg_cron
--      schedule calls every 15 minutes to invoke the Edge Function.
--
-- The candidate window match honors the offset contract the client already
-- ships (last_local_offset_minutes = minutes east of UTC, refreshed on
-- time-change / app-open). Converting the stored local send-time to a UTC
-- minute-of-day REQUIRES the double-mod form
--   mod(mod((localMinutes - offset)::int, 1440) + 1440, 1440)
-- because Postgres mod() inherits the dividend's sign: a bare
-- mod((localMinutes - offset), 1440) returns a NEGATIVE target for every user
-- whose offset exceeds localMinutes (essentially all UTC+ zones near their
-- local morning/afternoon), which never satisfies the window predicate and
-- would silently, permanently exclude those users.

-- ============================================================================
-- 1. The at-most-once send ledger.
-- ============================================================================
--
-- One row per (user, local send date). The cron CLAIMS a row before sending
-- (INSERT ... ON CONFLICT DO NOTHING); a zero-row claim means "already reminded
-- today" and the user is skipped. The claim is never rolled back on a delivery
-- failure — the guarantee is deliberately at-most-once (a dropped nudge is the
-- accepted trade against a double-notify under cron overlap / manual re-invoke).
--
-- SERVICE-ROLE-INTERNAL ONLY. RLS is enabled with NO client-facing policies and
-- anon/authenticated are stripped of every grant. The only reader/writer is the
-- service role (via the Edge Function), which bypasses RLS.
CREATE TABLE streak_reminder_log (
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_send_date DATE        NOT NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, local_send_date)
);

ALTER TABLE streak_reminder_log ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: strip Supabase's default CRUD grants so anon and
-- authenticated cannot read or write the ledger even if RLS were ever toggled
-- off. The service role retains its grant (BYPASSRLS) and is the only writer.
-- Direct anon/authenticated access fails with insufficient_privilege (42501).
REVOKE ALL ON TABLE streak_reminder_log FROM anon, authenticated;

-- ============================================================================
-- 2. Streak-length copy-tone signal (grace-EXCLUDED).
-- ============================================================================
--
-- Count of consecutive qualifying days ending YESTERDAY in the user's timezone,
-- each having SUM(word_count) >= 500 over non-deleted flows/entries, bounded to
-- a 60-day lookback. Grace days are deliberately NOT consulted: this signal
-- only selects copy tone (light vs. gentle), it is NOT the authoritative
-- user-facing streak. "Yesterday" is the correct anchor because this cron only
-- fires for users who have NOT completed today, so today is not yet a
-- qualifying day for them.
--
-- Timezone handling mirrors daily_500_completed_today: derive the user's local
-- "today" from users.timezone, fall back to UTC on an invalid zone.
CREATE OR REPLACE FUNCTION streak_reminder_length(uid UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timezone    TEXT;
  v_today_local DATE;
  v_check_date  DATE;
  v_total       INTEGER;
  v_count       INTEGER := 0;
  v_i           INTEGER;
BEGIN
  SELECT COALESCE(timezone, 'UTC') INTO v_timezone FROM users WHERE id = uid;
  IF v_timezone IS NULL THEN
    v_timezone := 'UTC';
  END IF;

  BEGIN
    v_today_local := (NOW() AT TIME ZONE v_timezone)::date;
  EXCEPTION
    WHEN invalid_parameter_value THEN
      v_today_local := (NOW() AT TIME ZONE 'UTC')::date;
  END;

  -- Walk back from yesterday; stop at the first non-qualifying day. Bounded to
  -- a 60-day lookback so the loop is O(1) regardless of history depth.
  FOR v_i IN 1..60 LOOP
    v_check_date := v_today_local - v_i;

    SELECT COALESCE(SUM(f.word_count), 0)
    INTO v_total
    FROM flows f
    JOIN daily_entries de ON de.id = f.daily_entry_id
    WHERE de.user_id = uid
      AND de.entry_date = v_check_date
      AND f.is_deleted = FALSE
      AND de.is_deleted = FALSE;

    IF v_total >= 500 THEN
      v_count := v_count + 1;
    ELSE
      EXIT;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION streak_reminder_length(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION streak_reminder_length(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION streak_reminder_length(UUID) TO service_role;

-- ============================================================================
-- 3. Candidate selection.
-- ============================================================================
--
-- One row per user due a reminder this window. A user is due when ALL hold:
--   * reminders.streak.enabled is the JSON literal true (strict gate — a
--     missing/false flag excludes the user);
--   * the user's current local wall-clock falls in the window_minutes window
--     starting at their configured local send-time (default '20:00' when
--     unset), matched via the double-mod offset contract described above;
--   * daily_500_completed_today(user_id) is FALSE.
--
-- The offset is last_local_offset_minutes when present, else derived at query
-- time from the always-present users.timezone column (so a user who enabled via
-- the settings toggle without opening the time picker still fires correctly).
-- The tz-derived path is inherently DST-correct; the stored-offset path can be
-- one hour stale across a DST transition until the client's next app-open
-- refresh (an accepted, self-healing limitation).
--
-- The row also carries local_send_date — the user's current local date, always
-- derived from users.timezone (never the possibly-stale stored offset) — so the
-- caller has a DST-correct dedupe key for the send ledger without a second
-- per-user query.
CREATE OR REPLACE FUNCTION streak_reminder_candidates(window_minutes INTEGER DEFAULT 15)
RETURNS TABLE(user_id UUID, reminder_streak_len INTEGER, local_send_date DATE)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_utc_now_minute INTEGER;
BEGIN
  v_utc_now_minute := (
    EXTRACT(HOUR FROM NOW() AT TIME ZONE 'UTC') * 60
    + EXTRACT(MINUTE FROM NOW() AT TIME ZONE 'UTC')
  )::int;

  RETURN QUERY
  WITH candidate AS (
    SELECT
      u.id AS uid,
      COALESCE(u.timezone, 'UTC') AS tz,
      -- localMinutes from local_time; default 20:00 (1200) when unset/empty.
      CASE
        WHEN COALESCE(u.preferences #>> '{reminders,streak,local_time}', '') = ''
          THEN 1200
        ELSE (
          split_part(u.preferences #>> '{reminders,streak,local_time}', ':', 1)::int * 60
          + split_part(u.preferences #>> '{reminders,streak,local_time}', ':', 2)::int
        )
      END AS local_minutes,
      -- offset (minutes east of UTC): the stored value when present, else
      -- derived from users.timezone at query time.
      CASE
        WHEN (u.preferences #>> '{reminders,streak,last_local_offset_minutes}') IS NOT NULL
          THEN (u.preferences #>> '{reminders,streak,last_local_offset_minutes}')::int
        ELSE (
          EXTRACT(
            EPOCH FROM (NOW() AT TIME ZONE COALESCE(u.timezone, 'UTC')) - (NOW() AT TIME ZONE 'UTC')
          ) / 60
        )::int
      END AS offset_minutes
    FROM users u
    WHERE u.preferences #>> '{reminders,streak,enabled}' = 'true'
  )
  SELECT c.uid, streak_reminder_length(c.uid), (NOW() AT TIME ZONE c.tz)::date
  FROM candidate c
  WHERE mod(
          v_utc_now_minute
          - mod(mod((c.local_minutes - c.offset_minutes)::int, 1440) + 1440, 1440)
          + 1440,
          1440
        ) < window_minutes
    AND daily_500_completed_today(c.uid) = FALSE;
END;
$$;

REVOKE EXECUTE ON FUNCTION streak_reminder_candidates(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION streak_reminder_candidates(INTEGER) FROM authenticated;
GRANT  EXECUTE ON FUNCTION streak_reminder_candidates(INTEGER) TO service_role;

-- ============================================================================
-- 4. pg_cron dispatch wrapper.
-- ============================================================================
--
-- Best-effort pg_net call to the streak_reminder_cron Edge Function. Resolves
-- the base URL + service-role key from Vault (preferred) then a database-GUC
-- fallback, both set per-environment as a manual ops step (see
-- docs/edge-functions-setup.md). The call is SKIPPED unless BOTH resolve to a
-- non-NULL, non-empty value, and never raises (pg_net is fire-and-forget). This
-- mirrors notify_moderation_action_trigger()'s secret-resolution + guards.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION streak_reminder_cron_dispatch()
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

  v_url := rtrim(v_base_url, '/') || '/functions/v1/streak_reminder_cron';

  -- Best-effort: pg_net enqueues and returns immediately. The function reads no
  -- meaningful body (the whole candidate set comes from the RPC), so an empty
  -- {} is sent. Any error is swallowed.
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
    RAISE LOG 'streak_reminder_cron_dispatch: net.http_post failed (best-effort, swallowed): %', SQLERRM;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION streak_reminder_cron_dispatch() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION streak_reminder_cron_dispatch() FROM authenticated;
GRANT  EXECUTE ON FUNCTION streak_reminder_cron_dispatch() TO service_role;

-- ============================================================================
-- 5. Schedule the dispatch every 15 minutes.
-- ============================================================================
-- pg_cron is available on hosted Supabase but not in local dev; skip gracefully
-- so the migration applies cleanly in both places.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'streak-reminder-cron',
      '*/15 * * * *',
      'SELECT streak_reminder_cron_dispatch()'
    );
  END IF;
END
$$;
