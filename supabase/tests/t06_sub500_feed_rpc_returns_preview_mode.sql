-- t06: Sub-500 user calling collective_feed_page receives mode='preview' rows,
-- capped at 4 rows (LIMIT 4), each carrying only a server-truncated `excerpt`
-- (NOT a full `body`).
--
-- Story 3-15 (20260622000000) rewrote the feed: it DROPPED full `body` from the
-- return entirely and now emits `excerpt` in BOTH modes. The old preview shape
-- (1 most-recent full-body row + up to 3 truncated teasers, guarded by a UNION
-- non-overlap check) no longer exists — every preview row is an excerpt. Top-
-- level posts also now require a non-blank title (collective_posts_title_chk).

BEGIN;
\i _helpers.psql
SELECT plan(4);

DO $$
DECLARE
  v_poster UUID;
  v_viewer UUID;
  v_total INT;
  v_preview INT;
  v_excerpts INT;
  v_zero_desc INT;
BEGIN
  v_poster := test_seed_user();
  PERFORM test_seed_500_today(v_poster);
  PERFORM test_become(v_poster);
  -- Explicit decreasing offsets so created_at ordering is deterministic
  -- (NOW() granularity within a single statement-batch is not reliably
  -- monotonic). Five candidates so the LIMIT 4 preview cap is exercised.
  INSERT INTO collective_posts (id, user_id, title, body, created_at) VALUES (gen_random_uuid(), v_poster, 'T1', 'p1', NOW() - INTERVAL '5 minutes');
  INSERT INTO collective_posts (id, user_id, title, body, created_at) VALUES (gen_random_uuid(), v_poster, 'T2', 'p2', NOW() - INTERVAL '4 minutes');
  INSERT INTO collective_posts (id, user_id, title, body, created_at) VALUES (gen_random_uuid(), v_poster, 'T3', 'p3', NOW() - INTERVAL '3 minutes');
  INSERT INTO collective_posts (id, user_id, title, body, created_at) VALUES (gen_random_uuid(), v_poster, 'T4', 'p4', NOW() - INTERVAL '2 minutes');
  INSERT INTO collective_posts (id, user_id, title, body, created_at) VALUES (gen_random_uuid(), v_poster, 'T5', 'p5', NOW() - INTERVAL '1 minute');

  v_viewer := test_seed_user();
  PERFORM test_seed_sub500_today(v_viewer);
  PERFORM test_become(v_viewer);

  SELECT COUNT(*) INTO v_total    FROM collective_feed_page(NULL, 20);
  SELECT COUNT(*) INTO v_preview  FROM collective_feed_page(NULL, 20) WHERE mode = 'preview';
  -- Every returned row carries a non-null excerpt (feed no longer returns body).
  SELECT COUNT(*) INTO v_excerpts FROM collective_feed_page(NULL, 20) WHERE excerpt IS NOT NULL;
  -- descendant_count is 0 in preview (matches the thread-page preview convention).
  SELECT COUNT(*) INTO v_zero_desc FROM collective_feed_page(NULL, 20) WHERE descendant_count = 0;

  PERFORM tap_ok(v_total = 4,         'preview returns exactly 4 rows (LIMIT 4) when >=4 candidates exist');
  PERFORM tap_ok(v_total = v_preview, 'every returned row has mode = preview');
  PERFORM tap_ok(v_excerpts = 4,      'every preview row carries a truncated excerpt (no full body column)');
  PERFORM tap_ok(v_zero_desc = 4,     'descendant_count is 0 on every preview row');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
