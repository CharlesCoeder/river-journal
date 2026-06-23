-- Migration: Collective title-led forum — data-layer evolution (Story 3-15).
--
-- Phase 2 of the approved title-led redesign
-- (docs/_bmad-output/planning-artifacts/collective-title-led-redesign-architecture.md).
--
-- This single forward-only migration is the schema↔RPC half of the change. It:
--   1. Adds a nullable `title` column + a polarised CHECK (required/non-blank/
--      ≤200 on top-level posts; NULL on replies). No backfill — zero existing
--      rows (Collective is still behind the placeholder; architecture D4).
--   2. Encodes the six CHECK accept/reject cases as a transactional DO-block
--      self-test (there is no pgTAP harness in this repo).
--   3. Rewrites `collective_feed_page` to be title-led: adds `title`,
--      server-truncated `excerpt`, `descendant_count`, and a per-kind
--      `reactions` jsonb tally; DROPS full `body` from the return.
--   4. Adds `collective_thread_root(post_id)` — the new body source for the
--      thread view now that the feed no longer carries `body`.
--   5. Adds `title` to `collective_thread_page` + `collective_your_posts_page`.
--
-- All RPCs preserve the existing hardening (SECURITY DEFINER, pinned
-- search_path, auth.uid() guard, REVOKE/GRANT, page_size clamp).

-- ============================================================================
-- 1. Column + polarised CHECK (architecture §5 / D1, D2, D3, D4)
-- ============================================================================

ALTER TABLE collective_posts ADD COLUMN title TEXT NULL;

-- Title required & non-blank & ≤200 on top-level posts; forbidden on replies.
-- A single nullable column + polarised CHECK enforces "titles on top-level,
-- never on replies" in one place, independent of insert path.
ALTER TABLE collective_posts ADD CONSTRAINT collective_posts_title_chk CHECK (
  (parent_post_id IS NULL     AND title IS NOT NULL AND char_length(btrim(title)) BETWEEN 1 AND 200)
  OR
  (parent_post_id IS NOT NULL AND title IS NULL)
);

-- ============================================================================
-- 2. CHECK self-test (AC 3) — runs on every `supabase db reset`.
--
-- No pgTAP harness exists in this repo (the only SQL "tests" are inline DO
-- blocks — mirrors the verification idiom in 20260506000000:84-125). The six
-- accept/reject cases below are asserted here. Each probe runs in its own
-- BEGIN…EXCEPTION sub-block (an implicit savepoint), so:
--   - a wrongly-accepted reject probe RAISEs a clear failure (aborts migration);
--   - a wrongly-rejected accept probe is caught as check_violation → failure;
--   - successful accept-probe rows are rolled back via a sentinel RAISE.
-- Net effect: the constraint behaviour is asserted and NO probe rows persist.
-- ============================================================================
DO $$
DECLARE
  v_root_id  UUID := '11111111-1111-1111-1111-111111111111';
  v_reply_id UUID := '22222222-2222-2222-2222-222222222222';
  v_long     TEXT := repeat('x', 201);   -- 201 chars > 200 cap
BEGIN
  -- ── Top-level cases (no parent needed) ──────────────────────────────────

  -- (e) ACCEPT: top-level post with a valid 1–200-char non-blank title.
  BEGIN
    INSERT INTO collective_posts (id, user_id, parent_post_id, body, title)
    VALUES (v_root_id, NULL, NULL, 'body', 'A valid letter title');
    -- Insert succeeded as expected — roll it back via the sentinel.
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '__rollback_probe__';
  EXCEPTION
    WHEN check_violation THEN
      RAISE EXCEPTION 'self-test FAILED (e): valid top-level title was rejected';
    WHEN raise_exception THEN
      IF SQLERRM <> '__rollback_probe__' THEN RAISE; END IF;
  END;

  -- (b) REJECT: untitled top-level post (parent NULL AND title NULL).
  BEGIN
    INSERT INTO collective_posts (id, user_id, parent_post_id, body, title)
    VALUES (v_root_id, NULL, NULL, 'body', NULL);
    RAISE EXCEPTION 'self-test FAILED (b): untitled top-level post was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;  -- expected; failed insert rolled back
  END;

  -- (c) REJECT: blank / whitespace-only top-level title.
  BEGIN
    INSERT INTO collective_posts (id, user_id, parent_post_id, body, title)
    VALUES (v_root_id, NULL, NULL, 'body', '   ');
    RAISE EXCEPTION 'self-test FAILED (c): blank top-level title was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- (d) REJECT: top-level title longer than 200 chars.
  BEGIN
    INSERT INTO collective_posts (id, user_id, parent_post_id, body, title)
    VALUES (v_root_id, NULL, NULL, 'body', v_long);
    RAISE EXCEPTION 'self-test FAILED (d): >200-char top-level title was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- ── Reply cases (need a real parent row) ────────────────────────────────
  -- Create a valid parent, run both reply probes against it, then roll the
  -- whole subtree back via the sentinel so nothing persists.
  BEGIN
    INSERT INTO collective_posts (id, user_id, parent_post_id, body, title)
    VALUES (v_root_id, NULL, NULL, 'parent body', 'Parent title');

    -- (f) ACCEPT: reply (parent NOT NULL) with title IS NULL.
    BEGIN
      INSERT INTO collective_posts (id, user_id, parent_post_id, body, title)
      VALUES (v_reply_id, NULL, v_root_id, 'reply body', NULL);
    EXCEPTION
      WHEN check_violation THEN
        RAISE EXCEPTION 'self-test FAILED (f): untitled reply was rejected';
    END;

    -- (a) REJECT: titled reply (parent NOT NULL AND title NOT NULL).
    BEGIN
      INSERT INTO collective_posts (id, user_id, parent_post_id, body, title)
      VALUES ('33333333-3333-3333-3333-333333333333', NULL, v_root_id, 'reply body', 'Reply title');
      RAISE EXCEPTION 'self-test FAILED (a): titled reply was accepted';
    EXCEPTION
      WHEN check_violation THEN NULL;
    END;

    -- All reply probes asserted — undo the parent + accepted reply.
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '__rollback_probe__';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> '__rollback_probe__' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'collective_posts_title_chk self-test passed (6/6 cases).';
END $$;

-- ============================================================================
-- 3. collective_feed_page — REWRITE (AC 5–9 / architecture §6, D5, D6)
--
-- Return shape changes (body dropped; title/excerpt/descendant_count/reactions
-- added), so a plain CREATE OR REPLACE cannot alter the RETURNS TABLE — we
-- DROP then recreate.
-- ============================================================================
DROP FUNCTION IF EXISTS collective_feed_page(TIMESTAMPTZ, INT);

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
  -- Auth assertion: SECURITY DEFINER preserves the caller's auth.uid() (no SET
  -- ROLE). An unauthenticated direct call would otherwise compute
  -- daily_500_completed_today(NULL) → FALSE → preview mode. Block it.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- page_size clamp: floor 1, ceiling 50 (matches feed/thread/yourPosts).
  v_size := GREATEST(LEAST(COALESCE(page_size, 20), 50), 1);

  -- COALESCE so a NULL cursor selects the newest rows.
  v_cursor := COALESCE(cursor, NOW() + INTERVAL '1 second');

  v_full := daily_500_completed_today(auth.uid());

  IF v_full THEN
    -- Full mode: the page of recent top-level rows, each with its server-
    -- truncated excerpt, a cycle-safe recursive descendant count, and a
    -- per-kind reaction tally. NO full body is returned (architecture D5) —
    -- the thread view sources body from collective_thread_root.
    RETURN QUERY
    WITH RECURSIVE
    page_posts AS (
      SELECT cp.id, cp.user_id, cp.parent_post_id, cp.title, cp.body,
             cp.created_at, cp.is_removed, cp.is_user_deleted, cp.user_deleted_at
      FROM collective_posts cp
      WHERE cp.parent_post_id IS NULL
        AND cp.is_removed = FALSE
        AND cp.created_at < v_cursor
      ORDER BY cp.created_at DESC
      LIMIT v_size
    ),
    descendants AS (
      -- Base: direct children of each page row. Recursive: walk deeper.
      -- Same Pattern B as collective_thread_page (20260507000001:53-79).
      SELECT pp.id AS root_id, child.id AS desc_id
      FROM page_posts pp
      JOIN collective_posts child ON child.parent_post_id = pp.id
      WHERE child.is_removed = FALSE
      UNION ALL
      SELECT d.root_id, deeper.id
      FROM descendants d
      JOIN collective_posts deeper ON deeper.parent_post_id = d.desc_id
      WHERE deeper.is_removed = FALSE
    ) CYCLE desc_id SET is_cycle USING path,
    desc_counts AS (
      SELECT d.root_id, COUNT(*) AS dc
      FROM descendants d
      WHERE NOT d.is_cycle
      GROUP BY d.root_id
    ),
    reaction_tally AS (
      -- jsonb_object_agg(kind, n) over a per-(post,kind) count. Anonymized
      -- reactions (user_id IS NULL) still count (architecture D6).
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
      -- Excerpt heuristic (reused from the old preview branch,
      -- 20260506000006:132-138): first sentence-end OR first 140 chars,
      -- whichever is shorter. The ONLY body-derived text the feed emits.
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

  -- Preview branch — SIMPLIFIED (architecture D5 / AC 9).
  --
  -- The old preview branch (20260506000006:101-150) returned one most-recent
  -- FULL-body row + up to 3 truncated teasers, with a UNION-ALL non-overlap
  -- guard whose ONLY purpose was to stop the most-recent post's full body from
  -- leaking twice under the sub-500 gate. This rewrite DROPS body from the feed
  -- entirely — every row (both modes) carries only a truncated excerpt — so the
  -- body-leak vector is gone and that guard is no longer needed. This is NOT a
  -- leak regression: there is no full body in the return to police. The 500-gate
  -- still governs full-vs-preview row count + the client-side blur.
  --
  -- descendant_count is 0 in preview (matches the thread-page preview
  -- convention, 20260507000001:112). The reaction tally is still emitted.
  RETURN QUERY
  WITH page_posts AS (
    SELECT cp.id, cp.user_id, cp.parent_post_id, cp.title, cp.body,
           cp.created_at, cp.is_removed, cp.is_user_deleted, cp.user_deleted_at
    FROM collective_posts cp
    WHERE cp.parent_post_id IS NULL
      AND cp.is_removed = FALSE
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

-- ============================================================================
-- 4. collective_thread_root(post_id) — NEW (AC 10–11 / architecture §6)
--
-- The body source for the thread view now that the feed dropped body. Returns
-- the SINGLE root row with full body + title + descendant_count + reactions +
-- mode. Mirrors collective_thread_page's body handling: body is returned in
-- BOTH modes (the client renders locked affordances based on `mode`).
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
    cp.body,
    cp.created_at,
    cp.is_removed,
    cp.is_user_deleted,
    cp.user_deleted_at,
    COALESCE((SELECT dc FROM desc_count), 0)::INT AS descendant_count,
    COALESCE((SELECT reactions FROM reaction_tally), '{}'::jsonb) AS reactions,
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
-- 5. collective_thread_page — add `title` (AC 12)
--
-- Return shape changes, so DROP + recreate (mirrors 20260507000001). Body of
-- the function is otherwise identical to the descendant_count version in
-- 20260507000001; only `title TEXT` (after parent_post_id) is added and
-- `cp.title` is selected (always NULL for replies, guaranteed by the CHECK).
-- ============================================================================
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
  RETURN QUERY
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

-- ============================================================================
-- 6. collective_your_posts_page — add `title` (AC 13)
--
-- Return shape changes, so DROP + recreate (mirrors 20260507000000). Adds
-- `title TEXT` (after parent_post_id), selects `cp.title` in own_posts (NULL
-- for reply-type own posts). reaction_count / descendant_count / depth-bound /
-- tenure_tier-NULL convention all unchanged.
-- ============================================================================
DROP FUNCTION IF EXISTS collective_your_posts_page(TIMESTAMPTZ, INT);

CREATE OR REPLACE FUNCTION collective_your_posts_page(
  cursor    TIMESTAMPTZ,
  page_size INT
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  v_size := GREATEST(LEAST(COALESCE(page_size, 20), 50), 1);
  v_cursor := COALESCE(cursor, NOW() + INTERVAL '1 second');

  RETURN QUERY
  WITH own_posts AS (
    SELECT
      cp.id,
      cp.user_id,
      cp.parent_post_id,
      cp.title,
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
        AND w.depth < 99   -- depth-bounded recursion (see 20260507000000)
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
    COALESCE(rc.n, 0)::INT AS reaction_count,
    LEAST(COALESCE(d.n, 0), 99)::INT AS descendant_count,
    -- tenure_tier stays NULL (identity milestone deferred — architecture D7).
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
