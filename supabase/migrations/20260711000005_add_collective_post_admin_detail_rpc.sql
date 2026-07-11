-- Migration: Admin-only SECURITY DEFINER single-post detail read RPC.
--
-- Powers the audit trail's tap-through (web + desktop admin): given a
-- target_post_id recorded on a moderation_actions row, return that post's
-- CURRENT state — title/body plus removed- and self-deleted-state — so the
-- operator can see what a past action actually referred to.
--
-- WHY AN RPC AND NOT A DIRECT / EMBEDDED SELECT — READ THIS BEFORE EDITING.
--   `collective_posts` has RLS enabled with NO SELECT policy and
--   `REVOKE ALL ON TABLE collective_posts FROM authenticated` (only INSERT is
--   granted) — see 20260506000000_create_collective_posts.sql ("DO NOT add a
--   SELECT policy"). The admin `is_admin` claim grants SELECT on
--   `collective_reports` and `moderation_actions`, but grants NOTHING on
--   `collective_posts`. So any PostgREST `.from('collective_posts').select()`
--   or embedded join returns null — PostgREST honors the table's RLS. The
--   tap-through MUST flow through a DEFINER RPC that reads `collective_posts`
--   as the table owner (postgres), exactly like `collective_moderation_queue`.
--   Adding a SELECT policy/GRANT to `collective_posts` is FORBIDDEN: it would
--   defeat the server-side preview-vs-full 500-word gate.
--
-- WHY NOT REUSE `collective_moderation_queue` FOR THE TAP-THROUGH.
--   The queue RPC only returns posts that still have a PENDING report. An
--   audit row routinely references a post whose reports are already resolved
--   (e.g. a post that was removed, or whose author self-deleted). Such a post
--   is invisible to the queue but must remain reachable here — hence a
--   dedicated single-post read keyed on the post id, not on report status.
--
-- Hardening (mirrors 20260711000004_add_collective_moderation_queue_rpc.sql):
--   - LANGUAGE plpgsql, SECURITY DEFINER, SET search_path = public, pg_temp.
--   - Admin re-check at the top raises SQLSTATE 42501 — defense-in-depth
--     BENEATH the client route gate (which is UX-only). `auth.uid()` /
--     `auth.jwt()` read the CALLER's request GUCs even inside a DEFINER
--     function, so the claim check reflects who invoked the RPC.
--   - REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO authenticated (safe because
--     the function self-checks is_admin).
--
-- RETURNS at most one row (LIMIT 1, keyed on cp.id = target_post_id); a
-- nonexistent target_post_id yields zero rows and NO exception. The full body
-- is returned to the admin even for is_removed / is_user_deleted posts — this
-- is consistent admin power (the queue RPC already returns full bodies); the
-- UI layer is where tombstoning/strikethrough happens, not the server.

-- ============================================================================
-- collective_post_admin_detail(target_post_id UUID)
-- ============================================================================
CREATE OR REPLACE FUNCTION collective_post_admin_detail(
  target_post_id UUID
)
RETURNS TABLE (
  post_id          UUID,
  author_user_id   UUID,
  title            TEXT,
  body             TEXT,
  created_at       TIMESTAMPTZ,
  is_removed       BOOLEAN,
  removed_at       TIMESTAMPTZ,
  removed_reason   TEXT,
  is_user_deleted  BOOLEAN,
  user_deleted_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Admin guard (defense-in-depth beneath the client route gate). A missing
  -- claim (NULL), a non-admin, and an unauthenticated caller all deny.
  IF auth.uid() IS NULL OR (auth.jwt() ->> 'is_admin')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    cp.id              AS post_id,
    cp.user_id         AS author_user_id,
    cp.title           AS title,
    cp.body            AS body,
    cp.created_at      AS created_at,
    cp.is_removed      AS is_removed,
    cp.removed_at      AS removed_at,
    cp.removed_reason  AS removed_reason,
    cp.is_user_deleted AS is_user_deleted,
    cp.user_deleted_at AS user_deleted_at
  FROM collective_posts cp
  WHERE cp.id = target_post_id
  LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION collective_post_admin_detail(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION collective_post_admin_detail(UUID) TO authenticated;
