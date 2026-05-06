-- Migration: SECURITY DEFINER read RPCs for the Collective surface.
--
-- These are the ONLY read paths into collective_posts. Direct SELECT is
-- denied via RLS-no-SELECT-policy (see 20260506000000 / 20260506000004).
--
-- Both RPCs:
--   - Open with `auth.uid() IS NOT NULL` assertion (regression for the
--     silent-preview-leak failure mode where unauthenticated callers fall
--     through to the preview branch).
--   - Internally evaluate daily_500_completed_today(auth.uid()) and
--     dispatch full vs preview shape via a `mode TEXT` column.
--   - Self-deleted (is_user_deleted = TRUE) and account-anonymized
--     (user_id IS NULL) rows ARE included; filtering happens client-side.
--   - Pinned `search_path = public, pg_temp` (mandatory hardening).
--   - REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO authenticated.

-- ============================================================================
-- collective_feed_page(cursor TIMESTAMPTZ, page_size INT)
-- ============================================================================
CREATE OR REPLACE FUNCTION collective_feed_page(
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
  mode            TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full   BOOLEAN;
  v_size   INT;
  v_cursor TIMESTAMPTZ;
  v_recent_id UUID;
BEGIN
  -- Auth assertion: SECURITY DEFINER preserves the caller's auth.uid()
  -- because we are NOT using SET ROLE. An unauthenticated direct call would
  -- otherwise compute daily_500_completed_today(NULL) → FALSE → preview
  -- mode → leak truncated bodies. Block it.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- Server-side clamp on page_size: floor at 1 (defends against zero-row
  -- pagination stall), ceiling at 50 (defends against million-row request).
  v_size := GREATEST(LEAST(COALESCE(page_size, 20), 50), 1);

  -- COALESCE so a NULL cursor selects the newest rows.
  v_cursor := COALESCE(cursor, NOW() + INTERVAL '1 second');

  v_full := daily_500_completed_today(auth.uid());

  IF v_full THEN
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
      'full'::TEXT AS mode
    FROM collective_posts cp
    WHERE cp.parent_post_id IS NULL
      AND cp.is_removed = FALSE
      AND cp.created_at < v_cursor
    ORDER BY cp.created_at DESC
    LIMIT v_size;
    RETURN;
  END IF;

  -- Preview branch.
  -- Compute the most-recent top-level non-removed post id once. We use it
  -- both as the single full-body row AND as an exclusion filter for the
  -- teaser subquery (UNION non-overlap regression: a duplicate row would
  -- leak the full body of the most-recent post under the truncated slot).
  SELECT cp.id
  INTO v_recent_id
  FROM collective_posts cp
  WHERE cp.parent_post_id IS NULL
    AND cp.is_removed = FALSE
  ORDER BY cp.created_at DESC
  LIMIT 1;

  IF v_recent_id IS NULL THEN
    -- Empty system; nothing to preview.
    RETURN;
  END IF;

  RETURN QUERY
  -- Single most-recent full-body row.
  SELECT
    cp.id,
    cp.user_id,
    cp.parent_post_id,
    cp.body,
    cp.created_at,
    cp.is_removed,
    cp.is_user_deleted,
    cp.user_deleted_at,
    'preview'::TEXT AS mode
  FROM collective_posts cp
  WHERE cp.id = v_recent_id

  UNION ALL

  -- Up to 3 teaser rows with truncated body. The teaser SELECT is wrapped
  -- in a parenthesized subquery so its ORDER BY / LIMIT 3 binds ONLY to
  -- the teaser branch, not the entire UNION ALL. Without parentheses,
  -- Postgres would apply LIMIT 3 to the combined result and the preview
  -- would cap at 3 rows total instead of the contracted 1 + up to 3 = 4.
  -- WHERE id <> v_recent_id enforces non-overlap with the recent-post row.
  SELECT * FROM (
    SELECT
      cp.id,
      cp.user_id,
      cp.parent_post_id,
      -- Truncation heuristic: substring up to first sentence-end (regex
      -- match on [.!?] followed by whitespace) OR first 140 chars,
      -- whichever is shorter.
      CASE
        WHEN substring(cp.body FROM '^[^.!?]*[.!?](\s|$)') IS NOT NULL
         AND length(substring(cp.body FROM '^[^.!?]*[.!?](\s|$)'))
             <= LEAST(length(cp.body), 140)
        THEN substring(cp.body FROM '^[^.!?]*[.!?](\s|$)')
        ELSE substring(cp.body FROM 1 FOR 140)
      END AS body,
      cp.created_at,
      cp.is_removed,
      cp.is_user_deleted,
      cp.user_deleted_at,
      'preview'::TEXT AS mode
    FROM collective_posts cp
    WHERE cp.parent_post_id IS NULL
      AND cp.is_removed = FALSE
      AND cp.id <> v_recent_id
    ORDER BY cp.created_at DESC
    LIMIT 3
  ) teasers;
END;
$$;

REVOKE EXECUTE ON FUNCTION collective_feed_page(TIMESTAMPTZ, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION collective_feed_page(TIMESTAMPTZ, INT) TO authenticated;

-- ============================================================================
-- collective_thread_page(post_id UUID, cursor TIMESTAMPTZ, page_size INT)
-- ============================================================================
CREATE OR REPLACE FUNCTION collective_thread_page(
  post_id   UUID,
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
  mode            TEXT
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

  v_full := daily_500_completed_today(auth.uid());

  IF v_full THEN
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
      'full'::TEXT AS mode
    FROM collective_posts cp
    WHERE cp.parent_post_id = collective_thread_page.post_id
      AND cp.is_removed = FALSE
      AND cp.created_at > v_cursor
    ORDER BY cp.created_at ASC
    LIMIT v_size;
    RETURN;
  END IF;

  -- Preview branch: top 3 replies of the thread root, oldest-first.
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
