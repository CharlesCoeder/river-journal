-- Migration: unread_replies_for_user(since) — the client-callable count RPC
-- backing the web/desktop in-app reminder card's unread-Collective-replies
-- signal.
--
-- Unlike the trigger-internal notify_* helpers (service-role-only), THIS
-- function is GRANTed to `authenticated` and invoked directly from the client
-- (supabase.rpc('unread_replies_for_user', { since })). It is the only
-- Collective count the card cannot compute locally: collective_posts is
-- RLS-walled and the client has no safe index of "all replies to my posts
-- across every thread", so a SECURITY DEFINER count is required. Called once
-- per app open (staleTime Infinity on the client), never polled.
--
-- SCOPING (enumeration-oracle guard). The count is resolved against
-- auth.uid() — NOT a caller-supplied user_id — so a caller can only ever read
-- their OWN unread count. Passing another user's id is impossible; the
-- function ignores any argument but `since`. A NULL auth.uid() returns 0
-- (never an error), so a token-less caller holding the grant is harmless.
--
-- PRIVILEGE CHAIN (SECURITY DEFINER nesting — load-bearing). This function
-- transitively calls two helpers with different grant postures:
--   - thread_root_user_id(UUID) is genuinely service-role-only (its migration
--     REVOKEs EXECUTE from PUBLIC, authenticated). An `authenticated` caller
--     has NO direct grant. Reaching it works ONLY because inside a SECURITY
--     DEFINER body the nested EXECUTE check runs as the function OWNER, not the
--     invoking role — so this migration MUST be owned by the same role that
--     owns thread_root_user_id (the default when applied by the DB owner; do
--     not create it under a different owner).
--   - private.is_blocked_either_way(a, b) IS granted directly to
--     `authenticated`; it is unreachable as an RPC only because the `private`
--     schema is not in PostgREST's exposed-schema list, so it does not depend
--     on the owner-chain bypass.
-- A break in the owner chain surfaces as 42501 for real users but is invisible
-- to a postgres/service-role test caller — so the pgTAP suite exercises one
-- end-to-end call under a real authenticated JWT, not merely a GRANT assertion.
--
-- UNBOUNDED `since` (accepted amplification bound). `since` is caller-controlled
-- and left UNCLAMPED: a direct API client can pass epoch to force the recursive
-- root-author walk over the whole reply history. This is accepted because the
-- count is auth.uid()-scoped (a caller only ever burns their OWN count, no
-- cross-user oracle) and honest clients call once per open. The predicate is
-- ordered so the cheap indexed filters + the single-lookup immediate-parent
-- author check run BEFORE the recursive thread_root_user_id(...) — the CASE
-- reaches the root-author walk ONLY for replies the immediate-parent check did
-- not already satisfy.

CREATE OR REPLACE FUNCTION unread_replies_for_user(since TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_me    UUID := auth.uid();
  v_count INT;
BEGIN
  -- Defensive: a caller with no resolvable identity gets 0, never an error.
  IF v_me IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::INT
  INTO v_count
  FROM collective_posts r
  WHERE r.parent_post_id IS NOT NULL          -- replies only
    AND r.is_removed = FALSE                   -- not soft-removed
    AND r.user_id IS NOT NULL                  -- not an anonymized author
    AND r.user_id <> v_me                      -- not the caller's own reply
    AND r.created_at > since                    -- strictly newer than the bound
    AND NOT private.is_blocked_either_way(v_me, r.user_id)  -- symmetric block filter
    -- Eligibility: the caller authored the reply's IMMEDIATE parent (a single
    -- indexed lookup) OR the caller authored the THREAD ROOT (the recursive
    -- upward walk). The CASE guarantees the root-author walk runs ONLY when the
    -- cheap immediate-parent check did not already match (the unbounded-`since`
    -- amplification guard).
    AND CASE
          WHEN (
            SELECT p.user_id
            FROM collective_posts p
            WHERE p.id = r.parent_post_id
          ) = v_me THEN TRUE
          ELSE thread_root_user_id(r.parent_post_id) = v_me
        END;

  RETURN COALESCE(v_count, 0);
END;
$$;

-- Client-callable (unlike the trigger-internal helpers): stripped from PUBLIC /
-- anon, granted to authenticated only.
REVOKE EXECUTE ON FUNCTION unread_replies_for_user(TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION unread_replies_for_user(TIMESTAMPTZ) TO authenticated;
