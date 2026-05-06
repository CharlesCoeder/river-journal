-- t12: The preview branch of collective_feed_page MUST NOT include the
-- most-recent post twice (once full, once truncated). Regression for the
-- UNION-overlap full-body leak red-team finding.
--
-- Red phase: FAILS because collective_feed_page does not exist yet.

BEGIN;
\i _helpers.psql
SELECT plan(2);

DO $$
DECLARE
  v_poster UUID;
  v_viewer UUID;
  v_p1 UUID := gen_random_uuid();
  v_p2 UUID := gen_random_uuid();
  v_p3 UUID := gen_random_uuid();
  v_p4 UUID := gen_random_uuid();
  v_p1_count INT;
  v_dup INT;
BEGIN
  v_poster := test_seed_user();
  PERFORM test_seed_500_today(v_poster);
  PERFORM test_become(v_poster);

  -- Insert with controlled timestamps: P1 newest, P4 oldest.
  INSERT INTO collective_posts (id, user_id, body, created_at)
  VALUES
    (v_p4, v_poster, 'BODY-FOUR-FULL-LENGTH-CONTENT-THAT-WOULD-TRUNCATE.', NOW() - INTERVAL '4 minutes'),
    (v_p3, v_poster, 'BODY-THREE-FULL-LENGTH-CONTENT-THAT-WOULD-TRUNCATE.', NOW() - INTERVAL '3 minutes'),
    (v_p2, v_poster, 'BODY-TWO-FULL-LENGTH-CONTENT-THAT-WOULD-TRUNCATE.', NOW() - INTERVAL '2 minutes'),
    (v_p1, v_poster, 'BODY-ONE-FULL-LENGTH-CONTENT-THAT-WOULD-TRUNCATE.', NOW() - INTERVAL '1 minute');

  v_viewer := test_seed_user();
  PERFORM test_seed_sub500_today(v_viewer);
  PERFORM test_become(v_viewer);

  -- The most-recent post (P1) MUST appear exactly once.
  SELECT COUNT(*) INTO v_p1_count
  FROM collective_feed_page(NULL, 20)
  WHERE id = v_p1;

  -- No row may simultaneously be P1 AND a truncated body. We approximate the
  -- "truncated" detection by checking that no row exists with id=P1 and
  -- a body that does NOT match the full canonical body.
  SELECT COUNT(*) INTO v_dup
  FROM collective_feed_page(NULL, 20)
  WHERE id = v_p1
    AND body <> 'BODY-ONE-FULL-LENGTH-CONTENT-THAT-WOULD-TRUNCATE.';

  PERFORM tap_ok(v_p1_count = 1, 'most-recent post P1 appears exactly once in preview');
  PERFORM tap_ok(v_dup = 0,      'no row has id=P1 with a truncated body (UNION non-overlap)');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
