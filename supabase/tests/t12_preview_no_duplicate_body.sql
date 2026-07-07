-- t12: The preview branch of collective_feed_page MUST NOT leak a full body.
--
-- History: this test originally guarded a UNION-overlap full-body leak in the
-- pre-3-15 feed preview (1 full row + 3 teasers). Story 3-15 (20260622000000)
-- rewrote the feed to DROP full `body` and emit only a server-truncated
-- `excerpt` in both modes, so the UNION and its overlap guard are gone. This
-- test is retained and repurposed as the feed-level "no full body in preview"
-- regression: the most-recent post appears exactly once, and its returned
-- excerpt is truncated (<= 140 chars) and NOT the full body.

BEGIN;
\i _helpers.psql
SELECT plan(3);

DO $$
DECLARE
  v_poster UUID;
  v_viewer UUID;
  v_p1 UUID := gen_random_uuid();
  v_p2 UUID := gen_random_uuid();
  v_p3 UUID := gen_random_uuid();
  v_p4 UUID := gen_random_uuid();
  -- Long body, no early sentence-ending punctuation, so the excerpt heuristic
  -- truncates to the first 140 chars (a genuine truncation to assert against).
  v_p1_body TEXT := repeat('word ', 60);   -- 300 chars, no '.', '!' or '?'
  v_p1_count INT;
  v_p1_excerpt TEXT;
  v_full_leak INT;
BEGIN
  v_poster := test_seed_user();
  PERFORM test_seed_500_today(v_poster);
  PERFORM test_become(v_poster);

  -- Insert with controlled timestamps: P1 newest, P4 oldest. Every top-level
  -- post needs a non-blank title (collective_posts_title_chk, Story 3-15).
  INSERT INTO collective_posts (id, user_id, title, body, created_at)
  VALUES
    (v_p4, v_poster, 'Title four', 'BODY-FOUR-FULL-LENGTH-CONTENT-THAT-WOULD-TRUNCATE.', NOW() - INTERVAL '4 minutes'),
    (v_p3, v_poster, 'Title three', 'BODY-THREE-FULL-LENGTH-CONTENT-THAT-WOULD-TRUNCATE.', NOW() - INTERVAL '3 minutes'),
    (v_p2, v_poster, 'Title two', 'BODY-TWO-FULL-LENGTH-CONTENT-THAT-WOULD-TRUNCATE.', NOW() - INTERVAL '2 minutes'),
    (v_p1, v_poster, 'Title one', v_p1_body, NOW() - INTERVAL '1 minute');

  v_viewer := test_seed_user();
  PERFORM test_seed_sub500_today(v_viewer);
  PERFORM test_become(v_viewer);

  -- The most-recent post (P1) MUST appear exactly once.
  SELECT COUNT(*) INTO v_p1_count
  FROM collective_feed_page(NULL, 20)
  WHERE id = v_p1;

  -- Capture P1's excerpt as served to the sub-500 viewer.
  SELECT excerpt INTO v_p1_excerpt
  FROM collective_feed_page(NULL, 20)
  WHERE id = v_p1;

  -- No preview row may carry the full untruncated body of P1.
  SELECT COUNT(*) INTO v_full_leak
  FROM collective_feed_page(NULL, 20)
  WHERE id = v_p1 AND excerpt = v_p1_body;

  PERFORM tap_ok(v_p1_count = 1,               'most-recent post P1 appears exactly once in preview');
  PERFORM tap_ok(length(v_p1_excerpt) <= 140,  'P1 excerpt is truncated to <= 140 chars');
  PERFORM tap_ok(v_full_leak = 0,              'no preview row carries P1''s full untruncated body');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
