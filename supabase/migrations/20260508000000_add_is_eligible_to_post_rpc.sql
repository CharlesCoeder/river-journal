-- Migration: is_eligible_to_post() RPC.
--
-- Tiny SECURITY DEFINER wrapper that returns whether the calling user has
-- written 500 words today (per their stored timezone — see
-- 20260507000002_add_user_timezone_and_tz_aware_predicate.sql).
--
-- WHY a dedicated RPC: the iteration-1 spec used `feed.data.pages[0].mode`
-- as the eligibility signal, but `state/collective/feed.ts` coerces empty
-- arrays to `mode: 'full'` for display purposes. That conflation silently
-- granted `eligible` to qualified-or-not users whenever the DB was empty.
-- This RPC decouples the eligibility question from feed contents: it answers
-- the user's permission state directly.
--
-- WHY suspension is NOT folded in: the client already owns suspension
-- precedence via `useIsSuspended` and the gate's suspended-branch render.
-- Folding it here would duplicate the check and create drift if the
-- suspension shape evolves.
-- ============================================================================

CREATE OR REPLACE FUNCTION is_eligible_to_post()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT daily_500_completed_today(auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION is_eligible_to_post() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION is_eligible_to_post() TO authenticated;
