-- Migration: close the preview-mode full-body leak in the Collective thread RPCs.
--
-- SECURITY FIX (data exposure). The Collective surface gates full post content
-- behind the daily-500-words requirement, enforced SERVER-SIDE. The invariant,
-- documented in 20260506000006_add_collective_read_rpcs.sql and reaffirmed in
-- 20260618000000_add_collective_dev_bypass.sql, is that a sub-500 ("preview")
-- caller MUST NOT receive full post bodies — the server simply never sends them.
-- Client-side blur is cosmetic only; withholding is authoritative.
--
-- Two later migrations regressed this for the thread view:
--
--   1. collective_thread_root (introduced in 20260622000000, re-declared in
--      20260623000000): the final SELECT returns `cp.body` UNCONDITIONALLY.
--      `mode` is only a text label, so a preview caller received the root
--      post's FULL body.
--
--   2. collective_thread_page (re-declared in 20260622000000): the PREVIEW
--      branch returns `cp.body` for the first three replies — again the FULL
--      body of each.
--
-- Both rationalised "body is returned in BOTH modes; the client renders locked
-- affordances based on `mode`" — which is exactly the server-authoritative
-- contract this migration restores.
--
-- FIX: in preview mode, replace the full body with the SAME server-truncated
-- excerpt the feed already emits for these posts (first sentence-end OR first
-- 140 chars, whichever is shorter — the heuristic from
-- 20260506000006:132-138 / 20260622000000:239-245). This:
--   * withholds the full body from sub-500 callers (the contract), while
--   * leaking nothing the preview FEED does not already expose for the same
--     post (strict feed/thread parity — no NEW information), and
--   * keeps `body` a non-NULL TEXT string, matching the generated client type
--     (Database…Returns.body: string) so ungated clients never see NULL and
--     do not break. `collective_posts.body` is NOT NULL, so the excerpt is
--     always a non-NULL string.
--
-- FULL mode is unchanged (full body). Every other behaviour of both functions
-- (auth guard, page_size clamp, cursor handling, recursive descendant_count,
-- reaction tally, title, removed/self-deleted row semantics, REVOKE/GRANT,
-- SECURITY DEFINER + pinned search_path) is reproduced verbatim from the latest
-- shipped definitions (thread_root: 20260623000000; thread_page: 20260622000000).
-- The RETURNS TABLE shape is unchanged, so a plain CREATE OR REPLACE suffices.

-- ============================================================================
-- collective_thread_root(post_id) — reproduced from 20260623000000, with the
-- body column made mode-aware (full → cp.body; preview → truncated excerpt).
-- ============================================================================
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
    -- SECURITY: full body only in full mode. In preview, emit the same
    -- server-truncated excerpt the feed already exposes for this post —
    -- the full body is never sent to a sub-500 caller.
    (CASE
       WHEN v_full THEN cp.body
       ELSE (
         CASE
           WHEN substring(cp.body FROM '^[^.!?]*[.!?](?:\s|$)') IS NOT NULL
            AND length(substring(cp.body FROM '^[^.!?]*[.!?](?:\s|$)'))
                <= LEAST(length(cp.body), 140)
           THEN substring(cp.body FROM '^[^.!?]*[.!?](?:\s|$)')
           ELSE substring(cp.body FROM 1 FOR 140)
         END
       )
     END) AS body,
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

-- ============================================================================
-- collective_thread_page(post_id, cursor, page_size) — reproduced from
-- 20260622000000, with the PREVIEW branch body replaced by the truncated
-- excerpt. The FULL branch is unchanged (full body).
-- ============================================================================
CREATE OR REPLACE FUNCTION collective_thread_page(
  post_id   UUID,
  cursor    TIMESTAMPTZ,
  page_size INT
)
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

  SELECT daily_500_completed_today(auth.uid()) INTO v_full;

  IF v_full THEN
    RETURN QUERY
    WITH RECURSIVE descendants AS (
      SELECT
        child.id        AS root_id,
        child.id        AS desc_id,
        child.parent_post_id AS desc_parent
      FROM collective_posts child
      WHERE child.parent_post_id = collective_thread_page.post_id
        AND child.is_removed = FALSE

      UNION ALL

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
      cp.title,
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

  -- Preview mode: top 3 direct replies, descendant_count always 0.
  -- SECURITY: the full reply body is withheld from sub-500 callers — emit the
  -- same server-truncated excerpt the feed exposes, not `cp.body`.
  RETURN QUERY
  SELECT
    cp.id,
    cp.user_id,
    cp.parent_post_id,
    cp.title,
    (CASE
       WHEN substring(cp.body FROM '^[^.!?]*[.!?](?:\s|$)') IS NOT NULL
        AND length(substring(cp.body FROM '^[^.!?]*[.!?](?:\s|$)'))
            <= LEAST(length(cp.body), 140)
       THEN substring(cp.body FROM '^[^.!?]*[.!?](?:\s|$)')
       ELSE substring(cp.body FROM 1 FOR 140)
     END) AS body,
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
