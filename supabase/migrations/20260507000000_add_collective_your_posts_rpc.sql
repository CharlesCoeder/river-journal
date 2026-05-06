-- Migration: SECURITY DEFINER read RPC for the user's own Collective posts.
--
-- Powers the `useYourPosts()` hook (packages/app/state/collective/yourPosts.ts).
-- This RPC is the only client-accessible read path for `collective_posts`
-- restricted to `auth.uid()` — direct SELECTs are denied by the
-- `REVOKE ALL ON TABLE collective_posts FROM authenticated` posture
-- established in 20260506000000_create_collective_posts.sql.
--
-- Why an RPC and not a direct SELECT?
--   The 500-words gate doesn't apply to your own posts, but the SELECT
--   GRANT does — `REVOKE ALL ... GRANT INSERT` denies SELECT regardless of
--   any `user_id = auth.uid()` predicate. Adding a SELECT policy + GRANT
--   solely for own-posts would defeat the project's "all reads via DEFINER
--   RPCs" defense-in-depth posture. The RPC pattern preserves that invariant
--   AND lets us return joined reaction_count + descendant_count in one
--   round-trip (RTT economy for YourPostsScreen).
--
-- Hardening (mirrors 20260506000006_add_collective_read_rpcs.sql):
--   - LANGUAGE plpgsql, SECURITY DEFINER, SET search_path = public, pg_temp.
--   - auth.uid() IS NULL check raises SQLSTATE 42501.
--   - REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO authenticated.
--   - page_size clamp: floor 1, ceiling 50.

-- ============================================================================
-- collective_your_posts_page(cursor TIMESTAMPTZ, page_size INT)
-- ============================================================================
CREATE OR REPLACE FUNCTION collective_your_posts_page(
  cursor    TIMESTAMPTZ,
  page_size INT
)
RETURNS TABLE (
  id              UUID,
  user_id         UUID,
  parent_post_id  UUID,
  body            TEXT,
  created_at      TIMESTAMPTZ,
  is_removed      BOOLEAN,
  is_user_deleted BOOLEAN,
  user_deleted_at TIMESTAMPTZ,
  reaction_count  INT,
  descendant_count INT,
  tenure_tier     INT,
  mode            TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_size   INT;
  v_cursor TIMESTAMPTZ;
BEGIN
  -- Auth assertion: SECURITY DEFINER preserves the caller's auth.uid()
  -- because we are NOT using SET ROLE. Direct service-role calls (or any
  -- code path with NULL auth.uid()) would otherwise leak someone's posts.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- Server-side clamp on page_size: floor at 1 (zero-row pagination stall
  -- defense), ceiling at 50 (million-row request defense). Mirrors the
  -- feed/thread RPC clamp exactly.
  v_size := GREATEST(LEAST(COALESCE(page_size, 20), 50), 1);

  -- COALESCE so a NULL cursor selects the newest rows. The "+ 1 second"
  -- buffer matches the feed RPC; a strict `<` cursor with NOW() would
  -- exclude rows inserted in the same instant.
  v_cursor := COALESCE(cursor, NOW() + INTERVAL '1 second');

  -- Main query.
  --
  -- own_posts CTE: filter to caller's posts, exclude moderator-removed
  -- (is_removed = TRUE) but INCLUDE user-soft-deleted (is_user_deleted =
  -- TRUE) rows with the ORIGINAL body. The user is reading their OWN
  -- soft-deleted posts and may want to recover content; UI redaction with
  -- the "you deleted this on [date]" marker happens in YourPostsScreen
  -- (Story 3.14), NOT in the RPC. Consistent with collective_feed_page /
  -- collective_thread_page (both pass body through unmodified plus the
  -- is_user_deleted flag; clients render [deleted] based on the flag).
  --
  -- reaction_counts CTE: COUNT(*) over collective_reactions, ungrouped by
  -- kind. Anonymized reactions (user_id IS NULL) still count — by design.
  -- NOTE: collective_reactions has no `is_removed` column today (hard-
  -- delete via ON DELETE CASCADE from collective_posts). If a future
  -- migration adds soft-removal to reactions, this COUNT must be updated
  -- explicitly to filter on the new flag.
  --
  -- descendants CTE: recursive walk via parent_post_id. Crosses author
  -- boundaries on purpose ("how much engagement did my post receive"
  -- semantics). Safe because the RPC returns only the integer count, never
  -- descendant bodies/ids — no information leak.
  --
  -- Depth bound: Postgres does not permit LIMIT inside the recursive term,
  -- so we cap depth via `WHERE depth <= 99` instead. This prevents runaway
  -- recursion on pathological reply chains. Combined with the outer
  -- LEAST(..., 99) the UI affordance is unaffected:
  --   (a) YourPostsScreen pages at <= 50 rows;
  --   (b) descendant_count is a UI affordance count, not a precise number;
  --   (c) outer LEAST(..., 99) caps each row at 99, rendering "99+" in UI.
  RETURN QUERY
  WITH own_posts AS (
    SELECT
      cp.id,
      cp.user_id,
      cp.parent_post_id,
      cp.body,
      cp.created_at,
      cp.is_removed,
      cp.is_user_deleted,
      cp.user_deleted_at
    FROM collective_posts cp
    WHERE cp.user_id = auth.uid()
      AND cp.is_removed = FALSE
      AND cp.created_at < v_cursor
    ORDER BY cp.created_at DESC
    LIMIT v_size
  ),
  reaction_counts AS (
    SELECT cr.post_id, COUNT(*)::INT AS n
    FROM collective_reactions cr
    WHERE cr.post_id IN (SELECT op.id FROM own_posts op)
    GROUP BY cr.post_id
  ),
  descendants AS (
    WITH RECURSIVE walk(root_id, child_id, depth) AS (
      SELECT op.id, cp.id, 1
      FROM own_posts op
      JOIN collective_posts cp ON cp.parent_post_id = op.id
      WHERE cp.is_removed = FALSE
      UNION ALL
      SELECT w.root_id, cp.id, w.depth + 1
      FROM walk w
      JOIN collective_posts cp ON cp.parent_post_id = w.child_id
      WHERE cp.is_removed = FALSE
        AND w.depth < 99   -- depth-bounded recursion (see CTE comment above)
    )
    SELECT root_id, COUNT(*)::INT AS n FROM walk GROUP BY root_id
  )
  SELECT
    op.id,
    op.user_id,
    op.parent_post_id,
    op.body,
    op.created_at,
    op.is_removed,
    op.is_user_deleted,
    op.user_deleted_at,
    COALESCE(rc.n, 0)::INT AS reaction_count,
    LEAST(COALESCE(d.n, 0), 99)::INT AS descendant_count,
    -- tenure_tier always NULL in this story; reserved for the FR68
    -- follow-up that will populate it once `users.longest_streak_ever`
    -- and `users.preferences.tenure_display` ship. The pgTAP regression
    -- test asserts NULL here as a sentinel.
    NULL::INT AS tenure_tier,
    'full'::TEXT AS mode
  FROM own_posts op
  LEFT JOIN reaction_counts rc ON rc.post_id = op.id
  LEFT JOIN descendants d ON d.root_id = op.id
  ORDER BY op.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION collective_your_posts_page(TIMESTAMPTZ, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION collective_your_posts_page(TIMESTAMPTZ, INT) TO authenticated;

-- ============================================================================
-- Index supporting the WHERE user_id = ? AND is_removed = FALSE ORDER BY
-- created_at DESC predicate of collective_your_posts_page.
--
-- Without this, every YourPosts page-load scans collective_posts globally
-- by created_at and filters in-memory. With heavy users, p95 latency
-- degrades. This partial index is load-bearing.
--
-- IMPORTANT: if the WHERE clause of the RPC ever changes (e.g., adds
-- `is_user_deleted = FALSE`), the partial-index match must be updated in
-- lock-step or this index becomes useless.
-- ============================================================================
CREATE INDEX IF NOT EXISTS collective_posts_user_id_created_at_idx
  ON collective_posts (user_id, created_at DESC)
  WHERE is_removed = FALSE;
