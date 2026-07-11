-- Migration: fold the user-to-user block boundary into every Collective
-- read/write path so a blocked pair's posts, replies, and reactions become
-- mutually invisible — symmetric and silent.
--
-- Two enforcement shapes, chosen per surface:
--
--   * READ RPCs (collective_feed_page / collective_thread_root /
--     collective_thread_page) are SECURITY DEFINER and run as the table
--     owner, so they can read user_blocks directly. They use a set-based
--     NOT EXISTS anti-join against user_blocks rather than per-row calls to
--     the DEFINER predicate — the planner can pick a hash/merge anti-join and
--     avoids N un-inlinable DEFINER invocations on the feed hot path. This is
--     semantically identical to NOT is_blocked_either_way(auth.uid(), author).
--
--   * WRITE / reaction-READ RLS policies run as the CALLER, which cannot read
--     user_blocks (one-sided RLS) nor collective_posts (no SELECT policy), so
--     they MUST go through the SECURITY DEFINER helpers. A raw
--     (SELECT user_id FROM collective_posts WHERE id = ...) inside a policy is
--     evaluated under the caller's row-security, reads zero rows → NULL, and
--     NOT is_blocked_either_way(uid, NULL) is TRUE — silently bypassing the
--     gate. collective_post_author (DEFINER, below) resolves the real author
--     by running as the owner; the predicate then closes the boundary.
--
-- collective_reports policies are intentionally NOT touched — blocking is
-- independent of reporting. collective_your_posts_page and the admin RPCs are
-- NOT touched — you cannot block yourself, and moderation must see everything.
--
-- The whole file runs in one implicit transaction (no CONCURRENTLY, no
-- explicit COMMIT): the helper, the policy edits, and the RPC rewrites land
-- atomically, and every failure direction fails CLOSED.

-- ============================================================================
-- 1. DEFINER author-lookup helper (define FIRST — the policy edits call it).
--
-- Same non-exposed-schema hazard as is_blocked_either_way, and worse: a
-- client-callable collective_post_author(post_id) would be a de-anonymization
-- primitive mapping any pseudonymous post to its real users.id. So it lives in
-- `private` too — USAGE + EXECUTE to authenticated, never reachable as an RPC.
-- Running as the owner, its internal SELECT bypasses collective_posts' RLS and
-- returns the real author (NULL for a tombstoned / missing post, which the
-- predicate safely treats as "not blocked").
-- ============================================================================
CREATE OR REPLACE FUNCTION private.collective_post_author(p_post_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT user_id FROM collective_posts WHERE id = p_post_id;
$$;

REVOKE EXECUTE ON FUNCTION private.collective_post_author(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION private.collective_post_author(UUID) TO authenticated;

-- ============================================================================
-- 2. RLS policy edits — ALTER POLICY in place (atomic expression replacement,
--    no drop-window that would default-DENY on this RLS-enabled table).
-- ============================================================================

-- Cross-boundary replies denied: a reply whose direct parent is authored by a
-- blocked party (either direction) fails the CHECK. Top-level posts
-- (parent_post_id IS NULL) are unaffected.
ALTER POLICY "collective_posts_insert_gated"
  ON collective_posts
  WITH CHECK (
    auth.uid() = user_id
    AND daily_500_completed_today(auth.uid())
    AND NOT is_active_suspension(auth.uid(), 'post_react')
    AND (
      parent_post_id IS NULL
      OR NOT private.is_blocked_either_way(auth.uid(), private.collective_post_author(parent_post_id))
    )
  );

-- Cross-boundary reactions denied: reacting on a blocked author's post fails.
ALTER POLICY "collective_reactions_insert_gated"
  ON collective_reactions
  WITH CHECK (
    auth.uid() = user_id
    AND daily_500_completed_today(auth.uid())
    AND NOT is_active_suspension(auth.uid(), 'post_react')
    AND NOT private.is_blocked_either_way(auth.uid(), private.collective_post_author(post_id))
  );

-- Pre-existing reactions on a blocked author's post are hidden from the direct
-- client read (reactions.ts).
ALTER POLICY "collective_reactions_select_authenticated"
  ON collective_reactions
  USING (
    auth.uid() IS NOT NULL
    AND NOT private.is_blocked_either_way(auth.uid(), private.collective_post_author(post_id))
  );

-- ============================================================================
-- 3. Read-RPC rewrites — CREATE OR REPLACE (return shapes unchanged, so the
--    ACL is preserved). Each is copied verbatim from
--    20260622000000_add_collective_post_titles.sql and extended with the
--    block anti-join on every author-bearing WHERE and every descendant walk
--    term (the walk is filtered so descendant_count stays block-consistent —
--    an unfiltered count would be an "am I blocked in this thread?" oracle for
--    the blocked party, since removed replies are already excluded).
-- ============================================================================

-- ---- collective_feed_page --------------------------------------------------
CREATE OR REPLACE FUNCTION collective_feed_page(
  cursor    TIMESTAMPTZ,
  page_size INT
)
RETURNS TABLE (
  id               UUID,
  user_id          UUID,
  parent_post_id   UUID,
  title            TEXT,
  excerpt          TEXT,
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
  v_full   BOOLEAN;
  v_size   INT;
  v_cursor TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  v_size := GREATEST(LEAST(COALESCE(page_size, 20), 50), 1);
  v_cursor := COALESCE(cursor, NOW() + INTERVAL '1 second');

  v_full := daily_500_completed_today(auth.uid());

  IF v_full THEN
    RETURN QUERY
    WITH RECURSIVE
    page_posts AS (
      SELECT cp.id, cp.user_id, cp.parent_post_id, cp.title, cp.body,
             cp.created_at, cp.is_removed, cp.is_user_deleted, cp.user_deleted_at
      FROM collective_posts cp
      WHERE cp.parent_post_id IS NULL
        AND cp.is_removed = FALSE
        AND cp.created_at < v_cursor
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_user_id = auth.uid() AND ub.blocked_user_id = cp.user_id)
             OR (ub.blocked_user_id = auth.uid() AND ub.blocker_user_id = cp.user_id)
        )
      ORDER BY cp.created_at DESC
      LIMIT v_size
    ),
    descendants AS (
      -- Base: direct children of each page row, excluding blocked authors so
      -- the count matches what the viewer can actually see.
      SELECT pp.id AS root_id, child.id AS desc_id
      FROM page_posts pp
      JOIN collective_posts child ON child.parent_post_id = pp.id
      WHERE child.is_removed = FALSE
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_user_id = auth.uid() AND ub.blocked_user_id = child.user_id)
             OR (ub.blocked_user_id = auth.uid() AND ub.blocker_user_id = child.user_id)
        )
      UNION ALL
      SELECT d.root_id, deeper.id
      FROM descendants d
      JOIN collective_posts deeper ON deeper.parent_post_id = d.desc_id
      WHERE deeper.is_removed = FALSE
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_user_id = auth.uid() AND ub.blocked_user_id = deeper.user_id)
             OR (ub.blocked_user_id = auth.uid() AND ub.blocker_user_id = deeper.user_id)
        )
    ) CYCLE desc_id SET is_cycle USING path,
    desc_counts AS (
      SELECT d.root_id, COUNT(*) AS dc
      FROM descendants d
      WHERE NOT d.is_cycle
      GROUP BY d.root_id
    ),
    reaction_tally AS (
      SELECT s.post_id, jsonb_object_agg(s.kind, s.n) AS reactions
      FROM (
        SELECT cr.post_id, cr.kind, COUNT(*) AS n
        FROM collective_reactions cr
        WHERE cr.post_id IN (SELECT pp.id FROM page_posts pp)
        GROUP BY cr.post_id, cr.kind
      ) s
      GROUP BY s.post_id
    )
    SELECT
      pp.id,
      pp.user_id,
      pp.parent_post_id,
      pp.title,
      CASE
        WHEN substring(pp.body FROM '^[^.!?]*[.!?](?:\s|$)') IS NOT NULL
         AND length(substring(pp.body FROM '^[^.!?]*[.!?](?:\s|$)'))
             <= LEAST(length(pp.body), 140)
        THEN substring(pp.body FROM '^[^.!?]*[.!?](?:\s|$)')
        ELSE substring(pp.body FROM 1 FOR 140)
      END AS excerpt,
      pp.created_at,
      pp.is_removed,
      pp.is_user_deleted,
      pp.user_deleted_at,
      COALESCE(dc.dc, 0)::INT AS descendant_count,
      COALESCE(rt.reactions, '{}'::jsonb) AS reactions,
      'full'::TEXT AS mode
    FROM page_posts pp
    LEFT JOIN desc_counts dc ON dc.root_id = pp.id
    LEFT JOIN reaction_tally rt ON rt.post_id = pp.id
    ORDER BY pp.created_at DESC;
    RETURN;
  END IF;

  -- Preview branch: descendant_count is always 0 here (no walk), so only the
  -- top-level author filter is needed.
  RETURN QUERY
  WITH page_posts AS (
    SELECT cp.id, cp.user_id, cp.parent_post_id, cp.title, cp.body,
           cp.created_at, cp.is_removed, cp.is_user_deleted, cp.user_deleted_at
    FROM collective_posts cp
    WHERE cp.parent_post_id IS NULL
      AND cp.is_removed = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE (ub.blocker_user_id = auth.uid() AND ub.blocked_user_id = cp.user_id)
           OR (ub.blocked_user_id = auth.uid() AND ub.blocker_user_id = cp.user_id)
      )
    ORDER BY cp.created_at DESC
    LIMIT 4
  ),
  reaction_tally AS (
    SELECT s.post_id, jsonb_object_agg(s.kind, s.n) AS reactions
    FROM (
      SELECT cr.post_id, cr.kind, COUNT(*) AS n
      FROM collective_reactions cr
      WHERE cr.post_id IN (SELECT pp.id FROM page_posts pp)
      GROUP BY cr.post_id, cr.kind
    ) s
    GROUP BY s.post_id
  )
  SELECT
    pp.id,
    pp.user_id,
    pp.parent_post_id,
    pp.title,
    CASE
      WHEN substring(pp.body FROM '^[^.!?]*[.!?](?:\s|$)') IS NOT NULL
       AND length(substring(pp.body FROM '^[^.!?]*[.!?](?:\s|$)'))
           <= LEAST(length(pp.body), 140)
      THEN substring(pp.body FROM '^[^.!?]*[.!?](?:\s|$)')
      ELSE substring(pp.body FROM 1 FOR 140)
    END AS excerpt,
    pp.created_at,
    pp.is_removed,
    pp.is_user_deleted,
    pp.user_deleted_at,
    0::INT AS descendant_count,
    COALESCE(rt.reactions, '{}'::jsonb) AS reactions,
    'preview'::TEXT AS mode
  FROM page_posts pp
  LEFT JOIN reaction_tally rt ON rt.post_id = pp.id
  ORDER BY pp.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION collective_feed_page(TIMESTAMPTZ, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION collective_feed_page(TIMESTAMPTZ, INT) TO authenticated;

-- ---- collective_thread_root ------------------------------------------------
-- Base body is the latest shipped definition (20260706110000: ambiguous-
-- reactions fix + mode-aware body that withholds the full body from sub-500
-- callers). Only the block anti-joins are added.
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
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE (ub.blocker_user_id = auth.uid() AND ub.blocked_user_id = child.user_id)
           OR (ub.blocked_user_id = auth.uid() AND ub.blocker_user_id = child.user_id)
      )
    UNION ALL
    SELECT deeper.id
    FROM descendants d
    JOIN collective_posts deeper ON deeper.parent_post_id = d.desc_id
    WHERE deeper.is_removed = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE (ub.blocker_user_id = auth.uid() AND ub.blocked_user_id = deeper.user_id)
           OR (ub.blocked_user_id = auth.uid() AND ub.blocker_user_id = deeper.user_id)
      )
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
    -- SECURITY: full body only in full mode; preview gets the truncated excerpt.
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
  -- A blocked root returns zero rows → client renders not-found/removed, which
  -- is silent.
  WHERE cp.id = collective_thread_root.post_id
    AND cp.is_removed = FALSE
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks ub
      WHERE (ub.blocker_user_id = auth.uid() AND ub.blocked_user_id = cp.user_id)
         OR (ub.blocked_user_id = auth.uid() AND ub.blocker_user_id = cp.user_id)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION collective_thread_root(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION collective_thread_root(UUID) TO authenticated;

-- ---- collective_thread_page ------------------------------------------------
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
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_user_id = auth.uid() AND ub.blocked_user_id = child.user_id)
             OR (ub.blocked_user_id = auth.uid() AND ub.blocker_user_id = child.user_id)
        )

      UNION ALL

      SELECT
        d.root_id,
        deeper.id,
        deeper.parent_post_id
      FROM descendants d
      JOIN collective_posts deeper ON deeper.parent_post_id = d.desc_id
      WHERE deeper.is_removed = FALSE
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_user_id = auth.uid() AND ub.blocked_user_id = deeper.user_id)
             OR (ub.blocked_user_id = auth.uid() AND ub.blocker_user_id = deeper.user_id)
        )
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
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE (ub.blocker_user_id = auth.uid() AND ub.blocked_user_id = cp.user_id)
           OR (ub.blocked_user_id = auth.uid() AND ub.blocker_user_id = cp.user_id)
      )
    ORDER BY cp.created_at ASC
    LIMIT v_size;
    RETURN;
  END IF;

  -- Preview mode: top 3 direct replies, descendant_count always 0.
  -- SECURITY: the full reply body is withheld from sub-500 callers — emit the
  -- same server-truncated excerpt the feed exposes, not cp.body.
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
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks ub
      WHERE (ub.blocker_user_id = auth.uid() AND ub.blocked_user_id = cp.user_id)
         OR (ub.blocked_user_id = auth.uid() AND ub.blocker_user_id = cp.user_id)
    )
  ORDER BY cp.created_at ASC
  LIMIT 3;
END;
$$;

REVOKE EXECUTE ON FUNCTION collective_thread_page(UUID, TIMESTAMPTZ, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION collective_thread_page(UUID, TIMESTAMPTZ, INT) TO authenticated;
