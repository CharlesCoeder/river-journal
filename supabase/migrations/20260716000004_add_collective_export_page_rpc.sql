-- Migration: SECURITY DEFINER read RPC for a full data-portability export of
-- the calling user's OWN Collective posts.
--
-- Powers the client-side Collective export (packages/app/state/collective/
-- exportPosts.ts → packages/app/utils/exportCollectivePosts.ts). Like
-- collective_your_posts_page (20260507000000, title added 20260622000000)
-- this is the ONLY client-accessible read path for collective_posts scoped to
-- auth.uid() — direct SELECTs are denied by the
-- `REVOKE ALL ON TABLE collective_posts FROM authenticated` posture from
-- 20260506000000_create_collective_posts.sql.
--
-- Why a NEW RPC and not collective_your_posts_page?
--   The export is a data-rights surface: it must return the user's ENTIRE own
--   history, including:
--     * moderator-removed rows (is_removed = TRUE) WITH their original body +
--       title — collective_your_posts_page filters these out
--       (AND cp.is_removed = FALSE), and collective_my_removed_posts withholds
--       body/title (a receipt/notification leak-guard). Neither can serve the
--       owner their own removed content, which this export must.
--     * user-self-deleted rows (is_user_deleted = TRUE) — already surfaced by
--       collective_your_posts_page (only is_removed is filtered there); their
--       body is already the DB '[deleted]' sentinel written by delete_my_post.
--   This function drops the is_removed filter and additionally returns
--   removed_reason / removed_at so the export can render a moderation marker.
--
-- Why not add a SELECT policy to collective_posts?
--   collective_posts is deliberately RLS-enabled with NO SELECT policy and
--   `REVOKE ALL … GRANT INSERT` (see 20260506000000 / 20260506000004: "DO NOT
--   add a SELECT policy"). Every own-post read flows through a DEFINER RPC so
--   the server-side preview-vs-full posting gate can't be bypassed. This RPC
--   preserves that invariant.
--
-- Hardening (reproduced verbatim from collective_your_posts_page):
--   - LANGUAGE plpgsql, SECURITY DEFINER, SET search_path = public, pg_temp.
--   - auth.uid() IS NULL check raises SQLSTATE 42501.
--   - REVOKE EXECUTE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated.
--   - page_size clamp: floor 1, ceiling 50.
--
-- Strictly additive: a new function + one supporting index. No existing table,
-- policy, trigger, or RPC is altered.

-- ============================================================================
-- collective_export_page(cursor TIMESTAMPTZ, cursor_id UUID, page_size INT)
-- ============================================================================
-- Keyset pagination uses the COMPOSITE key (created_at, id), not created_at
-- alone. created_at ties are realistic here (a transaction-stable NOW() default
-- and a client-settable created_at), and a strict `created_at < cursor` would
-- silently DROP any rows that share the boundary row's timestamp but fall past
-- the page limit — unacceptable data loss in a data-portability export. The
-- (created_at, id) tuple is unique (id is the PK), so it is a total order with
-- no ties: every row is returned exactly once across pages.
CREATE OR REPLACE FUNCTION collective_export_page(
  cursor    TIMESTAMPTZ,
  cursor_id UUID DEFAULT NULL,
  page_size INT DEFAULT 20
)
RETURNS TABLE (
  id              UUID,
  user_id         UUID,
  parent_post_id  UUID,
  title           TEXT,
  body            TEXT,
  created_at      TIMESTAMPTZ,
  is_removed      BOOLEAN,
  is_user_deleted BOOLEAN,
  user_deleted_at TIMESTAMPTZ,
  removed_reason  TEXT,
  removed_at      TIMESTAMPTZ,
  reaction_count  INT,
  descendant_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_size      INT;
  v_cursor    TIMESTAMPTZ;
  v_cursor_id UUID;
BEGIN
  -- Auth assertion: SECURITY DEFINER preserves the caller's auth.uid()
  -- because we are NOT using SET ROLE. A NULL auth.uid() (service-role or
  -- unauthenticated) would otherwise leak someone's posts.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- page_size clamp: floor 1 (pagination-stall defense), ceiling 50
  -- (unbounded-request defense). Mirrors collective_your_posts_page exactly.
  v_size := GREATEST(LEAST(COALESCE(page_size, 20), 50), 1);

  -- Initial (NULL) cursor: start above EVERY possible row so the whole history
  -- is covered. `'infinity'::timestamptz` is a true upper bound — it also
  -- correctly INCLUDES any future-dated posts (a client-settable created_at
  -- ahead of NOW()), which the old `NOW() + INTERVAL '1 second'` upper bound
  -- would have silently skipped. The companion cursor_id defaults to the maximum
  -- UUID so the composite `(created_at, id) < (v_cursor, v_cursor_id)` predicate
  -- admits the very first page's rows.
  v_cursor    := COALESCE(cursor, 'infinity'::timestamptz);
  v_cursor_id := COALESCE(cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);

  RETURN QUERY
  WITH own_posts AS (
    -- Caller's own posts, keyset-paginated. NOTE the deliberate difference
    -- from collective_your_posts_page: there is NO `AND cp.is_removed = FALSE`
    -- filter here — moderator-removed rows ARE returned (with their original
    -- body + title) because this is the owner exporting their own data.
    -- Self-deleted rows (is_user_deleted = TRUE) are returned as-is; their
    -- body is already the '[deleted]' sentinel written server-side by
    -- delete_my_post.
    SELECT
      cp.id,
      cp.user_id,
      cp.parent_post_id,
      cp.title,
      cp.body,
      cp.created_at,
      cp.is_removed,
      cp.is_user_deleted,
      cp.user_deleted_at,
      cp.removed_reason,
      cp.removed_at
    FROM collective_posts cp
    WHERE cp.user_id = auth.uid()
      AND (cp.created_at, cp.id) < (v_cursor, v_cursor_id)
    ORDER BY cp.created_at DESC, cp.id DESC
    LIMIT v_size
  ),
  reaction_counts AS (
    -- Uncapped COUNT(*) over collective_reactions. Anonymized reactions
    -- (user_id IS NULL, from a deleted reactor) still count — by design.
    SELECT cr.post_id, COUNT(*)::INT AS n
    FROM collective_reactions cr
    WHERE cr.post_id IN (SELECT op.id FROM own_posts op)
    GROUP BY cr.post_id
  ),
  descendants AS (
    -- Recursive reply-count walk (crosses author boundaries: "engagement my
    -- post received"). The depth bound (< 99) guards against runaway
    -- recursion on pathological chains, but — UNLIKE the UI RPC — there is NO
    -- outer LEAST(…, 99) cap on the returned count: an export is not latency-
    -- sensitive and should reflect the true reply count. Only non-removed
    -- replies are counted (a removed reply is not visible engagement).
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
        AND w.depth < 99
    )
    SELECT root_id, COUNT(*)::INT AS n FROM walk GROUP BY root_id
  )
  SELECT
    op.id,
    op.user_id,
    op.parent_post_id,
    op.title,
    op.body,
    op.created_at,
    op.is_removed,
    op.is_user_deleted,
    op.user_deleted_at,
    op.removed_reason,
    op.removed_at,
    COALESCE(rc.n, 0)::INT AS reaction_count,
    -- Exact (uncapped) reply count — see the descendants CTE comment.
    COALESCE(d.n, 0)::INT AS descendant_count
  FROM own_posts op
  LEFT JOIN reaction_counts rc ON rc.post_id = op.id
  LEFT JOIN descendants d ON d.root_id = op.id
  ORDER BY op.created_at DESC, op.id DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION collective_export_page(TIMESTAMPTZ, UUID, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION collective_export_page(TIMESTAMPTZ, UUID, INT) FROM anon;
GRANT  EXECUTE ON FUNCTION collective_export_page(TIMESTAMPTZ, UUID, INT) TO authenticated;

-- ============================================================================
-- Index supporting the WHERE user_id = ? AND (created_at, id) < (?, ?)
-- ORDER BY created_at DESC, id DESC composite-keyset predicate of
-- collective_export_page.
--
-- The existing collective_posts_user_id_created_at_idx (20260507000000) is a
-- PARTIAL index `WHERE is_removed = FALSE`, so it does NOT cover this RPC —
-- the export deliberately reads removed rows too. This full (non-partial)
-- index carries id as the trailing key so it covers the composite keyset over
-- the caller's ENTIRE history without a sort.
-- ============================================================================
CREATE INDEX IF NOT EXISTS collective_posts_user_id_created_at_all_idx
  ON collective_posts (user_id, created_at DESC, id DESC);
