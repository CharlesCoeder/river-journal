-- Migration: RLS predicate functions for the Collective surface.
--
-- Both predicates are SECURITY DEFINER + STABLE, with `SET search_path =
-- public, pg_temp` pinned (mandatory hardening: unpinned search_path on
-- DEFINER functions is the canonical Postgres privilege-escalation vector).
--
-- Owner role: postgres (the canonical non-superuser owner used by the
-- existing auth RPC migration 20260221000003 — `user_has_password()` is
-- also owned by postgres).

-- ============================================================================
-- daily_500_completed_today(uid UUID) RETURNS BOOLEAN
-- ============================================================================
-- Server-authoritative gate: returns TRUE iff the user has summed >= 500
-- words across today's flows.
--
-- UTC-day-boundary caveat (server-authoritative model):
--   The v1 client computes `getTodayJournalDayString()` in the device's local
--   timezone. This server-side predicate uses NOW() AT TIME ZONE 'UTC'.
--   Cross-timezone behavior is intentional: a user in PST who completes 500
--   at 10pm local on May 5 will see the server compute their day as May 6.
--   Display stays consistent because the client dispatches off the RPC
--   `mode` field, NOT off local day-string. If product later wants
--   device-local-day gating, this function gets a `tz_offset` parameter.
--
-- STABLE (not IMMUTABLE) because NOW() makes it time-varying within a
-- transaction. STABLE is re-evaluated per statement, not per row, so RLS
-- predicate evaluation is amortized.
CREATE OR REPLACE FUNCTION daily_500_completed_today(uid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total INTEGER;
BEGIN
  -- COALESCE handles the zero-row case (SUM of zero rows is NULL).
  SELECT COALESCE(SUM(f.word_count), 0)
  INTO v_total
  FROM flows f
  JOIN daily_entries de ON de.id = f.daily_entry_id
  WHERE de.user_id = uid
    AND de.entry_date = (NOW() AT TIME ZONE 'UTC')::date
    AND f.is_deleted = FALSE
    AND de.is_deleted = FALSE;

  RETURN v_total >= 500;
END;
$$;

REVOKE EXECUTE ON FUNCTION daily_500_completed_today(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION daily_500_completed_today(UUID) TO authenticated;

-- ============================================================================
-- is_active_suspension(uid UUID, kind_param TEXT) RETURNS BOOLEAN
-- ============================================================================
-- Returns TRUE iff the user has an active suspension of the given kind.
--
-- The user_suspensions table arrives in a later moderation milestone and
-- does NOT yet exist. The body is wrapped to return FALSE if the table is
-- absent — the EXCEPTION WHEN undefined_table clause makes this function
-- compile and run cleanly today. A later migration will DROP+CREATE the
-- function with the same signature and remove the exception clause.
--
-- Parameter is `kind_param` (not `kind`) to avoid shadowing the column
-- name in the EXISTS query.
CREATE OR REPLACE FUNCTION is_active_suspension(uid UUID, kind_param TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_suspensions
    WHERE user_id = uid
      AND kind = kind_param
      AND ends_at > NOW()
  );
EXCEPTION
  WHEN undefined_table THEN
    -- Pre-Epic-5.1: the table does not exist yet. Treat as "not suspended".
    RETURN FALSE;
END;
$$;

REVOKE EXECUTE ON FUNCTION is_active_suspension(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION is_active_suspension(UUID, TEXT) TO authenticated;
