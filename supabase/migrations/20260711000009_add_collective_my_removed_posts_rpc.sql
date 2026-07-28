-- Migration: SECURITY DEFINER read RPC for the caller's OWN removed posts.
--
-- Powers the `useMyRemovedPosts()` hook (packages/app/state/collective/
-- moderationReceipts.ts) which feeds the in-app "your post was removed"
-- receipt. This is the ONLY client-accessible path for the affected user to
-- learn their post's removed_reason:
--   * moderation_actions is admin-only read (moderation_actions_select_admin),
--     so the audit table is unreadable to the affected user.
--   * collective_posts is REVOKE ALL FROM authenticated (no direct SELECT).
--   * collective_your_posts_page deliberately excludes is_removed rows and
--     never returns removed_reason/removed_at.
--
-- Privacy (NFR structural leak guard): the return shape carries NO body AND NO
-- title. The receipt never needs post content, and title is user-authored
-- content too. Reply-vs-top-level is derived client-side from parent_post_id,
-- so title is not needed and is deliberately excluded to minimize the content
-- surface pulled to the client.
--
-- Hardening (mirrors collective_your_posts_page, 20260507000000):
--   - LANGUAGE plpgsql, SECURITY DEFINER, SET search_path = public, pg_temp.
--   - auth.uid() IS NULL check raises SQLSTATE 42501.
--   - REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO authenticated.
--   - max_rows clamp: floor 1, ceiling 100, default 50.

CREATE OR REPLACE FUNCTION collective_my_removed_posts(
  max_rows INT DEFAULT 50
)
RETURNS TABLE (
  id             UUID,
  parent_post_id UUID,
  created_at     TIMESTAMPTZ,
  removed_reason TEXT,
  removed_at     TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows INT;
BEGIN
  -- Auth assertion: SECURITY DEFINER preserves the caller's auth.uid() because
  -- we are NOT using SET ROLE. Any code path with NULL auth.uid() (anon,
  -- service-role) would otherwise leak someone's removed posts.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- Server-side clamp: floor at 1 (empty-result stall defense), ceiling at 100
  -- (unbounded-request defense). Bounds the receipt-gate backlog so a large
  -- removed-posts history can't produce an unbounded dialog storm.
  v_rows := GREATEST(LEAST(COALESCE(max_rows, 50), 100), 1);

  RETURN QUERY
  SELECT
    cp.id,
    cp.parent_post_id,
    cp.created_at,
    cp.removed_reason,
    cp.removed_at
  FROM collective_posts cp
  WHERE cp.user_id = auth.uid()
    AND cp.is_removed = TRUE
  ORDER BY cp.removed_at DESC
  LIMIT v_rows;
END;
$$;

-- Belt-and-suspenders: strip the default EXECUTE grant from PUBLIC AND from
-- anon explicitly. Supabase's default privileges grant EXECUTE on new functions
-- directly to anon/authenticated (not only via PUBLIC), so REVOKE FROM PUBLIC
-- alone would leave anon able to call this self-serve RPC. Revoke from anon so
-- only authenticated callers reach it (the in-function auth.uid() guard is the
-- deeper defense).
REVOKE EXECUTE ON FUNCTION collective_my_removed_posts(INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION collective_my_removed_posts(INT) TO authenticated;
