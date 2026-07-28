-- Migration: symmetric block predicate is_blocked_either_way(uid_a, uid_b).
--
-- SILENT-BLOCK INVARIANT — READ THIS BEFORE EDITING.
-- Blocking is symmetric and silent: neither party can detect the block from
-- any surface. SECURITY DEFINER is load-bearing for that guarantee. The
-- predicate must see a block in BOTH directions — including a row where the
-- caller is the blocked_user_id, which user_blocks' one-sided SELECT RLS hides
-- from the caller's own reads. A SECURITY INVOKER function would only see the
-- caller's own blocker-rows, miss the reverse direction, break symmetry, AND
-- let the blocked user infer their status. Running as the table owner sees
-- both directions while the table's own RLS keeps the blocked party's direct
-- reads empty — symmetric AND silent.
--
-- NON-EXPOSED SCHEMA (deliberate, and new to this repo). PostgREST exposes
-- every function in an API schema (config.toml: schemas = ["public",
-- "graphql_public"]) that is granted to `authenticated` as a callable
-- POST /rest/v1/rpc/<name> endpoint. A block predicate reachable that way
-- would be a who-blocked-me / did-I-block-them oracle a signed-in user could
-- loop over the whole userbase — defeating the silent-block guarantee
-- outright. So both
-- DEFINER helpers (this predicate and collective_post_author in the next
-- migration) live in a dedicated `private` schema that PostgREST never
-- surfaces. `authenticated` gets USAGE on the schema + EXECUTE on the
-- function (the RLS policies that call it run as the caller and genuinely
-- need EXECUTE), but the function is unreachable as an RPC. `anon` gets
-- neither. Downstream stories inherit this convention: server-only DEFINER
-- helpers that must not be client-callable belong in `private`.
--
-- LANGUAGE sql is acceptable here (unlike the plpgsql suspension predicate)
-- because a sql function validates its body at CREATE time — user_blocks must
-- already exist. Migration ...010 (the table) strictly precedes this one, so
-- that ordering requirement is satisfied; do not reorder.

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

-- EXISTS collapses NULL comparisons to FALSE, so a NULL argument (the
-- tombstoned-author case) resolves to FALSE, never NULL — a reply to a
-- since-deleted author is not spuriously denied, and own content is never
-- hidden because is_blocked_either_way(uid, uid) has no matching row.
CREATE OR REPLACE FUNCTION private.is_blocked_either_way(uid_a UUID, uid_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_blocks
    WHERE (blocker_user_id = uid_a AND blocked_user_id = uid_b)
       OR (blocker_user_id = uid_b AND blocked_user_id = uid_a)
  );
$$;

-- Grantable to `authenticated` only (the RLS INSERT/SELECT policies evaluate
-- this predicate as the calling role), never to `anon`. Mirrors the
-- is_active_suspension / daily_500_completed_today REVOKE/GRANT posture.
REVOKE EXECUTE ON FUNCTION private.is_blocked_either_way(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION private.is_blocked_either_way(UUID, UUID) TO authenticated;
