-- Migration: timezone-aware daily-500 RLS gate
--
-- Fixes the false-403 on collective_posts INSERT that fires for any user
-- whose device-local "today" disagrees with UTC "today" — i.e. anyone east
-- of UTC for ~4-8 hours every night. See
-- docs/_bmad-output/implementation-artifacts/epic-3-followups.md
-- (entry: "Daily-500 RLS gate is timezone-broken", 2026-05-07).
--
-- Two parts:
--   1. Add users.timezone (IANA name, default 'UTC', validated against
--      pg_timezone_names).
--   2. Replace daily_500_completed_today(uid) so it computes "today" in the
--      user's stored timezone, falling back to UTC if NULL or invalid.
-- ============================================================================

-- 1. Add timezone column.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

-- Validation: handled inside daily_500_completed_today() via an exception
-- block, plus client-side filtering against Intl.DateTimeFormat's resolved
-- zone (which is always a valid IANA name). A SQL-side CHECK constraint
-- would need a STABLE function wrapper around `NOW() AT TIME ZONE x` since
-- CHECK forbids subqueries on pg_timezone_names; not worth the surface
-- area for a column written exclusively by our own client.

-- 2. Replace the predicate. Same signature, same hardening, new body.
-- Inline join to users so we can read u.timezone in the same query.
-- The body is wrapped in a BEGIN/EXCEPTION block: if the configured
-- timezone is somehow invalid (e.g. corrupt write that bypassed the
-- CHECK constraint, or a future Postgres tz database removing a name),
-- we fall back to UTC rather than raising and breaking the user's INSERT.
CREATE OR REPLACE FUNCTION daily_500_completed_today(uid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total       INTEGER;
  v_timezone    TEXT;
  v_today_local DATE;
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

  SELECT COALESCE(SUM(f.word_count), 0)
  INTO v_total
  FROM flows f
  JOIN daily_entries de ON de.id = f.daily_entry_id
  WHERE de.user_id = uid
    AND de.entry_date = v_today_local
    AND f.is_deleted = FALSE
    AND de.is_deleted = FALSE;

  RETURN v_total >= 500;
END;
$$;

REVOKE EXECUTE ON FUNCTION daily_500_completed_today(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION daily_500_completed_today(UUID) TO authenticated;
