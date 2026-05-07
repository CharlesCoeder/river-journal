-- Story 3-10: Add descendant_count to collective_thread_page RPC (Pattern B).
--
-- Pattern B: descendant_count computed per-row via recursive CTE at query time.
-- Rationale: no schema migration needed; correctness is locally provable; perf
-- is acceptable at Collective's MVP scale (small social server, ~100 posts/thread).
-- Anti-cycle protection via Postgres 14+ CYCLE syntax.
--
-- Deferred-decision resolution logged in sprint-epic-3-deferred-decisions.md
-- under "Story 3-10 descendant_count source: Pattern B (recursive CTE)".

DROP FUNCTION IF EXISTS collective_thread_page(UUID, TIMESTAMPTZ, INT);

CREATE OR REPLACE FUNCTION collective_thread_page(
  post_id   UUID,
  cursor    TIMESTAMPTZ,
  page_size INT
)
RETURNS TABLE (
  id               UUID,
  user_id          UUID,
  parent_post_id   UUID,
  body             TEXT,
  created_at       TIMESTAMPTZ,
  is_removed       BOOLEAN,
  is_user_deleted  BOOLEAN,
  user_deleted_at  TIMESTAMPTZ,
  descendant_count INT,
  mode             TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full   BOOLEAN;
  v_size   INT;
  v_cursor TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  v_size := GREATEST(LEAST(COALESCE(page_size, 20), 50), 1);
  v_cursor := COALESCE(cursor, '-infinity'::TIMESTAMPTZ);

  -- Check if the current user has crossed the 500-word daily gate today
  -- (same logic as collective_feed_page: determines full vs. preview mode).
  SELECT daily_500_completed_today(auth.uid()) INTO v_full;

  IF v_full THEN
    -- Full mode: return direct children of the thread root with descendant_count.
    RETURN QUERY
    WITH RECURSIVE descendants AS (
      -- Base: direct children of each candidate row
      SELECT
        child.id        AS root_id,
        child.id        AS desc_id,
        child.parent_post_id AS desc_parent
      FROM collective_posts child
      WHERE child.parent_post_id = collective_thread_page.post_id
        AND child.is_removed = FALSE

      UNION ALL

      -- Recursive: walk deeper descendants
      SELECT
        d.root_id,
        deeper.id,
        deeper.parent_post_id
      FROM descendants d
      JOIN collective_posts deeper ON deeper.parent_post_id = d.desc_id
      WHERE deeper.is_removed = FALSE
    ) CYCLE desc_id SET is_cycle USING path,
    desc_counts AS (
      SELECT d.root_id, COUNT(*) AS dc
      FROM descendants d
      WHERE NOT d.is_cycle
      GROUP BY d.root_id
    )
    SELECT
      cp.id,
      cp.user_id,
      cp.parent_post_id,
      cp.body,
      cp.created_at,
      cp.is_removed,
      cp.is_user_deleted,
      cp.user_deleted_at,
      COALESCE(dc.dc, 0)::INT AS descendant_count,
      'full'::TEXT AS mode
    FROM collective_posts cp
    LEFT JOIN desc_counts dc ON dc.root_id = cp.id
    WHERE cp.parent_post_id = collective_thread_page.post_id
      AND cp.is_removed = FALSE
      AND cp.created_at > v_cursor
    ORDER BY cp.created_at ASC
    LIMIT v_size;
    RETURN;
  END IF;

  -- Preview mode: top 3 direct replies, no descendant_count needed (always 0 in preview).
  RETURN QUERY
  SELECT
    cp.id,
    cp.user_id,
    cp.parent_post_id,
    cp.body,
    cp.created_at,
    cp.is_removed,
    cp.is_user_deleted,
    cp.user_deleted_at,
    0::INT AS descendant_count,
    'preview'::TEXT AS mode
  FROM collective_posts cp
  WHERE cp.parent_post_id = collective_thread_page.post_id
    AND cp.is_removed = FALSE
  ORDER BY cp.created_at ASC
  LIMIT 3;
END;
$$;

REVOKE EXECUTE ON FUNCTION collective_thread_page(UUID, TIMESTAMPTZ, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION collective_thread_page(UUID, TIMESTAMPTZ, INT) TO authenticated;
