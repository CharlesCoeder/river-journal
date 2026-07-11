-- Migration: Admin-only SECURITY DEFINER read RPC for the moderation queue.
--
-- Powers the moderation queue admin surface (web + desktop). Returns one
-- aggregated row per reported Collective post with a pending report — the
-- flag count, the post body/metadata, and a privacy-scrubbed array of the
-- post's pending reports.
--
-- WHY AN RPC AND NOT A DIRECT / EMBEDDED SELECT — READ THIS BEFORE EDITING.
--   `collective_posts` has RLS enabled with NO SELECT policy and
--   `REVOKE ALL ON TABLE collective_posts FROM authenticated` (only INSERT is
--   granted) — see 20260506000000_create_collective_posts.sql ("DO NOT add a
--   SELECT policy"). The admin `is_admin` claim grants SELECT on
--   `collective_reports` and `moderation_actions`, but grants NOTHING on
--   `collective_posts`. So a PostgREST embedded join
--   (`from('collective_reports').select('*, collective_posts(*)')`) returns
--   `collective_posts: null` for every row — PostgREST honors the joined
--   table's RLS. The queue MUST flow through a DEFINER RPC that reads
--   `collective_posts` as the table owner (postgres), exactly like
--   `collective_your_posts_page`. Adding a SELECT policy/GRANT to
--   `collective_posts` is FORBIDDEN: it would defeat the server-side
--   preview-vs-full 500-word gate.
--
-- Hardening (mirrors 20260507000000_add_collective_your_posts_rpc.sql and the
-- admin-guard idiom from 20260711000002_add_moderation_functions.sql):
--   - LANGUAGE plpgsql, SECURITY DEFINER, SET search_path = public, pg_temp.
--   - Admin re-check at the top raises SQLSTATE 42501 — defense-in-depth
--     BENEATH the client route gate (which is UX-only). `auth.uid()` /
--     `auth.jwt()` read the CALLER's request GUCs even inside a DEFINER
--     function, so the claim check reflects who invoked the RPC.
--   - REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO authenticated (safe because
--     the function self-checks is_admin).
--   - page_size clamp: floor 1, ceiling 100.
--
-- PRIVACY: the `reports` JSONB array OMITS `reporter_user_id`. Charlie sees
-- reasons, notes, and timestamps — never who reported (a re-identification
-- side-channel is avoided).
--
-- ORDERING / OVERFLOW: rows are ordered oldest-pending-report first
-- (`MIN(created_at) ASC`), so the operator triages the oldest-waiting flags
-- first. Because the LIMIT keeps the oldest rows, once pending-report posts
-- exceed the cap the NEWEST-reported posts silently fall off the returned
-- page. That is the intended triage order; the overflow ALARM is the future
-- operational queue-depth metric, not a "has more" flag here (deliberately
-- omitted). A stable `post_id` secondary sort keeps the queue from reordering
-- across refetches when two posts share an identical oldest-pending timestamp.

-- ============================================================================
-- collective_moderation_queue(page_size INT)
-- ============================================================================
CREATE OR REPLACE FUNCTION collective_moderation_queue(
  page_size INT
)
RETURNS TABLE (
  post_id              UUID,
  author_user_id       UUID,
  title                TEXT,
  body                 TEXT,
  post_created_at      TIMESTAMPTZ,
  is_removed           BOOLEAN,
  removed_at           TIMESTAMPTZ,
  removed_reason       TEXT,
  is_user_deleted      BOOLEAN,
  user_deleted_at      TIMESTAMPTZ,
  flag_count           INT,
  latest_report_reason TEXT,
  latest_report_note   TEXT,
  latest_report_at     TIMESTAMPTZ,
  reports              JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_size INT;
BEGIN
  -- Admin guard (defense-in-depth beneath the client route gate). A missing
  -- claim (NULL), a non-admin, and an unauthenticated caller all deny.
  IF auth.uid() IS NULL OR (auth.jwt() ->> 'is_admin')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- Server-side clamp on page_size: floor 1 (zero-row stall defense),
  -- ceiling 100 (oversized-pull defense).
  v_size := GREATEST(LEAST(COALESCE(page_size, 100), 100), 1);

  RETURN QUERY
  WITH pending AS (
    -- One row per reported post: aggregate ONLY pending reports. The
    -- deterministic `created_at DESC, id DESC` ordering inside jsonb_agg keeps
    -- the array stable when two reports share an identical timestamp.
    SELECT
      r.post_id                       AS post_id,
      COUNT(*)::INT                   AS flag_count,
      MIN(r.created_at)               AS oldest_at,
      jsonb_agg(
        jsonb_build_object(
          'id',          r.id,
          'reason_code', r.reason_code,
          'note',        r.note,
          'created_at',  r.created_at
        )
        ORDER BY r.created_at DESC, r.id DESC
      )                               AS reports
    FROM collective_reports r
    WHERE r.status = 'pending'
    GROUP BY r.post_id
  ),
  latest AS (
    -- The newest pending report per post, for the row preview. The `id`
    -- tiebreak makes the pick deterministic under equal timestamps.
    SELECT DISTINCT ON (r.post_id)
      r.post_id     AS post_id,
      r.reason_code AS reason_code,
      r.note        AS note,
      r.created_at  AS created_at
    FROM collective_reports r
    WHERE r.status = 'pending'
    ORDER BY r.post_id, r.created_at DESC, r.id DESC
  )
  SELECT
    cp.id             AS post_id,
    cp.user_id        AS author_user_id,
    cp.title          AS title,
    cp.body           AS body,
    cp.created_at     AS post_created_at,
    cp.is_removed     AS is_removed,
    cp.removed_at     AS removed_at,
    cp.removed_reason AS removed_reason,
    cp.is_user_deleted AS is_user_deleted,
    cp.user_deleted_at AS user_deleted_at,
    p.flag_count      AS flag_count,
    l.reason_code     AS latest_report_reason,
    l.note            AS latest_report_note,
    l.created_at      AS latest_report_at,
    p.reports         AS reports
  FROM pending p
  JOIN collective_posts cp ON cp.id = p.post_id
  JOIN latest l ON l.post_id = p.post_id
  -- Oldest-waiting first; stable `post_id` tiebreak on equal timestamps.
  ORDER BY p.oldest_at ASC, cp.id ASC
  LIMIT v_size;
END;
$$;

REVOKE EXECUTE ON FUNCTION collective_moderation_queue(INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION collective_moderation_queue(INT) TO authenticated;

-- ============================================================================
-- Partial index supporting the queue's `WHERE status = 'pending'` filter +
-- `GROUP BY post_id` aggregation. Without it, the queue query scans and
-- filters the whole reports table (which accumulates resolved rows over time)
-- on every poll. This index is load-bearing as the reports table grows.
-- ============================================================================
CREATE INDEX IF NOT EXISTS collective_reports_pending_post_idx
  ON collective_reports (post_id, created_at)
  WHERE status = 'pending';
