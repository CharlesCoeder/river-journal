-- Migration: developer bypass for the Collective daily-500 gate
--
-- Context: the public `/collective` route shows a placeholder while the feed is
-- restyled; developers reach the real feed via the always-available
-- `/collective/dev` route (see apps/*/app/collective/dev*, and
-- packages/app/features/collective/isCollectiveDevEnabled.ts). But the feed is
-- server-authoritative: `collective_feed_page` and `is_eligible_to_post` both
-- gate on `daily_500_completed_today(auth.uid())`, so a developer who hasn't
-- written 500 words today still only sees PREVIEW data and cannot post — no
-- client flag can bypass that, because the server simply never sends the full
-- rows (and MUST NOT: leaking full bodies to sub-500 callers is the failure
-- mode guarded against in 20260506000006_add_collective_read_rpcs.sql).
--
-- This migration adds the bypass at the single authoritative chokepoint:
-- `daily_500_completed_today`. Both the feed RPC and the posting/RLS path chain
-- through it, so one short-circuit covers feed view + posting + INSERT RLS.
--
-- SAFETY: the bypass is an allowlist of explicit auth user UUIDs that is EMPTY
-- by default => exactly zero behavioural change in production until a real
-- dev account UUID is added here and the migration ships. The public is never
-- affected; only listed accounts skip the gate. The match requires a non-NULL
-- auth.uid(), so unauthenticated callers can never satisfy it.
-- ============================================================================

-- 1. The allowlist predicate. No table reads => IMMUTABLE. search_path pinned
--    to match the hardening of the surrounding security functions.
CREATE OR REPLACE FUNCTION collective_dev_bypass(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  -- Add developer auth user UUIDs to the array below to grant those accounts
  -- a Collective gate bypass on every environment (including prod). Example:
  --   ARRAY['11111111-1111-1111-1111-111111111111']::uuid[]
  -- Keep this list short and remove entries when no longer needed.
  SELECT uid IS NOT NULL AND uid = ANY (ARRAY[]::uuid[]);
$$;

REVOKE EXECUTE ON FUNCTION collective_dev_bypass(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION collective_dev_bypass(UUID) TO authenticated;

-- 2. Re-declare daily_500_completed_today with the bypass short-circuit at the
--    top. Body is otherwise IDENTICAL to the timezone-aware version in
--    20260507000002_add_user_timezone_and_tz_aware_predicate.sql — CREATE OR
--    REPLACE replaces wholesale, so the full body is reproduced here.
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
  -- Developer bypass: listed accounts are always treated as qualified.
  -- Empty allowlist by default => no-op in production.
  IF collective_dev_bypass(uid) THEN
    RETURN TRUE;
  END IF;

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
