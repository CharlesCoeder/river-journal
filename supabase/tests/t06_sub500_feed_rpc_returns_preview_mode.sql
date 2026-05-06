-- t06: Sub-500 user calling collective_feed_page receives mode='preview' rows
-- and exactly 4 rows total when >=4 candidate posts exist
-- (1 most-recent full-body + up to 3 teasers).

BEGIN;
\i _helpers.sql
SELECT plan(4);

DO $$
DECLARE
  v_poster UUID;
  v_viewer UUID;
  v_total INT;
  v_preview INT;
  v_teasers INT;
BEGIN
  v_poster := test_seed_user();
  PERFORM test_seed_500_today(v_poster);
  PERFORM test_become(v_poster);
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_poster, 'p1');
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_poster, 'p2');
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_poster, 'p3');
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_poster, 'p4');
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_poster, 'p5');

  v_viewer := test_seed_user();
  PERFORM test_seed_sub500_today(v_viewer);
  PERFORM test_become(v_viewer);

  SELECT COUNT(*) INTO v_total   FROM collective_feed_page(NULL, 20);
  SELECT COUNT(*) INTO v_preview FROM collective_feed_page(NULL, 20) WHERE mode = 'preview';
  -- Teaser bodies are truncated; the recent-post row carries the full body.
  -- With 5 candidate posts, expect exactly 3 truncated teasers.
  SELECT COUNT(*) INTO v_teasers FROM collective_feed_page(NULL, 20)
    WHERE mode = 'preview' AND body IN ('p1','p2','p3','p4');

  PERFORM ok(v_total = 4,          'preview returns exactly 4 rows when >=4 candidates exist (1 recent + 3 teasers)');
  PERFORM ok(v_total <= 4,         'preview has at most 4 rows (1 + up to 3 teasers)');
  PERFORM ok(v_total = v_preview,  'every returned row has mode = preview');
  PERFORM ok(v_teasers = 3,        'exactly 3 teaser rows accompany the most-recent post');
END $$;

SELECT * FROM finish();
ROLLBACK;
