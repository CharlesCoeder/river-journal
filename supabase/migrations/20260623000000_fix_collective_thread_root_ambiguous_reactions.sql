-- Fix: collective_thread_root() raised 42702 "column reference \"reactions\" is
-- ambiguous" on every call, so the RPC never worked.
--
-- Root cause: the function's RETURNS TABLE declares an OUT column named
-- `reactions`, and the `reaction_tally` CTE also exposes a column named
-- `reactions`. In the final SELECT the scalar sub-select `(SELECT reactions FROM
-- reaction_tally)` is therefore ambiguous between the OUT parameter and the CTE
-- column, and PL/pgSQL refuses to resolve it.
--
-- Fix: qualify the reference with the CTE name — `reaction_tally.reactions`.
-- This is the only change from the definition in
-- 20260622000000_add_collective_post_titles.sql; everything else is reproduced
-- verbatim so this migration is a self-contained CREATE OR REPLACE.
--
-- Discovered while wiring useThreadRoot into the Collective thread view
-- (title-led UI port). Filed as a standalone data-layer fix, separate from the
-- UI work, because the thread view has no other source for the root post's full
-- body now that the feed RPC dropped `body`.

CREATE OR REPLACE FUNCTION collective_thread_root(post_id UUID)
RETURNS TABLE (
  id               UUID,
  user_id          UUID,
  parent_post_id   UUID,
  title            TEXT,
  body             TEXT,
  created_at       TIMESTAMPTZ,
  is_removed       BOOLEAN,
  is_user_deleted  BOOLEAN,
  user_deleted_at  TIMESTAMPTZ,
  descendant_count INT,
  reactions        JSONB,
  mode             TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  v_full := daily_500_completed_today(auth.uid());

  RETURN QUERY
  WITH RECURSIVE descendants AS (
    SELECT child.id AS desc_id
    FROM collective_posts child
    WHERE child.parent_post_id = collective_thread_root.post_id
      AND child.is_removed = FALSE
    UNION ALL
    SELECT deeper.id
    FROM descendants d
    JOIN collective_posts deeper ON deeper.parent_post_id = d.desc_id
    WHERE deeper.is_removed = FALSE
  ) CYCLE desc_id SET is_cycle USING path,
  desc_count AS (
    SELECT COUNT(*) AS dc FROM descendants WHERE NOT is_cycle
  ),
  reaction_tally AS (
    SELECT jsonb_object_agg(s.kind, s.n) AS reactions
    FROM (
      SELECT cr.kind, COUNT(*) AS n
      FROM collective_reactions cr
      WHERE cr.post_id = collective_thread_root.post_id
      GROUP BY cr.kind
    ) s
  )
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
    COALESCE((SELECT dc FROM desc_count), 0)::INT AS descendant_count,
    -- Qualify with the CTE name so it is unambiguous against the OUT column.
    COALESCE((SELECT reaction_tally.reactions FROM reaction_tally), '{}'::jsonb) AS reactions,
    (CASE WHEN v_full THEN 'full' ELSE 'preview' END)::TEXT AS mode
  FROM collective_posts cp
  -- AC 11: zero rows when the root is moderator-removed OR does not exist
  -- (client renders not-found/removed). Self-deleted / anonymized roots ARE
  -- returned (client renders the tombstone), consistent with feed/thread.
  WHERE cp.id = collective_thread_root.post_id
    AND cp.is_removed = FALSE;
END;
$$;

REVOKE EXECUTE ON FUNCTION collective_thread_root(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION collective_thread_root(UUID) TO authenticated;
